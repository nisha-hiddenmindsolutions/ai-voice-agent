from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func, desc
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from datetime import datetime, timedelta, timezone
# pyrefly: ignore [missing-import]
from app.db.session import get_db
# pyrefly: ignore [missing-import]
from app.models.orm import AgentORM, UserORM, TranscriptORM, CallORM, CallDirection
# pyrefly: ignore [missing-import]
from app.api.deps import get_current_user
import uuid

router = APIRouter()


def _iso_utc(dt: Optional[datetime]) -> Optional[str]:
    """Serializes a datetime as an unambiguous UTC ISO-8601 string.

    Timestamps in this codebase are stored as naive UTC (DateTime columns
    without tzinfo, populated via datetime.utcnow()). Calling plain
    .isoformat() on a naive datetime produces a string with NO timezone
    marker (e.g. "2026-07-04T08:57:20"). The frontend then does
    `new Date(started_at)` — and per the JS spec, a date-time string with
    no offset is parsed as LOCAL time, not UTC. Since the value is
    actually UTC, every displayed call time silently shifts by the
    viewer's UTC offset (e.g. 5:30h off for an IST user).

    Appending "Z" for naive datetimes (already UTC by convention here) and
    normalizing any tz-aware datetime to UTC keeps both cases correct, and
    lets the frontend's existing `new Date(...).toLocaleString()` render
    the right local time automatically for any viewer, anywhere.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.isoformat() + "Z"
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

# --- SCHEMAS ---
class OutboundCallRequest(BaseModel):
    to_number: str = "+1234567890"
    from_number: Optional[str] = None
    agent_id: str

class CallResponse(BaseModel):
    id: str
    session_id: str # Room Name
    status: str
    started_at: datetime

    class Config:
        from_attributes = True

class TranscriptItem(BaseModel):
    role: str
    content: str
    timestamp: datetime

    class Config:
        from_attributes = True

class TranscriptLogRequest(BaseModel):
    role: str
    content: str


class CallMetricsPayload(BaseModel):
    """
    Real per-call metrics reported by the agent worker at call end (see
    agent/main.py's UsageCollector + "metrics_collected" handler). Replaces
    the previously hardcoded "412ms" neuralLatency mock in
    GET /dashboard/stats with actual measured numbers.
    """
    avg_response_latency_ms: Optional[float] = None
    eou_sample_count: int = 0
    llm_prompt_tokens: int = 0
    llm_completion_tokens: int = 0
    tts_characters_count: int = 0
    stt_audio_duration_seconds: float = 0.0

def _extract_latency(call: CallORM) -> int:
    meta = call.call_meta if isinstance(call.call_meta, dict) else {}
    metrics = meta.get("metrics") if isinstance(meta.get("metrics"), dict) else {}
    val = (
        metrics.get("avg_response_latency_ms")
        or meta.get("avg_response_latency_ms")
        or meta.get("latency_ms")
    )
    try:
        return int(val) if val is not None else 240
    except (ValueError, TypeError):
        return 240


@router.post("/outbound", response_model=CallResponse)
async def trigger_outbound_call(
    request: OutboundCallRequest,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Triggers an outbound mobile call.
    1. Fetch agent with preloaded tools.
    2. Call LiveKit SIP Service.
    3. Log the call in DB.
    """
    # pyrefly: ignore [missing-import]
    from app.services.sip_service import sip_service
    from app.services.agent_metadata_service import build_agent_metadata
    
    # 1. Verify Agent belongs to current user
    result = await db.execute(
        select(AgentORM).options(selectinload(AgentORM.tools)).where(
            AgentORM.id == request.agent_id,
            AgentORM.user_id == current_user.id
        )
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")

    # 2. Build proper agent metadata
    try:
        agent_metadata = await build_agent_metadata(agent, db)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Agent configuration error: {exc}")

    # 3. Find outbound trunk from DB (use first active outbound trunk for this user)
    # pyrefly: ignore [missing-import]
    from app.models.orm import SIPTrunkORM
    trunk_result = await db.execute(
        select(SIPTrunkORM).where(
            SIPTrunkORM.user_id == current_user.id,
            SIPTrunkORM.trunk_type == "outbound",
            SIPTrunkORM.status == "active",
        )
    )
    outbound_trunk = trunk_result.scalar_one_or_none()
    if not outbound_trunk:
        raise HTTPException(status_code=400, detail="No active outbound SIP trunk found. Please provision one via POST /telephony/trunks first.")

    from_number = request.from_number or (
        outbound_trunk.numbers[0] if outbound_trunk.numbers else "+10000000000"
    )

    # 4. Trigger SIP Call with correct args
    try:
        import os
        agent_worker_name = os.getenv("LIVEKIT_AGENT_NAME", "voice-forge-agent-v5")
        sip_result = await sip_service.create_outbound_call(
            to_number=request.to_number,
            from_number=from_number,
            outbound_trunk_id=outbound_trunk.livekit_trunk_id,
            agent_name=agent_worker_name,
            agent_metadata=agent_metadata,
            room_prefix=f"call-{current_user.id[:6]}-",
        )
        
        # 5. Log Call — use authenticated user id, not a hardcoded default
        db_call = CallORM(
            user_id=current_user.id,
            agent_id=request.agent_id,
            session_id=sip_result["room_name"],
            from_number=from_number,
            to_number=request.to_number,
            direction=CallDirection.OUTBOUND,
            status="initiated"
        )
        db.add(db_call)
        await db.commit()
        await db.refresh(db_call)
        
        return db_call
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/")
async def list_calls(
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    direction: Optional[str] = Query(None, description="Filter by direction: inbound or outbound"),
    status: Optional[str] = Query(None, description="Filter by status"),
    agent_id: Optional[str] = Query(None, description="Filter by agent"),
    days: int = Query(30, description="Number of days to look back"),
    limit: int = Query(100, description="Max results"),
    offset: int = Query(0, description="Pagination offset"),
):
    """
    Enhanced call listing with filters, agent name resolution, and transcript counts.
    """
    # Base query
    stmt = (
        select(CallORM)
        .where(CallORM.user_id == current_user.id)
        .order_by(desc(CallORM.started_at))
    )
    
    # Apply filters
    if direction:
        dir_enum = CallDirection.INBOUND if direction == "inbound" else CallDirection.OUTBOUND
        stmt = stmt.where(CallORM.direction == dir_enum)
    if status:
        stmt = stmt.where(CallORM.status == status)
    if agent_id:
        stmt = stmt.where(CallORM.agent_id == agent_id)
    if days:
        cutoff = datetime.utcnow() - timedelta(days=days)
        stmt = stmt.where(CallORM.started_at >= cutoff)
    
    stmt = stmt.limit(limit).offset(offset)
    result = await db.execute(stmt)
    calls = result.scalars().all()
    
    # Resolve agent names and transcript counts
    agent_ids = list(set(c.agent_id for c in calls if c.agent_id))
    agent_map = {}
    if agent_ids:
        agent_result = await db.execute(
            select(AgentORM).where(AgentORM.id.in_(agent_ids))
        )
        for a in agent_result.scalars().all():
            agent_map[a.id] = a.agent_name
    
    # Get transcript counts per call
    call_ids = [c.id for c in calls]
    transcript_counts = {}
    if call_ids:
        tc_result = await db.execute(
            select(TranscriptORM.call_id, func.count(TranscriptORM.id))
            .where(TranscriptORM.call_id.in_(call_ids))
            .group_by(TranscriptORM.call_id)
        )
        for call_id, count in tc_result.all():
            transcript_counts[call_id] = count
    
    # Get total count for pagination
    count_stmt = select(func.count(CallORM.id)).where(CallORM.user_id == current_user.id)
    total_result = await db.execute(count_stmt)
    total = total_result.scalar_one()
    
    return {
        "calls": [
            {
                "id": c.id,
                "session_id": c.session_id,
                "agent_id": c.agent_id,
                "agent_name": agent_map.get(c.agent_id, "Unknown Agent"),
                "from_number": c.from_number,
                "to_number": c.to_number,
                "direction": c.direction.value if hasattr(c.direction, 'value') else str(c.direction or "outbound"),
                "status": c.status,
                "duration_seconds": c.duration_seconds or 0,
                "latency_ms": _extract_latency(c),
                "tokens_used": c.tokens_used or 0,
                "started_at": _iso_utc(c.started_at),
                "ended_at": _iso_utc(c.ended_at),
                "transcript_count": transcript_counts.get(c.id, 0),
            }
            for c in calls
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{call_id}")
async def get_call_detail(
    call_id: str,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Get detailed info about a specific call including transcripts."""
    stmt = select(CallORM).where(
        CallORM.id == call_id,
        CallORM.user_id == current_user.id
    )
    result = await db.execute(stmt)
    call = result.scalar_one_or_none()
    
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    
    # Get agent name
    agent_name = "Unknown Agent"
    if call.agent_id:
        agent_result = await db.execute(
            select(AgentORM).where(AgentORM.id == call.agent_id)
        )
        agent = agent_result.scalar_one_or_none()
        if agent:
            agent_name = agent.agent_name
    
    # Get transcripts
    transcript_result = await db.execute(
        select(TranscriptORM)
        .where(TranscriptORM.call_id == call_id)
        .order_by(TranscriptORM.timestamp)
    )
    transcripts = transcript_result.scalars().all()
    
    return {
        "id": call.id,
        "session_id": call.session_id,
        "agent_id": call.agent_id,
        "agent_name": agent_name,
        "from_number": call.from_number,
        "to_number": call.to_number,
        "direction": call.direction.value if call.direction else "outbound",
        "status": call.status,
        "duration_seconds": call.duration_seconds or 0,
        "tokens_used": call.tokens_used or 0,
        "started_at": _iso_utc(call.started_at),
        "ended_at": _iso_utc(call.ended_at),
        "transcripts": [
            {
                "role": t.role,
                "content": t.content,
                "timestamp": _iso_utc(t.timestamp),
            }
            for t in transcripts
        ],
    }


@router.get("/{call_id}/transcripts")
async def get_call_transcripts(call_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TranscriptORM)
        .where(TranscriptORM.call_id == call_id)
        .order_by(TranscriptORM.timestamp)
    )
    return result.scalars().all()


@router.post("/sessions/{session_id}/transcripts")
async def log_transcript_by_session(
    session_id: str, 
    payload: TranscriptLogRequest,
    db: AsyncSession = Depends(get_db)
):
    """Log a transcript entry by session/room name. Called by the agent worker."""
    # 1. Resolve call_id
    stmt = select(CallORM).where(CallORM.session_id == session_id)
    result = await db.execute(stmt)
    call = result.scalar_one_or_none()
    
    if not call:
        return {"status": "ignored", "reason": "session not found"}

    # 2. Log transcript
    db_transcript = TranscriptORM(
        call_id=call.id,
        role=payload.role,
        content=payload.content
    )
    db.add(db_transcript)
    
    # 3. Update call status to active if still connecting
    if call.status in ("connecting", "initiated"):
        call.status = "active"
    
    await db.commit()
    return {"status": "ok"}


@router.put("/sessions/{session_id}/metrics")
async def log_call_metrics(
    session_id: str,
    payload: CallMetricsPayload,
    db: AsyncSession = Depends(get_db)
):
    """
    Records the REAL per-call STT/LLM/TTS/EOU metrics summary reported by
    the agent worker at call end (agent/main.py). This is what backs the
    `neuralLatency` figure in GET /dashboard/stats — before this endpoint
    existed, that figure was a hardcoded "412ms" regardless of what
    actually happened on any call.

    No user auth: internal-network-only call from the agent worker, same
    trust boundary as the transcript logger above and
    GET /agents/{id}/live-config.
    """
    stmt = select(CallORM).where(CallORM.session_id == session_id)
    result = await db.execute(stmt)
    call = result.scalar_one_or_none()

    if not call:
        return {"status": "ignored", "reason": "session not found"}

    total_tokens = payload.llm_prompt_tokens + payload.llm_completion_tokens
    if total_tokens:
        call.tokens_used = total_tokens

    # call_meta is JSONB ("metadata" column) — reassigning a new dict (not
    # mutating in place) so SQLAlchemy's change tracking picks it up without
    # needing flag_modified().
    updated_meta = dict(call.call_meta or {})
    updated_meta["metrics"] = payload.model_dump()
    call.call_meta = updated_meta

    await db.commit()
    return {"status": "ok"}


@router.put("/{call_id}/status")
async def update_call_status(
    call_id: str,
    status: str = Query(...),
    duration: Optional[float] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """Update call status (used by webhooks or agent completion callbacks)."""
    stmt = select(CallORM).where(CallORM.id == call_id)
    result = await db.execute(stmt)
    call = result.scalar_one_or_none()
    
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    
    call.status = status
    if duration is not None:
        call.duration_seconds = duration
    if status in ("completed", "failed", "ended"):
        call.ended_at = datetime.now(timezone.utc)
    
    await db.commit()
    return {"status": "ok", "call_id": call_id}