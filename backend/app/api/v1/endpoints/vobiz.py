"""
Vobiz Telephony Endpoints — Inbound & Outbound Voice Agent Webhooks for Vobiz.

Vobiz uses VobizXML:
  - <Speak voice="Polly.Aditi" language="en-IN">...</Speak>
  - <Gather action="..." method="POST" inputType="speech" executionTimeout="8">...</Gather>
  - <Hangup/>

Outbound Call API:
  - POST https://api.vobiz.ai/api/v1/Account/{auth_id}/Call/
  - Headers: X-Auth-ID, X-Auth-Token, Content-Type: application/json
  - Body: {"from": "+918065354620", "to": "+91...", "answer_url": "...", "answer_method": "POST"}

When a caller answers an outbound call or dials in:
  1. Vobiz sends an HTTP POST/GET to the Answer URL (/flow).
  2. Our backend resolves the agent (Maya / Healthcare Receptionist),
     and returns VobizXML greeting with <Gather inputType="speech">.
  3. When the caller speaks, Vobiz sends POST to the action URL (/flow) with `Speech`.
  4. Groq / OpenRouter generates an ultra-fast dynamic LLM response (~150ms).
  5. Spoken emails are normalized, and appointments are automatically saved to Google Sheets,
     Google Calendar, and Gmail!
"""

import os
import re
import time
import uuid
import logging
import html
from typing import Optional, Dict, Any, List
from datetime import datetime

import httpx
from pydantic import BaseModel
from fastapi import APIRouter, Depends, Request, Response, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.orm import UserORM, AgentORM, CallORM, CallDirection, PhoneNumberORM
from app.api.v1.endpoints.twilio import (
    _generate_groq_llm_reply,
    _extract_spoken_email,
    _check_and_execute_linked_tools,
    _append_call_summary_to_sheets,
)

logger = logging.getLogger("vobiz")
router = APIRouter()


def _xml_escape(val: Any) -> str:
    """Escapes XML entities (&, <, >, quotes) to prevent parser syntax errors in VobizXML."""
    if val is None:
        return ""
    s = html.unescape(str(val))
    return (
        s.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&apos;")
    )


class VobizOutboundRequest(BaseModel):
    to_number: str
    from_number: Optional[str] = None
    agent_id: Optional[str] = None
    vobiz_auth_id: Optional[str] = None
    vobiz_auth_token: Optional[str] = None


async def _resolve_agent_for_number(dialed_number: str, db: AsyncSession) -> Optional[AgentORM]:
    """Finds the agent assigned to this phone number, with fallback to Maya or latest agent."""
    clean_num = dialed_number.strip().lstrip("+").replace(" ", "")
    
    stmt = (
        select(PhoneNumberORM)
        .options(selectinload(PhoneNumberORM.user))
        .where(
            (PhoneNumberORM.number == dialed_number) |
            (PhoneNumberORM.number == clean_num) |
            (PhoneNumberORM.number == f"+{clean_num}")
        )
    )
    result = await db.execute(stmt)
    db_number = result.scalar_one_or_none()
    
    if db_number and db_number.agent_id:
        agent_res = await db.execute(
            select(AgentORM).options(selectinload(AgentORM.tools)).where(AgentORM.id == db_number.agent_id)
        )
        agent = agent_res.scalar_one_or_none()
        if agent:
            return agent

    # Fallback 1: Look for Maya (Healthcare Agent)
    maya_res = await db.execute(
        select(AgentORM).options(selectinload(AgentORM.tools)).where(AgentORM.agent_name.ilike("%maya%")).limit(1)
    )
    maya = maya_res.scalar_one_or_none()
    if maya:
        logger.info(f"[Vobiz] Number {dialed_number} mapped to Maya by fallback")
        return maya

    # Fallback 2: Any active agent
    latest_res = await db.execute(
        select(AgentORM).options(selectinload(AgentORM.tools)).order_by(AgentORM.created_at.desc()).limit(1)
    )
    latest_agent = latest_res.scalar_one_or_none()
    if latest_agent:
        logger.info(f"[Vobiz] Number {dialed_number} mapped to latest agent: {latest_agent.agent_name}")
        return latest_agent

    return None


# ─── OUTBOUND CALL TRIGGER ───────────────────────────────────────────────────

async def _trigger_vobiz_outbound_internal(
    *,
    to_number: str,
    agent_id: Optional[str] = None,
    current_user: Optional[UserORM] = None,
    db: AsyncSession,
    from_number: Optional[str] = None,
    auth_id: Optional[str] = None,
    auth_token: Optional[str] = None,
) -> dict:
    """
    Triggers an outbound call using Vobiz REST API.
    
    1. Resolves Vobiz Auth ID and Auth Token.
    2. Resolves Agent (Maya / Healthcare Receptionist).
    3. Creates CallORM record in Postgres.
    4. Calls Vobiz REST API: POST https://api.vobiz.ai/api/v1/Account/{auth_id}/Call/
    5. Returns call details.
    """
    auth_id = (
        auth_id
        or os.getenv("VOBIZ_AUTH_ID")
        or (current_user.secrets.get("vobiz_auth_id") if current_user and current_user.secrets else None)
        or "MA_TKTZ7MH7"
    )
    auth_token = (
        auth_token
        or os.getenv("VOBIZ_AUTH_TOKEN")
        or (current_user.secrets.get("vobiz_auth_token") if current_user and current_user.secrets else None)
        or "J6vWO6Gl6FlMjLOZcC4F63v83vCUPb52u6tIrvB0WVp4UipzcYDIQzwqGbSKo1RR"
    )

    if not auth_token:
        raise HTTPException(
            status_code=400,
            detail=(
                "Vobiz Auth Token not configured. Please provide vobiz_auth_token in request "
                "or set VOBIZ_AUTH_TOKEN in environment variables."
            ),
        )

    # Clean numbers
    to_number = "".join(to_number.split())
    if not to_number.startswith("+"):
        to_number = "+" + to_number

    from_number = (from_number or os.getenv("VOBIZ_PHONE_NUMBER") or "+918065354620").strip()
    if not from_number.startswith("+"):
        from_number = "+" + from_number

    # Resolve agent
    agent = None
    if agent_id:
        ag_res = await db.execute(
            select(AgentORM).options(selectinload(AgentORM.tools)).where(AgentORM.id == agent_id)
        )
        agent = ag_res.scalar_one_or_none()

    if not agent:
        agent = await _resolve_agent_for_number(from_number, db)

    room_name = f"vobiz_outbound_{uuid.uuid4().hex[:8]}"
    db_call = CallORM(
        id=str(uuid.uuid4()),
        user_id=current_user.id if current_user else (agent.user_id if agent else None),
        agent_id=agent.id if agent else None,
        session_id=room_name,
        from_number=from_number,
        to_number=to_number,
        direction=CallDirection.OUTBOUND,
        status="connecting",
        call_meta={
            "provider": "vobiz",
            "conversation_history": [],
            "user_speech_history": [],
        },
    )
    db.add(db_call)
    await db.commit()
    await db.refresh(db_call)

    # Base URL for Webhooks
    base_url = os.getenv("BACKEND_URL", "https://ai-voice-agent-production-3d0d.up.railway.app").rstrip("/")
    answer_url = f"{base_url}/api/v1/telephony/vobiz/flow?call_id={db_call.id}"
    hangup_url = f"{base_url}/api/v1/telephony/vobiz/status-callback?call_id={db_call.id}"

    vobiz_url = f"https://api.vobiz.ai/api/v1/Account/{auth_id}/Call/"
    headers = {
        "X-Auth-ID": auth_id,
        "X-Auth-Token": auth_token,
        "Content-Type": "application/json",
    }
    vobiz_payload = {
        "from": from_number,
        "to": to_number,
        "answer_url": answer_url,
        "answer_method": "POST",
        "hangup_url": hangup_url,
        "hangup_method": "POST",
    }

    logger.info(f"[Vobiz Outbound] Dispatching call from {from_number} to {to_number} via Vobiz API: {vobiz_url}")
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(vobiz_url, headers=headers, json=vobiz_payload)

        if resp.status_code in (200, 201):
            data = resp.json()
            req_uuid = data.get("request_uuid") or data.get("api_id")
            if req_uuid:
                db_call.session_id = req_uuid
            db_call.status = "in-progress"
            await db.commit()
            logger.info(f"[Vobiz Outbound] Call initiated successfully: request_uuid={req_uuid}")
            return {
                "status": "calling",
                "call_id": db_call.id,
                "request_uuid": req_uuid,
                "from": from_number,
                "to": to_number,
                "agent_name": agent.agent_name if agent else "Voice Assistant",
                "message": f"Calling {to_number} from {agent.agent_name if agent else 'Voice Assistant'} ({from_number})...",
            }
        else:
            logger.error(f"[Vobiz Outbound] Error from Vobiz API: {resp.status_code} - {resp.text}")
            db_call.status = "failed"
            await db.commit()
            raise HTTPException(
                status_code=resp.status_code,
                detail=f"Vobiz API error ({resp.status_code}): {resp.text}",
            )
    except httpx.RequestError as exc:
        logger.error(f"[Vobiz Outbound] Network error connecting to Vobiz: {exc}")
        db_call.status = "failed"
        await db.commit()
        raise HTTPException(status_code=502, detail=f"Failed to connect to Vobiz: {exc}")


@router.post("/outbound")
async def trigger_vobiz_outbound(
    payload: VobizOutboundRequest,
    db: AsyncSession = Depends(get_db),
):
    """Direct API endpoint to trigger an outbound phone call using Vobiz."""
    return await _trigger_vobiz_outbound_internal(
        to_number=payload.to_number,
        agent_id=payload.agent_id,
        db=db,
        from_number=payload.from_number,
        auth_id=payload.vobiz_auth_id,
        auth_token=payload.vobiz_auth_token,
    )


# ─── INBOUND / FLOW WEBHOOK ──────────────────────────────────────────────────

@router.post("/flow")
@router.get("/flow")
@router.post("/inbound")
@router.get("/inbound")
async def vobiz_flow_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Unified Vobiz handler for both initial call answering and multi-turn speech gathers.
    
    Vobiz Parameters:
      - CallUUID or CallSid: Call identifier
      - From: Caller phone number
      - To: Called Vobiz number (+918065354620)
      - Speech or SpeechResult: ASR transcript of caller's voice
      - InputType: 'speech' or 'dtmf'
    """
    try:
        # 1. Parse parameters from POST form, JSON, or query params
        params: Dict[str, Any] = {}
        if request.method == "POST":
            try:
                form_data = await request.form()
                params.update(dict(form_data))
            except Exception:
                pass
            if not params:
                try:
                    json_data = await request.json()
                    if isinstance(json_data, dict):
                        params.update(json_data)
                except Exception:
                    pass

        for k, v in request.query_params.items():
            if k not in params or not params[k]:
                params[k] = v

        call_uuid = (
            params.get("CallUUID")
            or params.get("CallSid")
            or params.get("call_uuid")
            or params.get("call_id")
            or f"vobiz-{uuid.uuid4().hex[:8]}"
        )
        from_num = str(params.get("From") or params.get("from") or "Unknown").strip()
        to_num = str(params.get("To") or params.get("to") or "+918065354620").strip()
        speech_result = (
            params.get("Speech")
            or params.get("SpeechResult")
            or params.get("speech")
            or params.get("text")
            or ""
        ).strip()

        logger.info(
            f"[Vobiz] Webhook hit: CallUUID={call_uuid} From={from_num} To={to_num} Speech='{speech_result[:60] if speech_result else ''}'"
        )

        # 2. Lookup existing Call record
        call_rec: Optional[CallORM] = None
        call_id_param = request.query_params.get("call_id")
        if call_id_param:
            res = await db.execute(select(CallORM).where(CallORM.id == call_id_param))
            call_rec = res.scalar_one_or_none()

        if not call_rec and call_uuid:
            res = await db.execute(select(CallORM).where(CallORM.session_id == call_uuid))
            call_rec = res.scalar_one_or_none()

        # Update session_id with call_uuid if available
        if call_rec and call_uuid and call_rec.session_id != call_uuid:
            call_rec.session_id = call_uuid
            await db.commit()

        # 3. Resolve Agent
        agent: Optional[AgentORM] = None
        if call_rec and call_rec.agent_id:
            ag_res = await db.execute(
                select(AgentORM).options(selectinload(AgentORM.tools)).where(AgentORM.id == call_rec.agent_id)
            )
            agent = ag_res.scalar_one_or_none()

        if not agent:
            agent = await _resolve_agent_for_number(to_num, db)

        # 4. Create Call record if not found
        if not call_rec:
            call_rec = CallORM(
                id=str(uuid.uuid4()),
                user_id=agent.user_id if agent else None,
                agent_id=agent.id if agent else None,
                session_id=call_uuid,
                from_number=from_num,
                to_number=to_num,
                direction=CallDirection.INBOUND,
                status="in-progress",
                call_meta={
                    "provider": "vobiz",
                    "conversation_history": [],
                    "user_speech_history": [],
                },
            )
            db.add(call_rec)
            await db.commit()
            await db.refresh(call_rec)

        # Resolve agent metadata
        agent_name = (agent.agent_name if agent else None) or "Voice Assistant"
        sys_prompt = (agent.prompt if agent else "") or f"You are {agent_name}, a friendly, professional voice assistant."
        first_msg = ""
        if agent and agent.config and isinstance(agent.config, dict):
            first_msg = agent.config.get("first_message", "").strip()

        # Base URL for action webhook
        base_url = os.getenv("BACKEND_URL", "").rstrip("/")
        if not base_url:
            base_url = str(request.base_url).rstrip("/")
            if base_url.startswith("http://"):
                base_url = "https://" + base_url[7:]
        action_url = f"{base_url}/api/v1/telephony/vobiz/flow?call_id={call_rec.id}"

        # 5. TURN 1: Initial Greeting (No speech yet)
        if not speech_result:
            if first_msg:
                intro_msg = first_msg
            else:
                intro_msg = f"Hello! This is {agent_name}. How can I assist you today?"

            safe_intro = _xml_escape(intro_msg)
            safe_agent_name = _xml_escape(agent_name)
            safe_action_url = _xml_escape(action_url)

            vobiz_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather action="{safe_action_url}" method="POST" inputType="speech" executionTimeout="8">
        <Speak voice="Polly.Aditi" language="en-IN">{safe_intro}</Speak>
    </Gather>
    <Gather action="{safe_action_url}" method="POST" inputType="speech" executionTimeout="8">
        <Speak voice="Polly.Aditi" language="en-IN">I am still here to assist you. Please let me know how I can help.</Speak>
    </Gather>
    <Speak voice="Polly.Aditi" language="en-IN">Thank you for speaking with {safe_agent_name}. Have a wonderful day. Goodbye!</Speak>
</Response>"""
            logger.info(f"[Vobiz] Turn 1 greeting served for call {call_rec.id} ({agent_name})")
            return Response(content=vobiz_xml, media_type="text/xml")

        # 6. TURN 2+: Caller spoke into <Gather>
        lower_speech = speech_result.lower()
        call_meta = dict(call_rec.call_meta or {})
        speech_history = list(call_meta.get("user_speech_history") or [])
        speech_history.append(speech_result)
        call_meta["user_speech_history"] = speech_history

        conversation_history = list(call_meta.get("conversation_history") or [])
        captured_email = call_meta.get("captured_email")

        # Extract spoken email
        extracted_email = await _extract_spoken_email(speech_result)
        if extracted_email:
            captured_email = extracted_email
            call_meta["captured_email"] = captured_email
            logger.info(f"[Vobiz] Extracted spoken email: {captured_email}")

        # Check for polite closing / Goodbye
        is_goodbye = any(
            w in lower_speech
            for w in [
                "thank you", "thanks", "bye", "goodbye", "that's all", "that is all",
                "solved", "done", "no thanks", "no that's all", "no that is all", "have a good day"
            ]
        )

        if is_goodbye:
            logger.info(f"[Vobiz] Caller closing conversation: '{speech_result}'")
            call_rec.status = "completed"
            call_rec.ended_at = datetime.utcnow()
            if call_rec.started_at:
                call_rec.duration_seconds = int((call_rec.ended_at - call_rec.started_at).total_seconds())
            call_rec.call_meta = call_meta
            await db.commit()

            # Trigger Google Sheets, Google Calendar, and Gmail sync in background
            background_tasks.add_task(_append_call_summary_to_sheets, call_rec.id, db)

            closing_msg = (
                f"You are very welcome! Your details have been confirmed and recorded. "
                f"Thank you for speaking with {agent_name}. Take care and goodbye!"
            )
            safe_closing = _xml_escape(closing_msg)
            vobiz_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Speak voice="Polly.Aditi" language="en-IN">{safe_closing}</Speak>
    <Hangup/>
</Response>"""
            return Response(content=vobiz_xml, media_type="text/xml")

        # Generate AI response via Groq / OpenRouter
        reply, latency = await _generate_groq_llm_reply(
            agent_name=agent_name,
            sys_prompt=sys_prompt,
            user_speech=speech_result,
            conversation_history=conversation_history,
            captured_email=captured_email,
        )

        if not reply:
            reply = "I have noted that for you. What date and time would be most convenient for your appointment?"

        # Update conversation history
        conversation_history.append({"role": "user", "content": speech_result})
        conversation_history.append({"role": "assistant", "content": reply})
        call_meta["conversation_history"] = conversation_history
        call_rec.call_meta = call_meta
        await db.commit()

        # Accumulate speech for tools
        if agent:
            await _check_and_execute_linked_tools(agent.id, speech_result, call_rec, db)

        logger.info(f"[Vobiz] Replied in {latency}ms: '{reply}'")

        safe_reply = _xml_escape(reply)
        safe_agent_name = _xml_escape(agent_name)
        safe_action_url = _xml_escape(action_url)

        vobiz_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Gather action="{safe_action_url}" method="POST" inputType="speech" executionTimeout="8">
        <Speak voice="Polly.Aditi" language="en-IN">{safe_reply}</Speak>
    </Gather>
    <Gather action="{safe_action_url}" method="POST" inputType="speech" executionTimeout="8">
        <Speak voice="Polly.Aditi" language="en-IN">Is there anything else I can assist you with today?</Speak>
    </Gather>
    <Speak voice="Polly.Aditi" language="en-IN">Thank you for speaking with {safe_agent_name}. Goodbye!</Speak>
</Response>"""
        return Response(content=vobiz_xml, media_type="text/xml")

    except Exception as exc:
        logger.exception(f"[Vobiz] Fatal exception in flow webhook: {exc}")
        safe_err = "I am sorry, an unexpected error occurred. Please try calling back later. Goodbye."
        vobiz_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Speak voice="Polly.Aditi" language="en-IN">{safe_err}</Speak>
    <Hangup/>
</Response>"""
        return Response(content=vobiz_xml, media_type="text/xml")


# ─── STATUS CALLBACK ─────────────────────────────────────────────────────────

@router.post("/status-callback")
@router.get("/status-callback")
async def vobiz_status_callback(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Vobiz Hangup / Status callback endpoint."""
    params: Dict[str, Any] = {}
    try:
        form_data = await request.form()
        params.update(dict(form_data))
    except Exception:
        pass

    for k, v in request.query_params.items():
        if k not in params or not params[k]:
            params[k] = v

    call_id_param = request.query_params.get("call_id") or params.get("call_id")
    call_uuid = params.get("CallUUID") or params.get("CallSid") or params.get("call_uuid")
    call_status = params.get("CallStatus") or params.get("status") or "completed"
    duration = params.get("Duration") or params.get("duration")

    logger.info(f"[Vobiz] Status callback: CallID={call_id_param} CallUUID={call_uuid} Status={call_status} Duration={duration}")

    call_rec: Optional[CallORM] = None
    if call_id_param:
        res = await db.execute(select(CallORM).where(CallORM.id == call_id_param))
        call_rec = res.scalar_one_or_none()

    if not call_rec and call_uuid:
        res = await db.execute(select(CallORM).where(CallORM.session_id == call_uuid))
        call_rec = res.scalar_one_or_none()

    # Fallback to latest active call in workspace
    if not call_rec:
        res = await db.execute(
            select(CallORM)
            .where(CallORM.status.in_(["in-progress", "connecting"]))
            .order_by(CallORM.created_at.desc())
            .limit(1)
        )
        call_rec = res.scalar_one_or_none()

    if call_rec:
        call_rec.status = "completed"
        call_rec.ended_at = datetime.utcnow()
        if duration:
            try:
                call_rec.duration_seconds = int(duration)
            except ValueError:
                pass
        await db.commit()
        background_tasks.add_task(_append_call_summary_to_sheets, call_rec.id, db)
        logger.info(f"[Vobiz] Call {call_rec.id} status callback synced successfully.")

    return Response(content="<Response/>", media_type="text/xml")


# ─── DIAGNOSTIC ENDPOINT ───────────────────────────────────────────────────

@router.get("/diagnostic")
async def vobiz_diagnostic(
    db: AsyncSession = Depends(get_db),
):
    """Diagnostic endpoint to inspect DB calls, tools, and Google token resolution."""
    import traceback
    from app.models.orm import IntegrationORM, ToolORM
    from app.services.agent_metadata_service import _resolve_tool_token
    from app.core.config import settings

    try:
        # 1. Latest 5 Calls
        c_res = await db.execute(select(CallORM).order_by(CallORM.started_at.desc()).limit(5))
        calls = c_res.scalars().all()
        calls_data = []
        for c in calls:
            direction_str = c.direction.value if hasattr(c.direction, "value") else str(c.direction)
            calls_data.append({
                "id": c.id,
                "session_id": c.session_id,
                "agent_id": c.agent_id,
                "status": c.status,
                "direction": direction_str,
                "duration": c.duration_seconds,
                "meta": c.call_meta,
                "started_at": str(c.started_at),
                "ended_at": str(c.ended_at),
            })

        # 2. Integrations
        int_res = await db.execute(select(IntegrationORM).order_by(IntegrationORM.created_at.desc()))
        ints = int_res.scalars().all()
        ints_data = []
        for i in ints:
            ints_data.append({
                "id": i.id,
                "provider": i.provider,
                "type": i.integration_type,
                "expires_at": str(i.expires_at),
                "has_access": bool(i.access_token),
                "has_refresh": bool(i.refresh_token),
            })

        # 3. Tools and token resolution
        tools_res = await db.execute(select(ToolORM).order_by(ToolORM.created_at.desc()))
        tools = tools_res.scalars().all()
        tools_data = []
        for t in tools:
            resolved_token = None
            err = None
            try:
                resolved_token = await _resolve_tool_token(t, db)
            except Exception as e:
                err = str(e)
            tools_data.append({
                "id": t.id,
                "name": t.name,
                "tool_type": t.tool_type,
                "integration_id": t.integration_id,
                "config": t.config,
                "token_resolved": bool(resolved_token),
                "token_prefix": resolved_token[:10] if resolved_token else None,
                "error": err,
            })

        return {
            "google_client_id_configured": bool(settings.GOOGLE_CLIENT_ID),
            "google_client_secret_configured": bool(settings.GOOGLE_CLIENT_SECRET),
            "calls": calls_data,
            "integrations": ints_data,
            "tools": tools_data,
        }
    except Exception as exc:
        return {
            "error": str(exc),
            "traceback": traceback.format_exc(),
        }


@router.post("/resync/{call_id}")
async def vobiz_resync_call(
    call_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Manually trigger Google Sheets, Calendar, and Gmail sync for a completed call."""
    import traceback
    try:
        res = await _append_call_summary_to_sheets(call_id, db)
        return {"status": "ok", "message": f"Sync executed for call {call_id}", "details": res}
    except Exception as exc:
        return {"status": "error", "error": str(exc), "traceback": traceback.format_exc()}


