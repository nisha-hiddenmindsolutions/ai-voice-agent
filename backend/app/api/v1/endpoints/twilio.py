"""
Twilio Telephony Endpoints — Inbound Call Routing & Outbound Fallback.

This module handles the Twilio REST → TwiML → LiveKit call path:

  POST /telephony/twilio/inbound     — Twilio webhook for inbound calls
  GET  /telephony/twilio/inbound     — Same (Twilio can use GET or POST)
  POST /telephony/twilio/outbound    — Trigger outbound call (trial accounts)
  POST /telephony/twilio/flow        — TwiML callback when called party answers
  POST /telephony/twilio/flow-bridge — Bridges caller into LiveKit SIP room

Architecture note (IMPORTANT):
  For the Twilio trial outbound path, the flow is:
    1. Backend calls Twilio REST API → Twilio dials customer
    2. Customer answers → Twilio calls /flow (our webhook)
    3. /flow returns TwiML with <Dial><Sip> pointing to LiveKit SIP gateway
    4. LiveKit SIP gateway receives the SIP call → matches inbound dispatch rule
    5. LiveKit dispatch rule auto-spawns the agent into a fresh room

  DO NOT pre-dispatch agents in this path. LiveKit's dispatch rule handles
  agent spawning automatically when the SIP leg arrives. Pre-dispatching
  creates orphaned agents waiting in rooms that the SIP call never joins.

Security:
  - Twilio webhook signature verification (X-Twilio-Signature header)
  - All credential access from encrypted user secrets
"""

import asyncio
import time
import os
import uuid
import hmac
import hashlib
import base64
import logging
import re
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, quote

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.orm import UserORM, AgentORM, CallORM, CallDirection, PhoneNumberORM
from app.api.deps import get_current_user
from app.core.security import vault
from app.services.agent_metadata_service import build_agent_metadata
from app.services.idempotency import idempotency_store

logger = logging.getLogger("twilio")
router = APIRouter()

_AGENT_WORKER_NAME = os.getenv("LIVEKIT_AGENT_NAME", "voice-forge-agent-v5")
_TWILIO_TRIAL = os.getenv("TWILIO_TRIAL_ACCOUNT", "false").lower() == "true"


# ─── TWILIO SIGNATURE VERIFICATION ───────────────────────────────────────────

def _verify_twilio_signature(
    auth_token: str,
    url: str,
    post_params: dict,
    signature: str,
) -> bool:
    """
    Verifies Twilio's HMAC-SHA1 request signature.
    https://www.twilio.com/docs/usage/webhooks/webhooks-security
    """
    s = url
    for key in sorted(post_params.keys()):
        s += key + (post_params[key] or "")

    expected = base64.b64encode(
        hmac.new(auth_token.encode(), s.encode(), hashlib.sha1).digest()
    ).decode()

    return hmac.compare_digest(expected, signature)


# ─── INBOUND CALL HANDLER ────────────────────────────────────────────────────

async def _process_inbound_call(
    From: str,
    To: str,
    request: Request,
    db: AsyncSession,
    form_params: dict | None = None,
) -> Response:
    """
    Core inbound call logic.

    When someone dials a Twilio number:
      1. Look up the PhoneNumberORM to find the linked agent.
      2. Log the call in DB.
      3. Return TwiML that dials into LiveKit SIP.

    The LiveKit SIP gateway receives the call, matches the inbound trunk
    dispatch rule, and dispatches the agent into a fresh room automatically.
    """
    caller = From.strip()
    dialed_raw = To.strip()
    dialed_clean = dialed_raw.lstrip("+").replace(" ", "")

    logger.info(f"[Inbound] Twilio call: From={caller} To={dialed_raw}")

    # ── 1. Find phone number record ──────────────────────────────────────────
    stmt = (
        select(PhoneNumberORM)
        .options(selectinload(PhoneNumberORM.user))
        .where(
            (PhoneNumberORM.number == dialed_raw) |
            (PhoneNumberORM.number == dialed_clean) |
            (PhoneNumberORM.number == f"+{dialed_clean}")
        )
    )
    result = await db.execute(stmt)
    db_number = result.scalar_one_or_none()

    # ── 2. Verify Twilio webhook signature ───────────────────────────────────
    twilio_sig = request.headers.get("X-Twilio-Signature", "")
    if twilio_sig and db_number:
        user = db_number.user
        if user and user.secrets and user.secrets.get("twilio_auth_token"):
            try:
                auth_token = vault.decrypt(user.secrets["twilio_auth_token"])
                if not _verify_twilio_signature(auth_token, str(request.url), form_params or {}, twilio_sig):
                    logger.warning(f"[Inbound] Twilio signature verification FAILED for {dialed_raw}")
                    return Response(
                        content=_twiml_hangup("Authentication failed."),
                        media_type="application/xml",
                    )
            except Exception as sig_exc:
                logger.warning(f"[Inbound] Could not verify Twilio signature: {sig_exc}")

    if not db_number or not db_number.agent_id:
        logger.warning(f"[Inbound] No agent mapped to number: {dialed_raw}")
        return Response(
            content=_twiml_hangup("The voice assistant is not available for this number."),
            media_type="application/xml",
        )

    # ── 3. Fetch agent ───────────────────────────────────────────────────────
    agent_result = await db.execute(
        select(AgentORM)
        .options(selectinload(AgentORM.tools))
        .where(AgentORM.id == db_number.agent_id)
    )
    agent = agent_result.scalar_one_or_none()
    if not agent:
        logger.error(f"[Inbound] Agent {db_number.agent_id} not found")
        return Response(
            content=_twiml_hangup("System error: voice agent offline."),
            media_type="application/xml",
        )

    # ── 4. Log call ──────────────────────────────────────────────────────────
    db_call = CallORM(
        id=str(uuid.uuid4()),
        user_id=db_number.user_id,
        agent_id=agent.id,
        session_id=f"inbound-pending-{uuid.uuid4().hex[:6]}",
        from_number=caller,
        to_number=dialed_raw,
        direction=CallDirection.INBOUND,
        status="connecting",
    )
    db.add(db_call)
    await db.commit()

    # ── 5. Build TwiML to dial into LiveKit SIP ──────────────────────────────
    from app.core.config import settings
    lk_sip_domain = settings.LIVEKIT_SIP_DOMAIN
    # Use the dialed number so LiveKit's inbound trunk matches it
    sip_number = dialed_raw if dialed_raw.startswith("+") else f"+{dialed_clean}"

    lk_sip_username = os.getenv("LIVEKIT_SIP_USERNAME", "")
    lk_sip_password = os.getenv("LIVEKIT_SIP_PASSWORD", "")
    auth_attr = ""
    if lk_sip_username and lk_sip_password:
        auth_attr = f' username="{lk_sip_username}" password="{lk_sip_password}"'

    # Use TLS on port 5061 — required for LiveKit Cloud SIP
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial>
        <Sip{auth_attr}>sip:{sip_number}@{lk_sip_domain};transport=tcp</Sip>
    </Dial>
</Response>"""

    logger.info(f"[Inbound] Routing {caller} → LiveKit SIP {sip_number}@{lk_sip_domain}")
    return Response(content=twiml, media_type="application/xml")


@router.post("/inbound")
async def handle_twilio_inbound_post(
    request: Request,
    From: str = Form(...),
    To: str = Form(...),
    CallSid: str = Form(default=""),
    db: AsyncSession = Depends(get_db),
):
    """Twilio POST webhook for inbound calls."""
    form_params = {"From": From, "To": To}
    if CallSid:
        form_params["CallSid"] = CallSid
    return await _process_inbound_call(From=From, To=To, request=request, db=db, form_params=form_params)


@router.get("/inbound")
async def handle_twilio_inbound_get(
    request: Request,
    From: str,
    To: str,
    db: AsyncSession = Depends(get_db),
):
    """Twilio GET webhook for inbound calls."""
    return await _process_inbound_call(From=From, To=To, request=request, db=db, form_params={"From": From, "To": To})


# ─── OUTBOUND FALLBACK PATH (TWILIO REST → TWIML → LIVEKIT) ─────────────────

async def _trigger_twilio_outbound_internal(
    *,
    to_number: str,
    agent_id: str,
    current_user: UserORM,
    db: AsyncSession,
) -> dict:
    """
    Twilio REST outbound fallback — used for trial accounts.

    Steps:
      1. Decrypt Twilio credentials from user secrets.
      2. Verify agent exists.
      3. Log CallORM with status='connecting'.
      4. POST to Twilio Calls API with a TwiML callback URL.
         Twilio dials the customer; when they answer, Twilio fetches
         /flow which returns TwiML to bridge the call into LiveKit SIP.
         LiveKit's inbound dispatch rule then auto-spawns the agent.

    NOTE: We do NOT pre-dispatch the agent here. LiveKit's SIP dispatch rule
    handles agent spawning automatically when Twilio's SIP leg arrives.
    Pre-dispatching would create an orphaned agent in a room that the SIP
    call never joins (LiveKit creates its own room name for inbound SIP).
    """
    secrets = current_user.secrets or {}

    # ── 1. Credentials & Provider Routing ────────────────────────────────────
    from app.core.config import settings
    vobiz_token = os.getenv("VOBIZ_AUTH_TOKEN") or getattr(settings, "VOBIZ_AUTH_TOKEN", None)
    vobiz_id = os.getenv("VOBIZ_AUTH_ID") or getattr(settings, "VOBIZ_AUTH_ID", "MA_TKTZ7MH7")
    vobiz_phone = os.getenv("VOBIZ_PHONE_NUMBER") or getattr(settings, "VOBIZ_PHONE_NUMBER", "+918065354620")

    twilio_sid = ""
    twilio_token = ""
    twilio_number = ""
    try:
        if secrets.get("twilio_account_sid"):
            twilio_sid = vault.decrypt(secrets["twilio_account_sid"])
        if secrets.get("twilio_auth_token"):
            twilio_token = vault.decrypt(secrets["twilio_auth_token"])
        if secrets.get("twilio_phone_number"):
            twilio_number = vault.decrypt(secrets["twilio_phone_number"])
    except Exception as exc:
        logger.warning(f"[Twilio Fallback] Decrypt note: {exc}")

    # Seamless Vobiz Routing: If Vobiz credentials exist or user saved Vobiz ID (MA_...)
    if (twilio_sid and twilio_sid.startswith("MA_")) or (vobiz_token and (not twilio_sid or not twilio_sid.startswith("AC"))):
        from app.api.v1.endpoints.vobiz import _trigger_vobiz_outbound_internal
        return await _trigger_vobiz_outbound_internal(
            to_number=to_number,
            agent_id=agent_id,
            current_user=current_user,
            db=db,
            auth_id=twilio_sid if (twilio_sid and twilio_sid.startswith("MA_")) else vobiz_id,
            auth_token=twilio_token if (twilio_token and not twilio_token.startswith("****")) else vobiz_token,
            from_number=twilio_number if (twilio_number and twilio_number.startswith("+91")) else vobiz_phone,
        )

    if not all([twilio_sid, twilio_token, twilio_number]):
        raise HTTPException(
            status_code=400,
            detail=(
                "Telephony credentials not configured. "
                "Add your Auth ID, Auth Token, and Phone Number "
                "in Settings → Telephony."
            ),
        )

    # Clean & normalize E.164 phone numbers
    to_number = "".join(to_number.split())
    if not to_number.startswith("+"):
        to_number = "+" + to_number
    twilio_number = "".join(twilio_number.split())
    if not twilio_number.startswith("+"):
        twilio_number = "+" + twilio_number

    # ── 2. Verify agent ──────────────────────────────────────────────────────
    agent_result = await db.execute(
        select(AgentORM)
        .options(selectinload(AgentORM.tools))
        .where(AgentORM.id == agent_id, AgentORM.user_id == current_user.id)
    )
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")

    # ── 3. Create a unique room name for this call attempt ───────────────────
    # This room name is passed to /flow so it can look up the call record.
    # The actual LiveKit room where the agent runs will be different (created
    # by LiveKit's SIP gateway), but we need this to track the call in our DB.
    room_name = f"twilio_{uuid.uuid4().hex[:8]}"

    # ── 4. Log call BEFORE calling Twilio (so /flow can find it) ────────────
    db_call = CallORM(
        id=str(uuid.uuid4()),
        user_id=current_user.id,
        agent_id=agent_id,
        session_id=room_name,
        from_number=twilio_number,
        to_number=to_number,
        direction=CallDirection.OUTBOUND,
        status="connecting",
        call_meta={"path": "twilio_fallback", "room_name": room_name},
    )
    db.add(db_call)
    await db.commit()
    await db.refresh(db_call)

    # ── 5. Call Twilio REST API ───────────────────────────────────────────────
    from app.core.config import settings
    base_url = os.getenv("BACKEND_URL", settings.BACKEND_BASE_URL)
    # URL-encode agent_id and room_name to be safe, use & (not &amp;) in the
    # actual URL — &amp; is only for embedding URLs inside XML attributes.
    flow_url = (
        f"{base_url}/api/v1/telephony/twilio/flow"
        f"?agent_id={quote(agent_id)}&room={quote(room_name)}"
    )
    # StatusCallback: Twilio is the ONLY reliable source of real-time call
    # status/duration for this path. LiveKit's own SIP gateway creates its
    # own room name for the bridged leg (unrelated to `room_name` above), so
    # the LiveKit room_finished webhook can never find this CallORM row by
    # session_id — that was the actual cause of duration_seconds staying 0.
    # Twilio, on the other hand, always knows this call by its CallSid and
    # will push us `completed` with the real CallDuration regardless of what
    # LiveKit does on its side.
    status_callback_url = f"{base_url}/api/v1/telephony/twilio/status-callback"

    # NOTE: Twilio's Calls API requires StatusCallbackEvent to be sent as
    # MULTIPLE repeated form fields (one per event), not a single
    # space-joined string. Sending it as one string trips Twilio warning
    # 21626 ("invalid statusCallbackEvents ...") and Twilio silently drops
    # the whole subscription — /status-callback then never fires and
    # duration_seconds stays 0 forever, even though the call completes fine.
    #
    # httpx's `data=` param only form-encodes a plain dict (one value per
    # key), so a dict can't express repeated keys. A list of tuples also
    # doesn't work here because httpx routes list/tuple `data` through its
    # streaming `content` path, and a plain list is a sync iterable —
    # that trips httpx's async/sync transport check with:
    #   RuntimeError: Attempted to send a sync request with an AsyncClient.
    # So we urlencode it ourselves and send as raw `content` with the
    # correct content-type header instead.
    body_params = [
        ("To", to_number),
        ("From", twilio_number),
        ("Url", flow_url),
        ("StatusCallback", status_callback_url),
        ("StatusCallbackEvent", "initiated"),
        ("StatusCallbackEvent", "ringing"),
        ("StatusCallbackEvent", "answered"),
        ("StatusCallbackEvent", "completed"),
    ]

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{twilio_sid}/Calls.json",
            auth=(twilio_sid, twilio_token),
            content=urlencode(body_params),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )

    if resp.status_code not in (200, 201):
        db_call.status = "failed"
        await db.commit()
        logger.error(f"[Twilio Fallback] API error {resp.status_code}: {resp.text}")
        raise HTTPException(
            status_code=502,
            detail=f"Twilio API error: {resp.text}",
        )

    twilio_data = resp.json()
    twilio_call_sid = twilio_data.get("sid", "")
    db_call.status = "initiated"
    db_call.twilio_call_sid = twilio_call_sid
    db_call.call_meta = {
        **(db_call.call_meta or {}),
        "twilio_call_sid": twilio_call_sid,
    }
    await db.commit()

    logger.info(
        f"[Twilio Fallback] Call initiated: user={current_user.id} "
        f"to={to_number} twilio_sid={twilio_data.get('sid')} room={room_name}"
    )

    return {
        "status": "success",
        "call_id": db_call.id,
        "room_name": room_name,
        "twilio_call_sid": twilio_data.get("sid", ""),
        "to_number": to_number,
        "detail": "Outbound call queued via Twilio REST fallback.",
    }


# ─── TWIML FLOW ENDPOINTS ────────────────────────────────────────────────────

_groq_http_client: Optional[httpx.AsyncClient] = None

def _get_groq_client() -> httpx.AsyncClient:
    global _groq_http_client
    if _groq_http_client is None or _groq_http_client.is_closed:
        _groq_http_client = httpx.AsyncClient(timeout=3.5, limits=httpx.Limits(max_keepalive_connections=20, max_connections=50))
    return _groq_http_client

def _normalize_spoken_email_heuristics(text: str) -> Optional[str]:
    """Fast regex & phonetic normalizer for spoken email addresses."""
    if not text:
        return None
    import re
    # Direct standard email match
    direct_match = re.search(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', text)
    if direct_match:
        return direct_match.group(0).lower()

    cleaned = text.lower()
    cleaned = re.sub(r'\b(at the rate of|at the rate|at the|added|at sign|at)\b', '@', cleaned)
    cleaned = re.sub(r'\b(dot|point|period)\b', '.', cleaned)
    cleaned = re.sub(r'\b(underscore)\b', '_', cleaned)
    cleaned = re.sub(r'\b(dash|hyphen)\b', '-', cleaned)

    if '@' in cleaned:
        parts = cleaned.split('@', 1)
        left = parts[0].strip()
        right = parts[1].strip()

        left = re.sub(r'^(.*?)(?:email(?: id| address)? is|mail is|it is|send to)\s*', '', left).strip()
        left = re.sub(r'(?<=\b[a-z0-9])\s+(?=[a-z0-9]\b)', '', left)
        left = re.sub(r'\s+', '', left)
        left = re.sub(r'^[^\w]+|[^\w]+$', '', left)

        right = re.sub(r'\s+', '', right)
        right = re.sub(r'[^\w.]+$', '', right)
        if not any(right.endswith(ext) for ext in ['.com', '.in', '.org', '.net', '.io', '.co']):
            if 'gmail' in right:
                right = 'gmail.com'
            elif 'yahoo' in right:
                right = 'yahoo.com'
            elif 'outlook' in right:
                right = 'outlook.com'
            elif 'hotmail' in right:
                right = 'hotmail.com'

        candidate = f"{left}@{right}"
        if re.match(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$', candidate):
            return candidate.lower()

    return None


async def _extract_spoken_email(text: str) -> Optional[str]:
    """Extracts a clean, normalized email address from telephony speech."""
    if not text:
        return None
    heur = _normalize_spoken_email_heuristics(text)
    if heur:
        return heur

    lower = text.lower()
    email_indicators = ["email", "mail", "gmail", "yahoo", "outlook", "hotmail", "address", "@", "dot com", "added"]
    if not any(ind in lower for ind in email_indicators):
        return None

    try:
        groq_key = os.getenv("GROQ_API_KEY", "")
        openrouter_key = os.getenv("OPENROUTER_API_KEY", "")
        if groq_key:
            auth_header = f"Bearer {groq_key}"
            target_url = "https://api.groq.com/openai/v1/chat/completions"
            model_name = "qwen/qwen3.8-27b"
            req_headers = {"Authorization": auth_header}
        elif openrouter_key:
            auth_header = f"Bearer {openrouter_key}"
            target_url = "https://openrouter.ai/api/v1/chat/completions"
            model_name = "meta-llama/llama-3.3-70b-instruct"
            req_headers = {
                "Authorization": auth_header,
                "HTTP-Referer": "https://voice-agent.app",
                "X-Title": "Voice Agent",
            }
        else:
            return None

        prompt = (
            "You are an expert at extracting email addresses from spoken phone call speech-to-text transcripts.\n"
            "Speech-to-text often transcribes email addresses with phonetics or errors:\n"
            "- 'at', 'added', 'at the', 'at the rate', 'a' instead of '@'\n"
            "- 'dot', 'period', 'point' instead of '.'\n"
            "- spaces between letters or words: 'N. I s h a' -> 'nisha', 'hidden mind solutions' -> 'hiddenmindsolutions'\n"
            "- numbers: '08', '0 8', 'zero eight'\n"
            "- common domains: 'gmail.com', 'yahoo.com', 'outlook.com', etc.\n\n"
            f"Transcript: \"\"\"{text}\"\"\"\n\n"
            "Extract the single intended email address mentioned by the caller. "
            "Return ONLY the valid email address in lowercase, or NONE if no email address was mentioned. "
            "Do not include quotes, markdown, or any other words."
        )

        client = _get_groq_client()
        resp = await client.post(
            target_url,
            headers=req_headers,
            json={
                "model": model_name,
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.0,
                "max_tokens": 30
            }
        )
        if resp.status_code == 200:
            extracted = resp.json()["choices"][0]["message"]["content"].strip().lower()
            import re
            m = re.search(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', extracted)
            if m:
                return m.group(0)
    except Exception as e:
        logger.warning(f"[Spoken Email] Extraction failed: {e}")
    return None


async def _generate_groq_llm_reply(
    agent_name: str,
    sys_prompt: str,
    user_speech: str,
    conversation_history: Optional[List[Dict[str, str]]] = None,
    captured_email: Optional[str] = None
) -> tuple[Optional[str], Optional[int]]:
    """Generates an ultra-fast dynamic real-time AI response using Groq (qwen/qwen3.8-27b) with sub-200ms execution."""
    t0 = time.perf_counter()
    try:
        groq_key = os.getenv("GROQ_API_KEY", "")
        openrouter_key = os.getenv("OPENROUTER_API_KEY", "")
        if groq_key:
            auth_header = f"Bearer {groq_key}"
            target_url = "https://api.groq.com/openai/v1/chat/completions"
            model_name = "qwen/qwen3.8-27b"
            req_headers = {"Authorization": auth_header}
        elif openrouter_key:
            auth_header = f"Bearer {openrouter_key}"
            target_url = "https://openrouter.ai/api/v1/chat/completions"
            model_name = "meta-llama/llama-3.3-70b-instruct"
            req_headers = {
                "Authorization": auth_header,
                "HTTP-Referer": "https://voice-agent.app",
                "X-Title": "Voice Agent",
            }
        else:
            logger.warning("[Flow] Neither GROQ_API_KEY nor OPENROUTER_API_KEY is configured!")
            return None, None

        email_ctx = f"\n- Captured caller email: {captured_email}" if captured_email else "\n- No caller email captured yet."
        system_content = (
            f"You are {agent_name}. {sys_prompt}\n"
            f"Call context:{email_ctx}\n"
            "Spoken Email & Communication Guidelines:\n"
            "- Callers speak over the telephone, so speech-to-text might transcribe email addresses phonetically: words like 'at', 'added', 'at the rate', 'a' instead of '@', and 'dot' or 'point' instead of '.'. They may also spell out letters (e.g. 'n i s h a').\n"
            "- When the caller provides, spells, or updates their email address, acknowledge it immediately and confirm it back clearly (e.g., 'Thank you, I have noted your email as [email]. We will send your appointment confirmation there.').\n"
            "- If the caller asks you to confirm or verify the spelling of their email address, read back their recorded email address clearly.\n"
            "- Respond directly to the user's spoken input with a clear, friendly, and concise solution in 1 to 2 short sentences.\n"
            "- Do NOT use markdown formatting, bullet points, asterisks, or special characters. Speak directly and naturally to the caller."
        )
        messages = [{"role": "system", "content": system_content}]
        if conversation_history:
            for turn in conversation_history[-8:]:
                if turn.get("role") in ("user", "assistant") and turn.get("content"):
                    messages.append({"role": turn["role"], "content": turn["content"]})
        messages.append({"role": "user", "content": user_speech})

        payload = {
            "model": model_name,
            "messages": messages,
            "temperature": 0.4,
            "max_tokens": 100,
        }
        client = _get_groq_client()
        resp = await client.post(target_url, headers=req_headers, json=payload)
        latency_ms = int((time.perf_counter() - t0) * 1000)
        if resp.status_code == 200:
            data = resp.json()
            res_text = data["choices"][0]["message"]["content"].strip()
            if res_text:
                return res_text, latency_ms
        else:
            logger.warning(f"[Flow] LLM API returned status {resp.status_code}: {resp.text}")
    except Exception as e:
        logger.warning(f"[Flow] LLM live completion exception: {e}")
    return None, None


async def _check_and_execute_linked_tools(agent_id: str, speech_result: str, call_rec: Optional[CallORM], db: AsyncSession):
    """Accumulates user speech during call session."""
    if not call_rec:
        return
    try:
        up_meta = dict(call_rec.call_meta or {})
        history = list(up_meta.get("user_speech_history") or [])
        history.append(speech_result)
        up_meta["user_speech_history"] = history
        call_rec.call_meta = up_meta
        await db.commit()
    except Exception as exc:
        logger.warning(f"[Flow Tools] Error accumulating speech: {exc}")


def _extract_clean_slot(text: str) -> tuple[str, int, int, int]:
    """
    Extracts a clean, short slot (e.g. 'Tomorrow at 4:00 PM') and schedule time components.
    Returns: (slot_display_str, day_offset, hour_24, minute)
    """
    import re
    if not text:
        return "As requested on call", 1, 11, 0

    lower = text.lower()
    day_str = "Tomorrow"
    day_offset = 1
    if "today" in lower:
        day_str = "Today"
        day_offset = 0
    elif "day after tomorrow" in lower:
        day_str = "Day After Tomorrow"
        day_offset = 2
    else:
        for weekday, idx in [("monday", 0), ("tuesday", 1), ("wednesday", 2), ("thursday", 3), ("friday", 4), ("saturday", 5), ("sunday", 6)]:
            if weekday in lower:
                day_str = weekday.capitalize()
                now_weekday = datetime.utcnow().weekday()
                day_offset = (idx - now_weekday) % 7
                if day_offset == 0:
                    day_offset = 7
                break

    time_match = re.search(r'\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)(?:\b|\s|[.,]|$)', lower)
    hour = 11
    minute = 0
    time_str = ""
    if time_match:
        h = int(time_match.group(1))
        m = int(time_match.group(2) or 0)
        meridiem = time_match.group(3).replace('.', '').upper()
        time_str = f"{h}:{m:02d} {meridiem}"
        if meridiem == "PM" and h < 12:
            h += 12
        elif meridiem == "AM" and h == 12:
            h = 0
        hour = h
        minute = m
    elif "morning" in lower:
        time_str = "10:00 AM"
        hour = 10
    elif "afternoon" in lower:
        time_str = "2:00 PM"
        hour = 14
    elif "evening" in lower:
        time_str = "5:00 PM"
        hour = 17

    slot_display = f"{day_str} at {time_str}" if time_str else day_str
    return slot_display, day_offset, hour, minute


async def _append_call_summary_to_sheets(call: Any, db: Optional[AsyncSession] = None):
    """Appends EXACTLY 1 clean summary lead row per call session upon call completion."""
    from app.db.session import AsyncSessionLocal
    import traceback

    call_id = call.id if hasattr(call, "id") else str(call)
    logger.info(f"[Summary] Processing post-call sync for call_id={call_id}")

    async with AsyncSessionLocal() as session:
        try:
            # Re-fetch the call object fresh inside this session to prevent DetachedInstanceError
            call_obj = await session.get(CallORM, call_id)
            if not call_obj:
                logger.error(f"[Summary] Call {call_id} not found in database.")
                return

            # Resolve Agent
            ag = None
            if call_obj.agent_id:
                res = await session.execute(
                    select(AgentORM).options(selectinload(AgentORM.tools)).where(AgentORM.id == call_obj.agent_id)
                )
                ag = res.scalar_one_or_none()

            if not ag:
                # Fallback to latest agent
                ag_res = await session.execute(
                    select(AgentORM).options(selectinload(AgentORM.tools)).order_by(AgentORM.created_at.desc()).limit(1)
                )
                ag = ag_res.scalar_one_or_none()

            agent_name = ag.agent_name if ag else "Voice Assistant"

            # Resolve User Speech / Conversation
            meta = dict(call_obj.call_meta or {})
            history = meta.get("user_speech_history") or []
            full_user_speech = " ".join(history).strip()

            if not full_user_speech:
                conv = meta.get("conversation_history") or []
                user_turns = [m.get("content", "") for m in conv if isinstance(m, dict) and m.get("role") == "user"]
                full_user_speech = " ".join(user_turns).strip()

            if not full_user_speech:
                full_user_speech = "Voice call appointment consultation"
                logger.info(f"[Summary] Using fallback speech description for call {call_id}")

            # Parse Patient Name
            import re
            name_match = re.search(r'(?:my full name is|full name is|my name is|name is|i am|this is)\s+([a-zA-Z\s]+?)(?:\s+and|\s+i|\s+my|\.|$)', full_user_speech, re.IGNORECASE)
            cust_name = name_match.group(1).strip().title() if name_match else "Caller"

            # Parse Service / Inquiry Topic
            specialty = f"{agent_name} Consultation"
            lower_speech = full_user_speech.lower()
            if any(w in lower_speech for w in ["property", "flat", "apartment", "bhk", "villa", "real estate", "site visit"]):
                specialty = "Real Estate Site Visit"
            elif any(w in lower_speech for w in ["order", "product", "delivery", "shipping", "refund", "return", "cart", "ecommerce", "e-commerce", "exchange", "tracking", "item", "purchase"]):
                specialty = "E-Commerce Order & Customer Support"
            elif any(w in lower_speech for w in ["demo", "software", "saas", "tech", "platform", "cloud"]):
                specialty = "Product Demo & Tech Discussion"
            elif any(w in lower_speech for w in ["car", "drive", "test drive", "vehicle", "automobile"]):
                specialty = "Test Drive Booking"
            elif any(w in lower_speech for w in ["dent", "teeth", "tooth"]):
                specialty = "Dental Care"
            elif any(w in lower_speech for w in ["cardiol", "heart"]):
                specialty = "Cardiology"
            elif any(w in lower_speech for w in ["legal", "lawyer", "law"]):
                specialty = "Legal Consultation"
            elif any(w in lower_speech for w in ["finance", "tax", "loan", "investment"]):
                specialty = "Financial Advisory"
            elif any(w in lower_speech for w in ["general", "consult", "meeting", "checkup"]):
                specialty = "Client Consultation"

            # Parse Slot / Date requested cleanly (e.g. 'Tomorrow at 4:00 PM')
            slot_text, day_offset, sched_hour, sched_minute = _extract_clean_slot(full_user_speech)

            now_str = (call_obj.started_at or datetime.utcnow()).strftime("%Y-%m-%d %H:%M:%S")
            phone_num = call_obj.to_number or call_obj.from_number or "Unknown"

            from app.services.agent_metadata_service import _resolve_tool_token
            from app.models.orm import ToolORM
            from sqlalchemy.orm.attributes import flag_modified

            sheets_result = None
            cal_result = None
            gmail_result = None
            recipient_used = None

            # --- 1. GOOGLE SHEETS ---
            sheets_tool = next((t for t in ag.tools if t.tool_type == "SHEETS"), None) if (ag and ag.tools) else None
            if not sheets_tool:
                s_res = await session.execute(
                    select(ToolORM).where(ToolORM.tool_type == "SHEETS").order_by(ToolORM.created_at.desc())
                )
                sheets_tool = s_res.scalars().first()

            if sheets_tool:
                token = await _resolve_tool_token(sheets_tool, session)
                if token:
                    spreadsheet_id = sheets_tool.config.get("spreadsheetId")
                    if spreadsheet_id:
                        range_name = sheets_tool.config.get("range", "A1") or "A1"
                        dur = int(call_obj.duration_seconds or 0)
                        summary_row = [
                            now_str,
                            cust_name,
                            phone_num,
                            specialty,
                            slot_text,
                            f"Completed ({dur}s)"
                        ]
                        from agent.tools.google_sheets import append_row
                        sheets_result = await append_row(token, spreadsheet_id, range_name, summary_row)
                        logger.info(f"[Summary Sheet] Appended 1 clean session row for call {call_obj.id}: {sheets_result}")
                    else:
                        sheets_result = f"Error: sheets_tool {sheets_tool.id} has no spreadsheetId configured"
                        logger.error(f"[Summary Sheet] {sheets_result}")
                else:
                    sheets_result = f"Error: could not resolve OAuth token for sheets tool {sheets_tool.id}"
                    logger.error(f"[Summary Sheet] {sheets_result}")
            else:
                sheets_result = "Warning: no SHEETS tool found in workspace"
                logger.warning(f"[Summary Sheet] {sheets_result}")

            # --- 2. GOOGLE CALENDAR ---
            cal_tool = next((t for t in ag.tools if t.tool_type == "CALENDAR"), None) if (ag and ag.tools) else None
            if not cal_tool:
                c_res = await session.execute(
                    select(ToolORM).where(ToolORM.tool_type == "CALENDAR").order_by(ToolORM.created_at.desc())
                )
                cal_tool = c_res.scalars().first()

            if cal_tool:
                cal_token = await _resolve_tool_token(cal_tool, session)
                if cal_token:
                    calendar_id = cal_tool.config.get("calendarId", "primary") or "primary"
                    summary_title = f"{agent_name} - {specialty} ({cust_name})"
                    start_time_str = (datetime.utcnow() + timedelta(days=day_offset)).replace(hour=sched_hour, minute=sched_minute, second=0).strftime("%Y-%m-%d %H:%M:%S")
                    cal_desc = (
                        f"Client Name: {cust_name}\n"
                        f"Phone: {phone_num}\n"
                        f"Service: {specialty}\n"
                        f"Scheduled Slot: {slot_text}\n"
                        f"Status: Confirmed via Voice Call"
                    )
                    from agent.tools.google_calendar import schedule_event
                    cal_result = await schedule_event(cal_token, calendar_id, summary_title, start_time_str, 30, cal_desc)
                    logger.info(f"[Summary Calendar] Appended Google Calendar event: {cal_result}")
                else:
                    cal_result = f"Error: could not resolve OAuth token for cal_tool {cal_tool.id}"
                    logger.error(f"[Summary Calendar] {cal_result}")
            else:
                cal_result = "Warning: no CALENDAR tool found in workspace"
                logger.warning(f"[Summary Calendar] {cal_result}")

            # --- 3. GMAIL ---
            gmail_tool = next((t for t in ag.tools if t.tool_type == "GMAIL"), None) if (ag and ag.tools) else None
            target_user_id = call_obj.user_id or (ag.user_id if ag else None)
            if not gmail_tool:
                tool_res = await session.execute(
                    select(ToolORM).where(ToolORM.tool_type == "GMAIL").order_by(ToolORM.created_at.desc())
                )
                gmail_tool = tool_res.scalars().first()

            if gmail_tool:
                recipient = meta.get("captured_email")
                if not recipient:
                    recipient = await _extract_spoken_email(full_user_speech)
                if not recipient:
                    email_match = re.search(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', full_user_speech)
                    if email_match:
                        recipient = email_match.group(0)

                # Fallback to account user email so the business gets the recap even if caller didn't speak email
                if not recipient and target_user_id:
                    user_res = await session.execute(select(UserORM).where(UserORM.id == target_user_id))
                    u = user_res.scalar_one_or_none()
                    if u and u.email:
                        recipient = u.email

                if not recipient:
                    any_user_res = await session.execute(
                        select(UserORM).where(UserORM.email.isnot(None)).order_by(UserORM.created_at.asc()).limit(1)
                    )
                    any_u = any_user_res.scalar_one_or_none()
                    if any_u and any_u.email:
                        recipient = any_u.email

                recipient_used = recipient

                if recipient:
                    gmail_token = await _resolve_tool_token(gmail_tool, session)
                    if gmail_token:
                        from agent.tools.gmail import send_email
                        mail_subj = f"Appointment Confirmation: {specialty} - {agent_name}"
                        mail_body = (
                            f"<div style='font-family: Arial, sans-serif; color: #222; max-width: 600px; line-height: 1.6;'>"
                            f"<p>Hello <b>{cust_name}</b>,</p>"
                            f"<p>Thank you for speaking with <b>{agent_name}</b>. Here are your confirmed appointment details:</p>"
                            f"<table style='width: 100%; border-collapse: collapse; margin: 16px 0; border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden;'>"
                            f"<tr style='background-color: #f8f9fa; border-bottom: 1px solid #e0e0e0;'><td style='padding: 10px 14px; color: #666; width: 140px;'><b>Service</b></td><td style='padding: 10px 14px; font-weight: bold;'>{specialty}</td></tr>"
                            f"<tr style='border-bottom: 1px solid #e0e0e0;'><td style='padding: 10px 14px; color: #666;'><b>Scheduled Slot</b></td><td style='padding: 10px 14px; color: #1a73e8; font-weight: bold;'>{slot_text}</td></tr>"
                            f"<tr style='border-bottom: 1px solid #e0e0e0;'><td style='padding: 10px 14px; color: #666;'><b>Contact Phone</b></td><td style='padding: 10px 14px;'>{phone_num}</td></tr>"
                            f"<tr><td style='padding: 10px 14px; color: #666;'><b>Status</b></td><td style='padding: 10px 14px; color: #0d904f; font-weight: bold;'>Confirmed</td></tr>"
                            f"</table>"
                            f"<p>If you have any questions or need to reschedule, simply reply directly to this email.</p>"
                            f"<br><p>Best regards,<br><b>{agent_name} Team</b></p>"
                            f"</div>"
                        )
                        gmail_result = await send_email(gmail_token, recipient, mail_subj, mail_body)
                        logger.info(f"[Summary Gmail] Dispatched post-call recap email to {recipient}: {gmail_result}")
                    else:
                        gmail_result = f"Error: could not resolve OAuth token for gmail tool {gmail_tool.id}"
                        logger.error(f"[Summary Gmail] {gmail_result}")
                else:
                    gmail_result = "Warning: no recipient email could be resolved"
                    logger.warning(f"[Summary Gmail] {gmail_result} for call {call_obj.id}")
            else:
                gmail_result = "Warning: no GMAIL tool found in workspace"
                logger.warning(f"[Summary Gmail] {gmail_result}")

            # Save sync outcome to call metadata
            meta["sync_results"] = {
                "sheets": sheets_result,
                "calendar": cal_result,
                "gmail": gmail_result,
                "recipient": recipient_used,
            }
            call_obj.call_meta = meta
            flag_modified(call_obj, "call_meta")
            await session.commit()

            return {
                "call_id": call_obj.id,
                "agent_name": agent_name,
                "customer_name": cust_name,
                "specialty": specialty,
                "slot_text": slot_text,
                "sheets": sheets_result,
                "calendar": cal_result,
                "gmail": gmail_result,
                "recipient": recipient_used,
            }
        except Exception as exc:
            err_msg = f"Exception in sheet summary logging: {exc}\n{traceback.format_exc()}"
            logger.error(f"[Summary Sheet] {err_msg}")
            return {"error": err_msg}


@router.post("/flow")
@router.get("/flow")
async def twilio_outbound_flow(
    agent_id: str,
    room: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """
    Invoked by Twilio when the called party answers.

    Looks up the from_number from the call record (to get the right Twilio
    number), then returns TwiML that bridges the call into LiveKit SIP.

    For trial accounts: handles speech input from <Gather> or serves demo TwiML.
    For paid accounts: returns <Dial><Sip> directly — no extra round-trip.
    """
    logger.info(f"[Flow] Twilio flow callback: agent={agent_id} room={room}")

    try:
        # Resolve from_number from call record — needed to build the SIP URI.
        call_rec = None
        for attempt in range(5):
            await db.execute(select(CallORM).where(CallORM.session_id == room))  # warm connection
            call_result = await db.execute(
                select(CallORM).where(CallORM.session_id == room)
            )
            call_rec = call_result.scalar_one_or_none()
            if call_rec:
                break
            logger.warning(
                f"[Flow] Call record not found yet for room={room} "
                f"(attempt {attempt + 1}/5) — retrying in 300ms"
            )
            await asyncio.sleep(0.3)

        if not call_rec:
            logger.warning(f"[Flow] Call record lookup pending for room={room}. Proceeding with agent={agent_id}.")

        sip_number = (call_rec.from_number if call_rec else None) or os.getenv("FALLBACK_FROM_NUMBER", "+15822679744")
        if not sip_number.startswith("+"):
            sip_number = f"+{sip_number}"

        from app.core.config import settings
        lk_sip_domain = settings.LIVEKIT_SIP_DOMAIN
        lk_sip_username = os.getenv("LIVEKIT_SIP_USERNAME", "")
        lk_sip_password = os.getenv("LIVEKIT_SIP_PASSWORD", "")
        auth_attr = ""
        if lk_sip_username and lk_sip_password:
            auth_attr = f' username="{lk_sip_username}" password="{lk_sip_password}"'

        # Use TLS on port 5061 — required for LiveKit Cloud SIP
        sip_uri = f"sip:{sip_number}@{lk_sip_domain};transport=tcp"

        is_trial = os.getenv("TWILIO_TRIAL_ACCOUNT", "true").lower() == "true"
        if is_trial:
            # Check if caller spoke into <Gather>
            speech_result = None
            try:
                form_data = await request.form()
                speech_result = form_data.get("SpeechResult") or form_data.get("Speech")
            except Exception:
                pass

            agent_name = "VoiceForge Agent"
            sys_prompt = ""
            agent_desc = ""
            first_msg = ""
            target_agent_id = (call_rec.agent_id if call_rec and call_rec.agent_id else None) or agent_id
            if target_agent_id:
                from app.models.orm import AgentORM
                agent_res = await db.execute(select(AgentORM).where(AgentORM.id == target_agent_id))
                ag = agent_res.scalar_one_or_none()
                if ag:
                    if ag.agent_name:
                        agent_name = ag.agent_name
                    if ag.prompt:
                        sys_prompt = ag.prompt.strip()
                    if ag.description:
                        agent_desc = ag.description.strip()
                    if ag.config and isinstance(ag.config, dict):
                        first_msg = ag.config.get("first_message", "").strip()

            is_real_estate = "real estate" in sys_prompt.lower() or "closer" in sys_prompt.lower() or "property" in sys_prompt.lower()
            is_tech_support = "tech" in sys_prompt.lower() or "support" in sys_prompt.lower() or "engineer" in sys_prompt.lower() or "issue" in sys_prompt.lower() or "tech_support" in agent_name.lower()

            # Build dynamic self-introduction for ANY present or future agent
            if first_msg and len(first_msg) > 3:
                intro_msg = f"Hello! This is {agent_name} calling from VoiceForge. {first_msg}"
            elif agent_desc and len(agent_desc) > 3:
                intro_msg = f"Hello! This is {agent_name} calling from VoiceForge. I am {agent_desc}. How can I help you today?"
            elif sys_prompt:
                prompt_summary = sys_prompt.split("\n")[0].replace("You are ", "").replace("# Persona & Role", "").strip()
                if prompt_summary:
                    intro_msg = f"Hello! This is {agent_name} calling from VoiceForge. {prompt_summary}. How can I assist you today?"
                else:
                    intro_msg = f"Hello! This is {agent_name} calling you from VoiceForge. How can I help you today?"
            else:
                intro_msg = f"Hello! This is {agent_name} calling you from VoiceForge. How can I help you today?"

            if speech_result:
                lower_speech = speech_result.lower()

                # Get existing call metadata and conversation history
                call_meta = dict(call_rec.call_meta or {}) if call_rec else {}
                speech_history = list(call_meta.get("user_speech_history") or [])
                speech_history.append(speech_result)
                call_meta["user_speech_history"] = speech_history

                conversation_history = list(call_meta.get("conversation_history") or [])
                captured_email = call_meta.get("captured_email")

                # Detect if caller spoke or updated their email address
                extracted_email = await _extract_spoken_email(speech_result)
                if extracted_email:
                    captured_email = extracted_email
                    call_meta["captured_email"] = captured_email
                    logger.info(f"[Flow] Detected spoken email in turn: {captured_email}")

                # 1. Universal Handle for Polite Closing / Thank You / Bye across ALL agents
                if any(w in lower_speech for w in ["thank", "thanks", "bye", "goodbye", "that is all", "that's all", "solved", "all good", "done", "no help", "no thanks"]):
                    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Aditi" language="en-IN">You are very welcome! I am glad {agent_name} could assist you today. Have a wonderful day! Goodbye.</Say>
</Response>"""
                    if call_rec:
                        call_rec.call_meta = call_meta
                        await db.commit()
                    logger.info(f"[Flow] Trial path: user said '{speech_result}', ending call gracefully for agent '{agent_name}'")
                    return Response(content=twiml, media_type="text/xml")

                # 2. Live Dynamic Groq LLM Completion (generates REAL answers with multi-turn memory!)
                reply, lat_ms = await _generate_groq_llm_reply(
                    agent_name,
                    sys_prompt,
                    speech_result,
                    conversation_history=conversation_history,
                    captured_email=captured_email
                )
                if call_rec:
                    if lat_ms:
                        call_meta["avg_response_latency_ms"] = lat_ms
                    conversation_history.append({"role": "user", "content": speech_result})
                    if reply:
                        conversation_history.append({"role": "assistant", "content": reply})
                    call_meta["conversation_history"] = conversation_history
                    call_rec.call_meta = call_meta
                    await db.commit()

                # 3. Fallback if LLM request blips
                if not reply:
                    if is_tech_support:
                        if any(w in lower_speech for w in ["500", "server", "backend", "database"]):
                            reply = "Error 500 indicates a backend database connection timeout. Verify your database URL and restart the service."
                        else:
                            reply = "I recommend clearing your session storage, verifying your backend configuration in dot env, and restarting your server."
                    elif is_real_estate:
                        reply = "We have luxury 2BHK and 3BHK apartments starting at 50 lakhs in prime locations. What budget range are you planning?"
                    else:
                        reply = f"I am {agent_name}. I have processed your request. How else can I assist you?"

                twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" timeout="10" speechTimeout="auto">
        <Say voice="Polly.Aditi" language="en-IN">{reply}</Say>
    </Gather>
    <Gather input="speech" timeout="10" speechTimeout="auto">
        <Say voice="Polly.Aditi" language="en-IN">I am still here to assist you. Please let me know your next technical question.</Say>
    </Gather>
    <Say voice="Polly.Aditi" language="en-IN">Thank you for speaking with {agent_name}. Goodbye!</Say>
</Response>"""
                logger.info(f"[Flow] Trial path: user spoke '{speech_result}', responded fast with '{reply}' and robust Gather fallback")
                return Response(content=twiml, media_type="text/xml")

            twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" timeout="10" speechTimeout="auto">
        <Say voice="Polly.Aditi" language="en-IN">{intro_msg}</Say>
    </Gather>
    <Gather input="speech" timeout="10" speechTimeout="auto">
        <Say voice="Polly.Aditi" language="en-IN">I am still here to assist you. Please state your issue or question whenever you are ready.</Say>
    </Gather>
    <Say voice="Polly.Aditi" language="en-IN">Thank you for speaking with {agent_name}. Goodbye!</Say>
</Response>"""
            logger.info(f"[Flow] Trial path: serving initial robust introduction TwiML for agent '{agent_name}'")
            return Response(content=twiml, media_type="text/xml")

        # Paid account — bridge directly to LiveKit SIP URI
        twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial>
        <Sip{auth_attr}>{sip_uri}</Sip>
    </Dial>
</Response>"""
        logger.info(f"[Flow] Paid path: bridging {sip_number} → {lk_sip_domain}")
        return Response(content=twiml, media_type="text/xml")

    except Exception as exc:
        logger.error(f"[Flow] Exception in twilio_outbound_flow: {exc}")
        twiml = """<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather input="speech" timeout="10" speechTimeout="auto">
        <Say voice="Polly.Aditi" language="en-IN">Hello! This is your VoiceForge agent calling. How can I help you today?</Say>
    </Gather>
</Response>"""
        return Response(content=twiml, media_type="text/xml")


@router.post("/flow-bridge")
@router.get("/flow-bridge")
async def twilio_flow_bridge(
    agent_id: str,
    room: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Trial-account only: Twilio POSTs here after <Gather> timeout expires.
    Returns the final <Dial><Sip> TwiML to bridge into LiveKit.
    Paid accounts never reach this endpoint — they bridge in /flow directly.
    """
    logger.info(f"[FlowBridge] Trial bridge: agent={agent_id} room={room}")

    call_rec = None
    for attempt in range(5):
        call_result = await db.execute(
            select(CallORM).where(CallORM.session_id == room)
        )
        call_rec = call_result.scalar_one_or_none()
        if call_rec:
            break
        logger.warning(
            f"[FlowBridge] Call record not found yet for room={room} "
            f"(attempt {attempt + 1}/5) — retrying in 300ms"
        )
        await asyncio.sleep(0.3)

    if not call_rec:
        logger.error(f"[FlowBridge] No call record found for room={room} after 5 attempts. Hanging up.")
        return Response(
            content=_twiml_hangup("Call session not found."),
            media_type="application/xml",
        )

    sip_number = call_rec.from_number or os.getenv("FALLBACK_FROM_NUMBER", "+10000000000")
    if not sip_number.startswith("+"):
        sip_number = f"+{sip_number}"

    from app.core.config import settings
    lk_sip_domain = settings.LIVEKIT_SIP_DOMAIN
    lk_sip_username = os.getenv("LIVEKIT_SIP_USERNAME", "")
    lk_sip_password = os.getenv("LIVEKIT_SIP_PASSWORD", "")
    auth_attr = ""
    if lk_sip_username and lk_sip_password:
        auth_attr = f' username="{lk_sip_username}" password="{lk_sip_password}"'

    is_trial = os.getenv("TWILIO_TRIAL_ACCOUNT", "true").lower() == "true"
    if is_trial:
        agent_name = "VoiceForge Agent"
        if call_rec and call_rec.agent_id:
            from app.models.orm import AgentORM
            agent_res = await db.execute(select(AgentORM).where(AgentORM.id == call_rec.agent_id))
            ag = agent_res.scalar_one_or_none()
            if ag and ag.agent_name:
                agent_name = ag.agent_name
        
        twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="Polly.Aditi" language="en-IN">Hello! This is {agent_name} calling you from VoiceForge. How can I help you today?</Say>
    <Pause length="1"/>
    <Gather input="speech" timeout="5" speechTimeout="auto">
        <Say voice="Polly.Aditi" language="en-IN">I am listening, please speak now.</Say>
    </Gather>
    <Say voice="Polly.Aditi" language="en-IN">Thank you for speaking with {agent_name}. Have a great day! Goodbye.</Say>
</Response>"""
        logger.info(f"[FlowBridge] Trial account path: serving interactive speech TwiML for agent '{agent_name}'")
        return Response(content=twiml, media_type="application/xml")

    # Paid account — bridge via LiveKit Cloud SIP URI
    twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Dial>
        <Sip{auth_attr}>sip:{sip_number}@{lk_sip_domain};transport=tcp</Sip>
    </Dial>
</Response>"""

    logger.info(f"[FlowBridge] Bridging {sip_number} → {lk_sip_domain}")
    return Response(content=twiml, media_type="application/xml")


# ─── STATUS CALLBACK (REAL-TIME CALL STATUS / DURATION FROM TWILIO) ─────────

# Maps Twilio's CallStatus values to our internal call.status vocabulary.
_TWILIO_STATUS_MAP = {
    "queued": "connecting",
    "initiated": "connecting",
    "ringing": "ringing",
    "in-progress": "active",
    "completed": "completed",
    "busy": "no_answer",
    "no-answer": "no_answer",
    "failed": "failed",
    "canceled": "failed",
}

# Terminal statuses — once we land here for a call, stop accepting updates.
_TERMINAL_STATUSES = {"completed", "no_answer", "failed"}


@router.post("/status-callback")
async def twilio_status_callback(
    request: Request,
    CallSid: str = Form(...),
    CallStatus: str = Form(...),
    CallDuration: str = Form(default=""),
    db: AsyncSession = Depends(get_db),
):
    """
    Twilio's native StatusCallback webhook — the authoritative, real-time
    source of call status and duration for the Twilio REST fallback path.

    Why this exists (and why LiveKit's own webhook isn't enough here):
    For the trial/fallback outbound path, LiveKit's SIP gateway creates its
    OWN room when Twilio bridges the call in (a name we never chose and
    can't predict), so LiveKit's `room_finished` webhook can't be matched
    back to our CallORM row by session_id — that mismatch is why
    duration_seconds/status were staying at their initial 0/"initiated"
    values forever. Twilio, by contrast, always identifies the call by its
    CallSid, which we captured at call-creation time — so it's a reliable
    correlation key regardless of what LiveKit does internally.

    Twilio sends this on every status transition we subscribed to
    (initiated, ringing, answered, completed) — `CallDuration` (seconds) is
    only populated once the call has actually ended, on the `completed`
    (and busy/no-answer/failed/canceled) events.
    """
    # ── 1. Idempotency — Twilio retries webhooks that don't respond fast/2xx ──
    # Keyed by (CallSid, CallStatus) since the SAME CallSid legitimately fires
    # multiple different statuses over the life of one call.
    idem_key = f"{CallSid}:{CallStatus}"
    if await idempotency_store.is_seen("twilio_status", idem_key):
        return Response(status_code=200)
    await idempotency_store.mark_seen("twilio_status", idem_key)

    # ── 2. Look up the call by CallSid (NOT session_id — see docstring) ──────
    result = await db.execute(select(CallORM).where(CallORM.twilio_call_sid == CallSid))
    call = result.scalar_one_or_none()
    if not call:
        logger.warning(f"[StatusCallback] No call found for CallSid={CallSid} (status={CallStatus})")
        return Response(status_code=200)  # 200 so Twilio doesn't retry forever

    if call.status in _TERMINAL_STATUSES:
        return Response(status_code=200)  # already finalized, ignore late/dup events

    # ── 3. Verify signature using the owning user's Twilio auth token ───────
    twilio_sig = request.headers.get("X-Twilio-Signature", "")
    if twilio_sig:
        user_result = await db.execute(select(UserORM).where(UserORM.id == call.user_id))
        user = user_result.scalar_one_or_none()
        if user and user.secrets and user.secrets.get("twilio_auth_token"):
            try:
                auth_token = vault.decrypt(user.secrets["twilio_auth_token"])
                form_params = dict((await request.form()))
                if not _verify_twilio_signature(auth_token, str(request.url), form_params, twilio_sig):
                    logger.warning(f"[StatusCallback] Signature verification FAILED for CallSid={CallSid}")
                    return Response(status_code=403)
            except Exception as sig_exc:
                logger.warning(f"[StatusCallback] Could not verify signature: {sig_exc}")

    # ── 4. Apply the update ──────────────────────────────────────────────────
    new_status = _TWILIO_STATUS_MAP.get(CallStatus, call.status)
    call.status = new_status

    if new_status in _TERMINAL_STATUSES:
        # NOTE: calls.ended_at is TIMESTAMP WITHOUT TIME ZONE (naive), same
        # as started_at (set via datetime.utcnow() at call creation). Writing
        # a timezone-aware datetime.now(timezone.utc) here makes asyncpg
        # raise "can't subtract offset-naive and offset-aware datetimes" on
        # commit — which meant the call would get stuck one event short of
        # "completed"/duration_seconds ever being saved. Use a naive UTC
        # timestamp to match the column type.
        call.ended_at = datetime.utcnow()
        if CallDuration:
            try:
                call.duration_seconds = float(CallDuration)
            except ValueError:
                logger.warning(f"[StatusCallback] Non-numeric CallDuration={CallDuration!r} for CallSid={CallSid}")

    await db.commit()
    if new_status in _TERMINAL_STATUSES:
        asyncio.create_task(_append_call_summary_to_sheets(call, db))

    logger.info(
        f"[StatusCallback] call_id={call.id} CallSid={CallSid} "
        f"TwilioStatus={CallStatus} → status={new_status} duration={call.duration_seconds}s"
    )
    return Response(status_code=200)


# ─── HELPERS ─────────────────────────────────────────────────────────────────

def _twiml_hangup(message: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="alice">{message}</Say>
    <Hangup />
</Response>"""