"""
LiveKit Event Webhook Handler.

POST /api/v1/telephony/livekit/webhook

This is the most critical missing piece identified in the architecture doc.
When a LiveKit room ends (call completes), LiveKit fires a signed webhook
to this endpoint. Without it, every call in the DB stays in "connecting"
or "initiated" forever.

Events handled:
  - room_finished       → mark call completed, calculate duration
  - participant_left    → detect when the customer or agent hangs up
  - participant_joined  → mark call as "active" when customer connects

Security:
  - HMAC-SHA256 body hash verified from JWT Authorization header.
  - Idempotency check prevents double-processing on retried deliveries.

LiveKit webhook setup:
  1. Go to LiveKit Cloud → Project → Webhooks
  2. Add URL: https://yourdomain.com/api/v1/telephony/livekit/webhook
  3. Select events: RoomFinished, ParticipantLeft, ParticipantJoined
"""

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.models.orm import CallORM, TranscriptORM
from app.core.livekit_auth import verify_livekit_webhook
from app.services.idempotency import idempotency_store

logger = logging.getLogger("livekit_webhook")
router = APIRouter()

_NS = "livekit_webhook"


@router.post("/webhook")
async def livekit_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
):
    """
    Receives and processes LiveKit room/participant lifecycle events.

    This endpoint is called by LiveKit Cloud — not by end users.
    It does NOT require user authentication.
    """
    # ── 1. Read raw body ─────────────────────────────────────────────────────
    body = await request.body()

    # ── 2. Verify signature ──────────────────────────────────────────────────
    auth_header = request.headers.get("Authorization", "")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing Authorization header")

    try:
        verify_livekit_webhook(body, auth_header)
    except ValueError as exc:
        logger.warning(f"[Webhook] Invalid signature: {exc}")
        raise HTTPException(status_code=401, detail=f"Signature verification failed: {exc}")

    # ── 3. Parse event ───────────────────────────────────────────────────────
    try:
        event = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")

    event_id = event.get("id", "")
    event_type = event.get("event", "")

    if not event_id or not event_type:
        return {"status": "ignored", "reason": "missing event id or type"}

    # ── 4. Idempotency ───────────────────────────────────────────────────────
    if await idempotency_store.is_seen(_NS, event_id):
        logger.info(f"[Webhook] Duplicate event ignored: {event_id}")
        return {"status": "duplicate", "event_id": event_id}
    await idempotency_store.mark_seen(_NS, event_id)

    logger.info(f"[Webhook] Event: {event_type} id={event_id}")

    # ── 5. Dispatch to handler ───────────────────────────────────────────────
    background_tasks.add_task(_handle_event, event_type, event)

    # Always respond 200 immediately — background task handles DB work
    return {"status": "accepted", "event": event_type}


async def _handle_event(event_type: str, event: dict) -> None:
    """Handles a LiveKit event in a background task (non-blocking HTTP response)."""
    from app.db.session import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        try:
            if event_type == "room_finished":
                await _on_room_finished(event, db)
            elif event_type == "participant_left":
                await _on_participant_left(event, db)
            elif event_type == "participant_joined":
                await _on_participant_joined(event, db)
            else:
                logger.debug(f"[Webhook] Unhandled event type: {event_type}")
        except Exception as exc:
            logger.error(f"[Webhook] Handler error for {event_type}: {exc}", exc_info=True)


async def _on_room_finished(event: dict, db: AsyncSession) -> None:
    """
    Marks the call as completed and calculates duration.

    LiveKit room_finished fires when the last participant leaves the room
    (or the room times out). This is the authoritative end-of-call signal.
    """
    room = event.get("room", {})
    room_name = room.get("name", "")
    if not room_name:
        return

    result = await db.execute(
        select(CallORM).where(CallORM.session_id == room_name)
    )
    call = result.scalar_one_or_none()
    if not call:
        logger.warning(f"[Webhook] No call found for room: {room_name}")
        return

    if call.status in ("completed", "failed"):
        return  # already finalized

    now = datetime.now(timezone.utc)
    # LiveKit provides duration in seconds as room.duration
    lk_duration = room.get("duration", 0)

    if lk_duration:
        duration_seconds = float(lk_duration)
    elif call.started_at:
        started = call.started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        duration_seconds = max(0.0, (now - started).total_seconds())
    else:
        duration_seconds = 0.0

    call.status = "completed"
    call.ended_at = now
    call.duration_seconds = duration_seconds

    # Pull any transcript items from event metadata
    metadata_str = room.get("metadata", "")
    if metadata_str:
        try:
            meta = json.loads(metadata_str)
            transcript_entries = meta.get("transcript", [])
            for entry in transcript_entries:
                db.add(TranscriptORM(
                    call_id=call.id,
                    role=entry.get("role", "unknown"),
                    content=entry.get("content", ""),
                    timestamp=datetime.fromisoformat(entry["timestamp"])
                    if "timestamp" in entry
                    else now,
                ))
        except Exception as exc:
            logger.warning(f"[Webhook] Could not parse transcript from metadata: {exc}")

    await db.commit()
    logger.info(
        f"[Webhook] Call completed: id={call.id} room={room_name} "
        f"duration={duration_seconds:.1f}s"
    )


async def _on_participant_left(event: dict, db: AsyncSession) -> None:
    """
    Detects early hangup when a participant leaves before the room closes.
    If the SIP participant (customer) leaves, we mark the call as 'ended'.
    If the agent leaves, we note it but don't finalize (room_finished handles that).
    """
    room = event.get("room", {})
    room_name = room.get("name", "")
    participant = event.get("participant", {})
    identity = participant.get("identity", "")

    if not room_name:
        return

    # Only act when a SIP participant leaves (identity starts with "sip-")
    if not identity.startswith("sip-"):
        return

    result = await db.execute(
        select(CallORM).where(CallORM.session_id == room_name)
    )
    call = result.scalar_one_or_none()
    if not call or call.status in ("completed", "failed"):
        return

    # Mark as ended (room_finished will fire shortly after)
    call.status = "ended"
    await db.commit()
    logger.info(f"[Webhook] SIP participant left room {room_name} — call marked ended")


async def _on_participant_joined(event: dict, db: AsyncSession) -> None:
    """
    Marks the call as 'active' when the SIP participant (customer) joins.
    This transitions the call from 'initiated' → 'active'.
    """
    room = event.get("room", {})
    room_name = room.get("name", "")
    participant = event.get("participant", {})
    identity = participant.get("identity", "")

    if not room_name or not identity.startswith("sip-"):
        return

    result = await db.execute(
        select(CallORM).where(CallORM.session_id == room_name)
    )
    call = result.scalar_one_or_none()
    if not call or call.status not in ("connecting", "initiated"):
        return

    call.status = "active"
    await db.commit()
    logger.info(f"[Webhook] Call active: room={room_name} participant={identity}")