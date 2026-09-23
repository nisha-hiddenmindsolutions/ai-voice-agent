from typing import Optional
import uuid
import logging
# pyrefly: ignore [missing-import]
from app.db.session import get_db
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
# pyrefly: ignore [missing-import]
from app.models.orm import AgentORM, UserORM
# pyrefly: ignore [missing-import]
from app.models.agent import AgentConfig
# pyrefly: ignore [missing-import]
from app.services.livekit_service import livekit_service
# pyrefly: ignore [missing-import]
from app.core.config import settings
from fastapi import APIRouter, HTTPException, Depends
# pyrefly: ignore [missing-import]
from app.api.deps import get_current_user

router = APIRouter()
logger = logging.getLogger("sessions")


@router.post("/start")
async def start_session(
    config: Optional[AgentConfig] = None,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    Issues a LiveKit token/room for the browser and dispatches the voice
    agent worker.

    SECURITY: this endpoint is a client-facing boundary — its response
    (the JWT) is readable in full by anyone with devtools, since JWTs are
    signed, not encrypted. Resolved provider/tool secrets (OpenRouter,
    Cartesia, integration OAuth tokens, etc.) must NEVER be placed in the
    `metadata` passed to `generate_token()` / `dispatch_agent()`, because
    that metadata rides inside the token payload and is also handed to
    LiveKit as plain job metadata.

    Instead, only non-secret identifying fields are included here. The
    agent worker resolves the full config — including all decrypted
    secrets — for itself, server-side, by calling
    GET /agents/{id}/live-config over the internal Docker network
    (see agent/main.py + app/services/agent_metadata_service.py). That is
    the ONLY place secrets should be assembled.
    """
    room_name = f"room_{uuid.uuid4().hex[:8]}"
    identity = f"user_{uuid.uuid4().hex[:6]}"

    logger.info(
        "Session start requested user_id=%s agent_id=%s",
        getattr(current_user, "id", None),
        getattr(config, "id", None),
    )

    if not settings.LIVEKIT_API_KEY or not settings.LIVEKIT_API_SECRET:
        raise HTTPException(status_code=500, detail="LiveKit credentials are not configured")

    # --- SAFE, NON-SECRET METADATA ONLY ---
    # Do NOT dump the raw request config (model_dump) into metadata: even
    # though client-supplied apiKey fields are normally stripped/None by
    # the time they reach us, we build this explicitly from an allowlist
    # so nothing accidentally sensitive can ride along in the token.
    metadata: dict = {}
    db_agent: Optional[AgentORM] = None

    if config and config.id:
        # Ensure the agent belongs to the current user before referencing it.
        stmt = (
            select(AgentORM)
            .where(AgentORM.id == config.id, AgentORM.user_id == current_user.id)
            .options(selectinload(AgentORM.tools))
        )
        result = await db.execute(stmt)
        db_agent = result.scalar_one_or_none()

        if db_agent:
            # Only non-secret identity fields. Tools/LLM/STT/TTS keys are
            # intentionally omitted — the agent worker fetches those itself
            # via /agents/{id}/live-config, which never touches the browser.
            metadata = {
                "id": db_agent.id,
                "agentId": db_agent.id,
                "agentName": db_agent.agent_name,
                "language": db_agent.language,
                "prompt": db_agent.prompt,
                "first_message": (db_agent.config or {}).get("first_message", ""),
                "termination_keywords": (db_agent.config or {}).get("termination_keywords", ""),
            }
        else:
            logger.warning(
                "Agent id=%s not found in DB for user_id=%s; starting session with no agent metadata",
                config.id,
                getattr(current_user, "id", None),
            )
    elif config:
        # Ad-hoc/unsaved config with no DB record to resolve secrets from.
        # Only pass along non-secret identity fields; never forward
        # config.llm/stt/tts.apiKey or tool apiKeys into client-visible metadata.
        metadata = {
            "agentName": config.agentName,
            "language": config.language,
            "prompt": config.prompt,
        }

    # Inject RAG knowledge base URL so the agent worker can query it during calls
    backend_base_url = settings.BACKEND_BASE_URL.rstrip("/") if hasattr(settings, "BACKEND_BASE_URL") else ""
    if backend_base_url:
        metadata["knowledge_base_url"] = f"{backend_base_url}{settings.API_V1_STR}/knowledge/search"

    # Standardizing dispatch to 'voice-forge-agent-v5' for reliability
    agent_dispatch_name = "voice-forge-agent-v5"

    logger.info("Dispatching session room=%s agent_dispatch_name=%s metadata_keys=%s",
                room_name, agent_dispatch_name, list(metadata.keys()))

    token = livekit_service.generate_token(
        room_name=room_name,
        identity=identity,
        agent_name=agent_dispatch_name,
        metadata=metadata
    )

    # Explicitly dispatch the agent to ensure it joins (Double-tap strategy)
    try:
        await livekit_service.dispatch_agent(room_name, agent_dispatch_name, metadata)
    except Exception as e:
        logger.warning("Explicit agent dispatch failed (will fallback to token-based): %s", e)

    return {
        "token": token,
        "room": room_name,
        "identity": identity,
        "url": settings.LIVEKIT_URL
    }


@router.get("/health")
async def health_check():
    """Checks LiveKit connectivity and API status."""
    try:
        await livekit_service.list_rooms()
        return {"status": "ok", "url": settings.LIVEKIT_URL}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))