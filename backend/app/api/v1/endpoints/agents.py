from fastapi import APIRouter, HTTPException, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.orm import selectinload
from typing import List
import json
# pyrefly: ignore [missing-import]
from app.models.agent import AgentConfig
# pyrefly: ignore [missing-import]
from app.models.orm import AgentORM
# pyrefly: ignore [missing-import]
from app.db.session import get_db
# pyrefly: ignore [missing-import]
from app.api.deps import get_current_user
# pyrefly: ignore [missing-import]
from app.core.security import vault
# pyrefly: ignore [missing-import]
from app.models.orm import UserORM
# pyrefly: ignore [missing-import]
from app.services.agent_metadata_service import build_agent_metadata

router = APIRouter()


@router.get("/{agent_id}/live-config")
async def get_live_agent_config(agent_id: str, db: AsyncSession = Depends(get_db)):
    """
    Internal endpoint — called by the LiveKit agent worker at the start of
    EVERY call (inbound and outbound, including the Twilio-fallback path)
    to fetch this agent's CURRENT prompt/LLM/tools, instead of trusting
    whatever metadata was baked into a dispatch rule at trunk-provisioning
    time (which goes stale the moment the agent's tools are edited).

    No user auth: this is only reachable on the internal Docker network by
    the agent worker process, the same trust boundary already used by
    GET /numbers/inbound-config.
    """
    result = await db.execute(
        select(AgentORM).options(selectinload(AgentORM.tools)).where(AgentORM.id == agent_id)
    )
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found.")

    metadata_json = await build_agent_metadata(agent, db)
    return json.loads(metadata_json)

@router.get("", response_model=List[AgentConfig])
async def list_agents(
    current_user: UserORM = Depends(get_current_user), 
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(AgentORM).where(AgentORM.user_id == current_user.id))
    agents_orm = result.scalars().all()
    
    return [
        AgentConfig(
            id=a.id,
            agentName=a.agent_name,
            description=a.description,
            status=a.status,
            language=a.language,
            prompt=a.prompt,
            **a.config
        ) for a in agents_orm
    ]

@router.post("", response_model=AgentConfig)
async def create_or_update_agent(
    agent: AgentConfig, 
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Check if agent already exists and belongs to current user
    from sqlalchemy.orm import selectinload
    stmt = select(AgentORM).options(selectinload(AgentORM.tools)).where(AgentORM.id == agent.id)
    result = await db.execute(stmt)
    existing_agent = result.scalar_one_or_none()
    
    if existing_agent and existing_agent.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to update this registry node")
        
    # Extract & Encrypt secrets if provided in model config
    agent_secrets = {}
    if agent.llm.apiKey:
        agent_secrets["llm_key"] = vault.encrypt(agent.llm.apiKey)
    if agent.stt.apiKey:
        agent_secrets["stt_key"] = vault.encrypt(agent.stt.apiKey)
    if agent.tts.apiKey:
        agent_secrets["tts_key"] = vault.encrypt(agent.tts.apiKey)

    # Process config JSON (exclude primary fields and sensitive keys)
    agent_data = agent.model_dump(exclude={"id", "agentName", "description", "status", "language", "prompt", "tools"})
    
    # We remove raw keys from the config JSON before storage
    if "llm" in agent_data: agent_data["llm"].pop("apiKey", None)
    if "stt" in agent_data: agent_data["stt"].pop("apiKey", None)
    if "tts" in agent_data: agent_data["tts"].pop("apiKey", None)
    
    # Extract tool IDs (which are strings) from agent.tools
    tool_ids = [t for t in agent.tools if isinstance(t, str)]
    
    # Query ToolORM objects from database
    db_tools = []
    if tool_ids:
        from app.models.orm import ToolORM
        tool_stmt = select(ToolORM).where(ToolORM.id.in_(tool_ids), ToolORM.user_id == current_user.id)
        tool_result = await db.execute(tool_stmt)
        db_tools = list(tool_result.scalars().all())
        
    # Keep the tool IDs in the JSON config representation as expected by the model mapping
    agent_data["tools"] = tool_ids
    
    if existing_agent:
        existing_agent.agent_name = agent.agentName
        existing_agent.description = agent.description
        existing_agent.status = agent.status
        existing_agent.language = agent.language
        existing_agent.prompt = agent.prompt
        existing_agent.config = agent_data
        existing_agent.voice_id = agent.tts.voice
        existing_agent.llm_model = agent.llm.model
        existing_agent.tools = db_tools # Update the many-to-many relationship
        # Update secrets only if new ones were provided
        if agent_secrets:
            existing_agent.secrets = {**existing_agent.secrets, **agent_secrets}
    else:
        new_agent = AgentORM(
            id=agent.id,
            user_id=current_user.id,
            agent_name=agent.agentName,
            description=agent.description,
            status=agent.status,
            language=agent.language,
            prompt=agent.prompt,
            config=agent_data,
            secrets=agent_secrets,
            voice_id=agent.tts.voice,
            llm_model=agent.llm.model,
            tools=db_tools # Set the many-to-many relationship
        )
        db.add(new_agent)
    
    await db.commit()
    return agent

@router.get("/{agent_id}", response_model=AgentConfig)
async def get_agent(
    agent_id: str, 
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(AgentORM).where(AgentORM.id == agent_id, AgentORM.user_id == current_user.id)
    result = await db.execute(stmt)
    a = result.scalar_one_or_none()
    
    if not a:
        raise HTTPException(status_code=404, detail="Agent not found in your registry")
    
    return AgentConfig(
        id=a.id,
        agentName=a.agent_name,
        description=a.description,
        status=a.status,
        language=a.language,
        prompt=a.prompt,
        **a.config
    )

@router.delete("/{agent_id}")
async def remove_agent(
    agent_id: str, 
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Check ownership
    result = await db.execute(select(AgentORM).where(AgentORM.id == agent_id, AgentORM.user_id == current_user.id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Agent not found in your registry")

    stmt = delete(AgentORM).where(AgentORM.id == agent_id)
    await db.execute(stmt)
    await db.commit()
    return {"message": "Agent deleted successfully"}