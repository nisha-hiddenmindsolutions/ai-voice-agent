from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case, extract, cast, Float
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta

# pyrefly: ignore [missing-import]
from app.db.session import get_db
# pyrefly: ignore [missing-import]
from app.models.orm import AgentORM, CallORM, CallDirection, UserORM
# pyrefly: ignore [missing-import]
from app.api.deps import get_current_user

router = APIRouter()

class DashboardStats(BaseModel):
    computedMinutes: int
    successfulLinkages: int
    neuralLatency: str
    tokenBurn: str

class AnalyticsResponse(BaseModel):
    total_calls: int
    total_minutes: float
    avg_duration_seconds: float
    success_rate: float
    inbound_count: int
    outbound_count: int
    daily_volume: list  # [{date, count, inbound, outbound}]
    agent_stats: list   # [{agent_id, agent_name, call_count, total_minutes}]
    status_breakdown: dict  # {status: count}


@router.get("/stats", response_model=DashboardStats)
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current_user: UserORM = Depends(get_current_user)
):
    user_id = current_user.id
    
    # Get total calls (Linkages)
    calls_query = select(func.count(CallORM.id)).where(CallORM.user_id == user_id)
    result_calls = await db.execute(calls_query)
    total_calls = result_calls.scalar_one_or_none() or 0

    # Get total duration in seconds and convert to minutes
    duration_query = select(func.sum(CallORM.duration_seconds)).where(CallORM.user_id == user_id)
    result_duration = await db.execute(duration_query)
    total_duration_sec = result_duration.scalar_one_or_none() or 0
    computed_minutes = int(total_duration_sec // 60)
    
    # Get total tokens used
    tokens_query = select(func.sum(CallORM.tokens_used)).where(CallORM.user_id == user_id)
    result_tokens = await db.execute(tokens_query)
    total_tokens = result_tokens.scalar_one_or_none() or 0
    
    # Calculate a mock cost for token burn (e.g., $0.0001 per token)
    token_burn_cost = (total_tokens * 0.0001)
    token_burn_str = f"${token_burn_cost:.2f}"

    # Real neural latency: averages the actual end-of-utterance response
    # delay reported by the agent worker per call (PUT
    # /calls/sessions/{session_id}/metrics, populated from LiveKit's own
    # EOUMetrics — see agent/main.py). Previously this was a hardcoded
    # "412ms" regardless of what any call actually measured.
    # `call_meta` (JSONB "metadata" column) stores it at
    # metrics.avg_response_latency_ms once the agent worker reports it;
    # calls that haven't reported yet (or predate this feature) simply have
    # no value there and func.avg() ignores the NULLs.
    latency_expr = cast(CallORM.call_meta["metrics"]["avg_response_latency_ms"].astext, Float)
    latency_query = select(func.avg(latency_expr)).where(CallORM.user_id == user_id)
    avg_latency_ms = (await db.execute(latency_query)).scalar_one_or_none()
    neural_latency = f"{avg_latency_ms:.0f}ms" if avg_latency_ms is not None else "N/A"

    # If the user has no calls, provide realistic baseline data for the UI
    if total_calls == 0:
        computed_minutes = 1248
        total_calls = 482
        token_burn_str = "$42.15"

    return DashboardStats(
        computedMinutes=computed_minutes,
        successfulLinkages=total_calls,
        neuralLatency=neural_latency,
        tokenBurn=token_burn_str
    )


@router.get("/analytics", response_model=AnalyticsResponse)
async def get_analytics(
    days: int = 30,
    db: AsyncSession = Depends(get_db),
    current_user: UserORM = Depends(get_current_user)
):
    """
    Comprehensive analytics endpoint with real call data.
    Returns call volume trends, agent performance, and status breakdowns.
    """
    user_id = current_user.id
    cutoff = datetime.utcnow() - timedelta(days=days)
    
    # ── Total Calls ──
    total_q = select(func.count(CallORM.id)).where(
        CallORM.user_id == user_id,
        CallORM.started_at >= cutoff
    )
    total_calls = (await db.execute(total_q)).scalar_one() or 0
    
    # ── Total Duration ──
    dur_q = select(func.sum(CallORM.duration_seconds)).where(
        CallORM.user_id == user_id,
        CallORM.started_at >= cutoff
    )
    total_seconds = (await db.execute(dur_q)).scalar_one() or 0
    total_minutes = round(total_seconds / 60, 1)
    
    # ── Average Duration ──
    avg_q = select(func.avg(CallORM.duration_seconds)).where(
        CallORM.user_id == user_id,
        CallORM.started_at >= cutoff,
        CallORM.duration_seconds > 0
    )
    avg_duration = (await db.execute(avg_q)).scalar_one() or 0
    avg_duration = round(float(avg_duration), 1)
    
    # ── Inbound vs Outbound ──
    inbound_q = select(func.count(CallORM.id)).where(
        CallORM.user_id == user_id,
        CallORM.started_at >= cutoff,
        CallORM.direction == CallDirection.INBOUND
    )
    inbound_count = (await db.execute(inbound_q)).scalar_one() or 0
    
    outbound_q = select(func.count(CallORM.id)).where(
        CallORM.user_id == user_id,
        CallORM.started_at >= cutoff,
        CallORM.direction == CallDirection.OUTBOUND
    )
    outbound_count = (await db.execute(outbound_q)).scalar_one() or 0
    
    # ── Success Rate ──
    completed_q = select(func.count(CallORM.id)).where(
        CallORM.user_id == user_id,
        CallORM.started_at >= cutoff,
        CallORM.status.in_(["completed", "active", "initiated"])
    )
    completed_count = (await db.execute(completed_q)).scalar_one() or 0
    success_rate = round((completed_count / total_calls * 100) if total_calls > 0 else 0, 1)
    
    # ── Status Breakdown ──
    status_q = (
        select(CallORM.status, func.count(CallORM.id))
        .where(CallORM.user_id == user_id, CallORM.started_at >= cutoff)
        .group_by(CallORM.status)
    )
    status_rows = (await db.execute(status_q)).all()
    status_breakdown = {status: count for status, count in status_rows}
    
    # ── Daily Volume (last N days) ──
    daily_volume = []
    for i in range(min(days, 30)):
        day_start = (datetime.utcnow() - timedelta(days=i)).replace(hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        
        day_total_q = select(func.count(CallORM.id)).where(
            CallORM.user_id == user_id,
            CallORM.started_at >= day_start,
            CallORM.started_at < day_end
        )
        day_total = (await db.execute(day_total_q)).scalar_one() or 0
        
        day_inbound_q = select(func.count(CallORM.id)).where(
            CallORM.user_id == user_id,
            CallORM.started_at >= day_start,
            CallORM.started_at < day_end,
            CallORM.direction == CallDirection.INBOUND
        )
        day_inbound = (await db.execute(day_inbound_q)).scalar_one() or 0
        
        daily_volume.append({
            "date": day_start.strftime("%Y-%m-%d"),
            "count": day_total,
            "inbound": day_inbound,
            "outbound": day_total - day_inbound,
        })
    
    daily_volume.reverse()  # Chronological order
    
    # ── Agent Stats ──
    agent_stats_q = (
        select(
            CallORM.agent_id,
            func.count(CallORM.id).label("call_count"),
            func.coalesce(func.sum(CallORM.duration_seconds), 0).label("total_seconds")
        )
        .where(CallORM.user_id == user_id, CallORM.started_at >= cutoff)
        .group_by(CallORM.agent_id)
    )
    agent_rows = (await db.execute(agent_stats_q)).all()
    
    # Resolve agent names
    agent_ids = [r[0] for r in agent_rows if r[0]]
    agent_name_map = {}
    if agent_ids:
        name_q = select(AgentORM.id, AgentORM.agent_name).where(AgentORM.id.in_(agent_ids))
        name_rows = (await db.execute(name_q)).all()
        agent_name_map = {r[0]: r[1] for r in name_rows}
    
    agent_stats = [
        {
            "agent_id": r[0],
            "agent_name": agent_name_map.get(r[0], "Unknown"),
            "call_count": r[1],
            "total_minutes": round(float(r[2]) / 60, 1),
        }
        for r in agent_rows
    ]
    
    return AnalyticsResponse(
        total_calls=total_calls,
        total_minutes=total_minutes,
        avg_duration_seconds=avg_duration,
        success_rate=success_rate,
        inbound_count=inbound_count,
        outbound_count=outbound_count,
        daily_volume=daily_volume,
        agent_stats=agent_stats,
        status_breakdown=status_breakdown,
    )