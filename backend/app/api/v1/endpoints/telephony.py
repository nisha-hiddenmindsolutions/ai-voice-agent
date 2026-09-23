"""
Unified Telephony API — SIP Trunk Provisioning, Outbound Calls & Status.

Architecture:
  POST /telephony/trunks              — Provision inbound + outbound SIP trunk pair
  GET  /telephony/trunks              — List user's trunks
  DELETE /telephony/trunks/{id}       — Deprovision a trunk
  PUT  /telephony/trunks/{id}/agent   — Bind an agent to a trunk's dispatch rule
  GET  /telephony/trunks/{id}/status  — Per-trunk health check
  POST /telephony/outbound            — Trigger outbound call (native SIP path)
  GET  /telephony/status              — Full provisioning status
  GET  /telephony/dispatch-rules      — List LiveKit dispatch rules

Design decisions:
  - Idempotency: a user cannot provision duplicate trunks for the same
    phone numbers. We check the DB before calling LiveKit.
  - Credential validation: Twilio credentials are validated before provisioning.
  - Agent metadata is attached to the dispatch rule at provision time when
    agent_id is provided; otherwise the trunk is created without an agent
    and the user must call PUT /trunks/{id}/agent before inbound calls work.
  - Concurrent call limit is enforced via CallRateLimiter.
  - All credentials stored encrypted via vault.
"""

import logging
import uuid
import os
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.models.orm import (
    UserORM, AgentORM, CallORM, CallDirection,
    PhoneNumberORM, SIPTrunkORM,
)
from app.api.deps import get_current_user
from app.core.security import vault
from app.services.sip_trunk_service import sip_trunk_service
from app.services.sip_service import sip_service
from app.services.agent_metadata_service import build_agent_metadata
from app.services.twilio_validator import validate_twilio_credentials
from app.services.rate_limiter import call_rate_limiter

logger = logging.getLogger("telephony")
router = APIRouter()

_AGENT_WORKER_NAME = os.getenv("LIVEKIT_AGENT_NAME", "voice-forge-agent-v5")


# ─── SCHEMAS ─────────────────────────────────────────────────────────────────

class ProvisionTrunkRequest(BaseModel):
    """Provision a complete LiveKit SIP trunk pair (inbound + outbound)."""
    termination_uri: str            # e.g. "my-trunk.pstn.twilio.com"
    auth_username: str              # SIP auth username (from Twilio)
    auth_password: str              # SIP auth password (from Twilio)
    phone_numbers: List[str]        # E.164 numbers to associate
    trunk_name: Optional[str] = None
    provider: str = "twilio"
    agent_id: Optional[str] = None  # Optionally bind an agent at provision time
    twilio_account_sid: Optional[str] = None  # For credential validation
    twilio_auth_token: Optional[str] = None   # For credential validation

    @field_validator("phone_numbers")
    @classmethod
    def numbers_not_empty(cls, v):
        if not v:
            raise ValueError("At least one phone number is required")
        for n in v:
            if not n.startswith("+"):
                raise ValueError(f"Phone numbers must be in E.164 format (e.g. +1234567890): {n}")
        return v

    @field_validator("termination_uri")
    @classmethod
    def uri_not_empty(cls, v):
        if not v or not v.strip():
            raise ValueError("termination_uri is required")
        return v.strip()


class OutboundCallRequest(BaseModel):
    """Request to trigger a native LiveKit SIP outbound call."""
    to_number: str
    agent_id: str
    use_twilio_fallback: bool = False  # Set True only for Twilio trial accounts

    @field_validator("to_number")
    @classmethod
    def to_number_e164(cls, v):
        if not v.startswith("+"):
            raise ValueError("to_number must be in E.164 format (e.g. +1234567890)")
        return v


class UpdateTrunkAgentRequest(BaseModel):
    """Bind an agent to a trunk's dispatch rule."""
    agent_id: str


# ─── TRUNK PROVISIONING ──────────────────────────────────────────────────────

@router.post("/trunks")
async def provision_sip_trunks(
    payload: ProvisionTrunkRequest,
    background_tasks: BackgroundTasks,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Provisions a complete LiveKit SIP trunk setup for the authenticated user.

    Steps:
      1. Idempotency check — abort if a trunk with the same number already exists.
      2. Validate Twilio credentials (if provided).
      3. Create Inbound SIP Trunk on LiveKit.
      4. Create Outbound SIP Trunk on LiveKit.
      5. Create Dispatch Rule (with agent metadata if agent_id provided).
      6. Persist trunk records and link phone numbers.

    The returned `setup_instructions.origination_uri` must be set as the
    Origination URI on the user's Twilio Elastic SIP Trunk so that Twilio
    routes inbound calls into LiveKit.
    """
    trunk_name = payload.trunk_name or f"trunk-{current_user.id[:8]}"

    # ── 1. Idempotency ───────────────────────────────────────────────────────
    for number in payload.phone_numbers:
        from sqlalchemy import cast, func
        from sqlalchemy.dialects.postgresql import JSONB as _JSONB
        existing = await db.execute(
            select(SIPTrunkORM).where(
                SIPTrunkORM.user_id == current_user.id,
                # JSONB @> operator: array contains the given element
                SIPTrunkORM.numbers.cast(_JSONB).contains(cast([number], _JSONB)),  # type: ignore[attr-defined]
                SIPTrunkORM.status == "active",
            )
        )
        if existing.scalar_one_or_none():
            raise HTTPException(
                status_code=409,
                detail=(
                    f"A trunk for number {number} already exists. "
                    "Delete the existing trunk before re-provisioning."
                ),
            )

    # ── 2. Twilio credential validation ──────────────────────────────────────
    if payload.twilio_account_sid and payload.twilio_auth_token:
        is_valid, err = await validate_twilio_credentials(
            payload.twilio_account_sid, payload.twilio_auth_token
        )
        if not is_valid:
            raise HTTPException(status_code=400, detail=f"Twilio credentials invalid: {err}")

    # ── 3. Resolve optional agent metadata ───────────────────────────────────
    agent_metadata: Optional[str] = None
    if payload.agent_id:
        agent_result = await db.execute(
            select(AgentORM)
            .options(selectinload(AgentORM.tools))
            .where(AgentORM.id == payload.agent_id, AgentORM.user_id == current_user.id)
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found")
        try:
            agent_metadata = await build_agent_metadata(agent, db)
        except Exception as exc:
            logger.warning(f"[Provision] Could not build agent metadata: {exc}")

    # ── 4. Create LiveKit trunks ──────────────────────────────────────────────
    try:
        inbound_result = await sip_trunk_service.create_inbound_trunk(
            name=f"{trunk_name}-inbound",
            numbers=payload.phone_numbers,
        )

        outbound_result = await sip_trunk_service.create_outbound_trunk(
            name=f"{trunk_name}-outbound",
            address=payload.termination_uri,
            numbers=payload.phone_numbers,
            auth_username=payload.auth_username,
            auth_password=payload.auth_password,
        )

        dispatch_result = await sip_trunk_service.create_dispatch_rule(
            trunk_ids=[inbound_result["trunk_id"]],
            agent_name=_AGENT_WORKER_NAME,
            room_prefix=f"call-{current_user.id[:6]}-",
            metadata=agent_metadata,
            rule_name=f"{trunk_name}-rule",
        )

    except RuntimeError as exc:
        logger.error(f"[Provision] LiveKit API error: {exc}")
        raise HTTPException(status_code=502, detail=str(exc))

    # ── 5. Persist to DB ──────────────────────────────────────────────────────
    try:
        db_inbound = SIPTrunkORM(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            livekit_trunk_id=inbound_result["trunk_id"],
            trunk_type="inbound",
            name=f"{trunk_name}-inbound",
            numbers=payload.phone_numbers,
            dispatch_rule_id=dispatch_result["dispatch_rule_id"],
            agent_id=payload.agent_id,
            provider=payload.provider,
            status="active",
        )
        db.add(db_inbound)

        db_outbound = SIPTrunkORM(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            livekit_trunk_id=outbound_result["trunk_id"],
            trunk_type="outbound",
            name=f"{trunk_name}-outbound",
            termination_uri=payload.termination_uri,
            auth_username=vault.encrypt(payload.auth_username),
            auth_password=vault.encrypt(payload.auth_password),
            numbers=payload.phone_numbers,
            provider=payload.provider,
            status="active",
        )
        db.add(db_outbound)

        # Link phone numbers to the inbound trunk
        for number in payload.phone_numbers:
            clean = number.strip()
            stmt = select(PhoneNumberORM).where(
                PhoneNumberORM.user_id == current_user.id,
                (PhoneNumberORM.number == clean) | (PhoneNumberORM.number == clean.lstrip("+")),
            )
            result = await db.execute(stmt)
            db_number = result.scalar_one_or_none()
            if db_number:
                db_number.sip_trunk_id = db_inbound.id

        await db.commit()

    except Exception as exc:
        await db.rollback()
        # Best-effort cleanup of LiveKit resources we already created
        _schedule_livekit_cleanup(
            background_tasks,
            inbound_id=inbound_result["trunk_id"],
            outbound_id=outbound_result["trunk_id"],
            dispatch_id=dispatch_result["dispatch_rule_id"],
        )
        logger.error(f"[Provision] DB commit failed: {exc}")
        raise HTTPException(status_code=500, detail="Failed to save trunk configuration.")

    from app.core.config import settings
    lk_sip_domain = settings.LIVEKIT_SIP_DOMAIN
    sip_uri = f"sip:{lk_sip_domain}"

    logger.info(
        f"[Provision] Trunks provisioned for user {current_user.id}: "
        f"in={inbound_result['trunk_id']} out={outbound_result['trunk_id']}"
    )

    return {
        "status": "success",
        "inbound_trunk": {
            "id": db_inbound.id,
            "livekit_trunk_id": inbound_result["trunk_id"],
            "dispatch_rule_id": dispatch_result["dispatch_rule_id"],
            "agent_attached": payload.agent_id is not None,
        },
        "outbound_trunk": {
            "id": db_outbound.id,
            "livekit_trunk_id": outbound_result["trunk_id"],
        },
        "setup_instructions": {
            "step_1": f"In Twilio Console → Elastic SIP Trunks → <your trunk> → Origination",
            "step_2": f"Add origination URI: {sip_uri};transport=tcp",
            "step_3": "Set the trunk's phone numbers as Origination SIP URI callers",
            "sip_uri": sip_uri,
            "origination_uri": f"{sip_uri};transport=tcp",
            "note": (
                "Inbound calls will now route directly to your AI agent. "
                if payload.agent_id
                else "No agent attached yet — call PUT /trunks/{id}/agent to bind one."
            ),
        },
    }


@router.get("/trunks")
async def list_user_trunks(
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Lists all SIP trunks provisioned by the current user."""
    result = await db.execute(
        select(SIPTrunkORM).where(SIPTrunkORM.user_id == current_user.id)
    )
    trunks = result.scalars().all()
    return [_trunk_to_dict(t) for t in trunks]


@router.get("/trunks/{trunk_id}")
async def get_trunk(
    trunk_id: str,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Returns a single SIP trunk record."""
    db_trunk = await _get_owned_trunk(trunk_id, current_user.id, db)
    return _trunk_to_dict(db_trunk)


@router.delete("/trunks/{trunk_id}")
async def delete_user_trunk(
    trunk_id: str,
    background_tasks: BackgroundTasks,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Deprovisions a SIP trunk from LiveKit and removes the DB record.
    Also deletes the associated dispatch rule for inbound trunks.
    """
    db_trunk = await _get_owned_trunk(trunk_id, current_user.id, db)

    # Delete from LiveKit in background (non-fatal if it fails)
    background_tasks.add_task(
        _livekit_delete_trunk,
        db_trunk.livekit_trunk_id,
        db_trunk.dispatch_rule_id,
    )

    # Unlink phone numbers
    num_result = await db.execute(
        select(PhoneNumberORM).where(PhoneNumberORM.sip_trunk_id == trunk_id)
    )
    for num in num_result.scalars().all():
        num.sip_trunk_id = None

    await db.delete(db_trunk)
    await db.commit()

    return {"status": "success", "message": "SIP trunk deprovisioned."}


# ─── BIND AGENT TO TRUNK ─────────────────────────────────────────────────────

@router.put("/trunks/{trunk_id}/agent")
async def update_trunk_agent(
    trunk_id: str,
    payload: UpdateTrunkAgentRequest,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Binds an agent to an inbound trunk's dispatch rule.

    This replaces the existing dispatch rule (which may have empty metadata)
    with a new one that contains the full agent configuration. After this call,
    inbound calls to the trunk's numbers will route to the specified agent.
    """
    db_trunk = await _get_owned_trunk(trunk_id, current_user.id, db)
    if db_trunk.trunk_type != "inbound":
        raise HTTPException(status_code=400, detail="Only inbound trunks can have agents.")

    # Verify agent ownership
    agent_result = await db.execute(
        select(AgentORM)
        .options(selectinload(AgentORM.tools))
        .where(AgentORM.id == payload.agent_id, AgentORM.user_id == current_user.id)
    )
    agent = agent_result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")

    # Build metadata
    try:
        agent_metadata = await build_agent_metadata(agent, db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not build agent config: {exc}")

    # Replace dispatch rule
    try:
        if db_trunk.dispatch_rule_id:
            await sip_trunk_service.delete_dispatch_rule(db_trunk.dispatch_rule_id)

        dispatch_result = await sip_trunk_service.create_dispatch_rule(
            trunk_ids=[db_trunk.livekit_trunk_id],
            agent_name=_AGENT_WORKER_NAME,
            room_prefix=f"call-{current_user.id[:6]}-",
            metadata=agent_metadata,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    db_trunk.dispatch_rule_id = dispatch_result["dispatch_rule_id"]
    db_trunk.agent_id = payload.agent_id
    await db.commit()

    return {
        "status": "success",
        "dispatch_rule_id": dispatch_result["dispatch_rule_id"],
        "agent_id": agent.id,
        "agent_name": agent.agent_name,
        "message": f"Trunk now routes inbound calls to '{agent.agent_name}'.",
    }


# ─── OUTBOUND CALL (NATIVE SIP PATH) ────────────────────────────────────────

@router.post("/outbound")
async def trigger_outbound_call(
    payload: OutboundCallRequest,
    background_tasks: BackgroundTasks,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Triggers an outbound call using the native LiveKit SIP path.

    Flow:
      1. Enforce concurrent-call limit.
      2. Find user's active outbound trunk.
      3. Verify agent exists.
      4. Build agent metadata (may involve OAuth token refresh).
      5. Create CallORM record with status='connecting'.
      6. Pre-dispatch agent into a named room.
      7. Create SIP participant (LiveKit dials the customer via Twilio).

    For trial Twilio accounts that cannot receive SIP, set
    use_twilio_fallback=true — this redirects to the Twilio REST path.
    """
    # ── 1. Rate limit ────────────────────────────────────────────────────────
    async with call_rate_limiter.acquire(current_user.id):

        # ── 2. Redirect to Twilio fallback if requested ───────────────────────
        if payload.use_twilio_fallback:
            from app.api.v1.endpoints.twilio import _trigger_twilio_outbound_internal
            return await _trigger_twilio_outbound_internal(
                to_number=payload.to_number,
                agent_id=payload.agent_id,
                current_user=current_user,
                db=db,
            )

        # ── 3. Find outbound trunk ────────────────────────────────────────────
        trunk_result = await db.execute(
            select(SIPTrunkORM).where(
                SIPTrunkORM.user_id == current_user.id,
                SIPTrunkORM.trunk_type == "outbound",
                SIPTrunkORM.status == "active",
            )
        )
        outbound_trunk = trunk_result.scalar_one_or_none()
        if not outbound_trunk:
            raise HTTPException(status_code=400, detail="No active outbound SIP trunk found.")

        if not outbound_trunk.livekit_trunk_id:
            raise HTTPException(
                status_code=400,
                detail="Outbound trunk has no LiveKit trunk ID. Delete and re-provision via POST /telephony/trunks."
            )

        # ── 4. Verify agent ───────────────────────────────────────────────────
        agent_result = await db.execute(
            select(AgentORM)
            .options(selectinload(AgentORM.tools))
            .where(AgentORM.id == payload.agent_id, AgentORM.user_id == current_user.id)
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            raise HTTPException(status_code=404, detail="Agent not found.")

        # ── 5. Build metadata ─────────────────────────────────────────────────
        try:
            agent_metadata = await build_agent_metadata(agent, db)
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Agent configuration error: {exc}")

        # ── 6. Determine from_number ──────────────────────────────────────────
        from_number = (
            outbound_trunk.numbers[0]
            if outbound_trunk.numbers
            else "+10000000000"
        )

        # ── 7. Create call record (connecting) ────────────────────────────────
        db_call = CallORM(
            id=str(uuid.uuid4()),
            user_id=current_user.id,
            agent_id=payload.agent_id,
            session_id="pending",          # updated after room creation
            from_number=from_number,
            to_number=payload.to_number,
            direction=CallDirection.OUTBOUND,
            status="connecting",
            call_meta={
                "outbound_trunk_lk_id": outbound_trunk.livekit_trunk_id,
            },
        )
        db.add(db_call)
        await db.flush()  # get db_call.id without committing

        # ── 8. Execute call via native SIP ───────────────────────────────────
        try:
            result = await sip_service.create_outbound_call(
                to_number=payload.to_number,
                from_number=from_number,
                outbound_trunk_id=outbound_trunk.livekit_trunk_id,
                agent_name=_AGENT_WORKER_NAME,
                agent_metadata=agent_metadata,
                room_prefix=f"call-{current_user.id[:6]}-",
            )

            db_call.session_id = result["room_name"]
            db_call.status = "initiated"
            db_call.call_meta = {
                **(db_call.call_meta or {}),
                "room_name": result["room_name"],
                "sip_participant_id": result["sip_participant_id"],
                "outbound_trunk_lk_id": outbound_trunk.livekit_trunk_id,
            }
            await db.commit()

            logger.info(
                f"[Outbound] Call initiated: user={current_user.id} "
                f"to={payload.to_number} room={result['room_name']}"
            )

            return {
                "status": "success",
                "call_id": db_call.id,
                "room_name": result["room_name"],
                "to_number": payload.to_number,
                "from_number": from_number,
                "detail": "Outbound call initiated via native LiveKit SIP.",
            }

        except Exception as exc:
            db_call.status = "failed"
            await db.commit()
            logger.error(f"[Outbound] Call failed for user {current_user.id}: {exc}")
            raise HTTPException(status_code=502, detail=f"Call initiation failed: {exc}")


# ─── DISPATCH RULES ──────────────────────────────────────────────────────────

@router.get("/dispatch-rules")
async def list_dispatch_rules(
    current_user: UserORM = Depends(get_current_user),
):
    """Lists all SIP dispatch rules on the LiveKit project."""
    return await sip_trunk_service.list_dispatch_rules()


# ─── STATUS & DIAGNOSTICS ────────────────────────────────────────────────────

@router.get("/status")
async def get_telephony_status(
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Returns the full telephony provisioning status for the current user,
    including any configuration warnings.
    """
    from app.core.config import settings

    trunk_result = await db.execute(
        select(SIPTrunkORM).where(SIPTrunkORM.user_id == current_user.id)
    )
    trunks = trunk_result.scalars().all()

    num_result = await db.execute(
        select(PhoneNumberORM).where(PhoneNumberORM.user_id == current_user.id)
    )
    numbers = num_result.scalars().all()

    has_inbound = any(t.trunk_type == "inbound" and t.status == "active" for t in trunks)
    has_outbound = any(t.trunk_type == "outbound" and t.status == "active" for t in trunks)

    # Warnings
    warnings = []
    for t in trunks:
        if t.trunk_type == "inbound" and t.status == "active" and not t.agent_id:
            warnings.append(
                f"Inbound trunk '{t.name}' has no agent assigned — "
                "inbound calls will fail. Call PUT /trunks/{id}/agent to fix."
            )

    lk_sip_domain = settings.LIVEKIT_SIP_DOMAIN
    sip_uri = f"sip:{lk_sip_domain}"

    return {
        "provisioned": has_inbound and has_outbound,
        "inbound_active": has_inbound,
        "outbound_active": has_outbound,
        "trunk_count": len(trunks),
        "number_count": len(numbers),
        "warnings": warnings,
        "sip_uri": sip_uri,
        "origination_uri": f"{sip_uri};transport=tcp",
        "trunks": [_trunk_to_dict(t) for t in trunks],
        "phone_numbers": [
            {"number": n.number, "provider": n.provider, "sip_trunk_id": n.sip_trunk_id}
            for n in numbers
        ],
    }


# ─── HELPERS ─────────────────────────────────────────────────────────────────

def _trunk_to_dict(t: SIPTrunkORM) -> dict:
    return {
        "id": t.id,
        "trunk_type": t.trunk_type,
        "name": t.name,
        "livekit_trunk_id": t.livekit_trunk_id,
        "termination_uri": t.termination_uri,
        "numbers": t.numbers or [],
        "dispatch_rule_id": t.dispatch_rule_id,
        "agent_id": t.agent_id,
        "provider": t.provider,
        "status": t.status,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


async def _get_owned_trunk(trunk_id: str, user_id: str, db: AsyncSession) -> SIPTrunkORM:
    """Returns a trunk owned by the user or raises 404."""
    result = await db.execute(
        select(SIPTrunkORM).where(
            SIPTrunkORM.id == trunk_id,
            SIPTrunkORM.user_id == user_id,
        )
    )
    trunk = result.scalar_one_or_none()
    if not trunk:
        raise HTTPException(status_code=404, detail="SIP trunk not found.")
    return trunk


def _schedule_livekit_cleanup(
    background_tasks: BackgroundTasks,
    inbound_id: str,
    outbound_id: str,
    dispatch_id: str,
) -> None:
    """Best-effort cleanup of LiveKit resources on DB failure."""
    background_tasks.add_task(_livekit_delete_trunk, inbound_id, dispatch_id)
    background_tasks.add_task(_livekit_delete_trunk, outbound_id, None)


async def _livekit_delete_trunk(trunk_id: str, dispatch_rule_id: Optional[str]) -> None:
    try:
        if dispatch_rule_id:
            await sip_trunk_service.delete_dispatch_rule(dispatch_rule_id)
        await sip_trunk_service.delete_trunk(trunk_id)
    except Exception as exc:
        logger.warning(f"[Cleanup] LiveKit resource cleanup failed: {exc}")