from typing import List, Optional
import re
import aiohttp
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
# pyrefly: ignore [missing-import]
from app.db.session import get_db
import uuid
import urllib.parse as urlparse
from urllib.parse import urlencode
# pyrefly: ignore [missing-import]
from app.api.deps import get_current_user
# pyrefly: ignore [missing-import]
from app.core.security import vault
# pyrefly: ignore [missing-import]
from app.models.orm import UserORM, ToolORM, IntegrationORM, agent_tools

logger = logging.getLogger("tools-diagnostic")

router = APIRouter()

# --- SCHEMAS ---
class ToolBase(BaseModel):
    name: str = "Weather API"
    description: str = "Fetches real-time weather data"
    tool_type: str = "WEBHOOK" # WEBHOOK, CALENDAR, SHEETS, N8N
    category: str = "Webhooks" # Webhooks, AI Workflows, Google Apps, etc.
    url: Optional[str] = None
    method: str = "POST"
    headers: dict = {}
    api_key: Optional[str] = None 
    body_template: Optional[str] = None
    config: dict = {} # Native integration config
    integration_id: Optional[str] = None

class ToolCreate(ToolBase):
    pass

class ToolResponse(ToolBase):
    id: str

    class Config:
        from_attributes = True

# --- ENDPOINTS ---

@router.post("/", response_model=ToolResponse)
async def create_tool(
    tool: ToolCreate, 
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    try:
        # --- Auto-resolve integration for native Google tools ---
        resolved_integration_id = tool.integration_id or None
        tool_config = dict(tool.config) if tool.config else {}
        
        if tool.tool_type in ("SHEETS", "CALENDAR") and not resolved_integration_id:
            # Auto-find the user's Google integration
            int_stmt = select(IntegrationORM).where(
                IntegrationORM.user_id == current_user.id,
                IntegrationORM.provider == "google"
            ).order_by(IntegrationORM.updated_at.desc())
            int_result = await db.execute(int_stmt)
            google_int = int_result.scalars().first()
            if google_int:
                resolved_integration_id = google_int.id
                logger.info(f"Auto-linked {tool.tool_type} tool to Google integration {google_int.id}")
        
        # --- Extract spreadsheet ID from full URLs ---
        if tool.tool_type == "SHEETS" and "spreadsheetId" in tool_config:
            raw_id = tool_config["spreadsheetId"]
            match = re.search(r'/spreadsheets/d/([a-zA-Z0-9\-_]+)', raw_id)
            if match:
                tool_config["spreadsheetId"] = match.group(1)
                logger.info(f"Extracted spreadsheet ID from URL: {tool_config['spreadsheetId']}")
                
        # --- Extract calendar ID from full/embed URLs ---
        if tool.tool_type == "CALENDAR" and "calendarId" in tool_config:
            raw_cid = tool_config["calendarId"]
            if "embed?src=" in raw_cid or "src=" in raw_cid:
                match = re.search(r'src=([^&]+)', raw_cid)
                if match:
                    import urllib.parse
                    tool_config["calendarId"] = urllib.parse.unquote(match.group(1))
                    logger.info(f"Extracted calendar ID from embed URL: {tool_config['calendarId']}")
            elif "calendar.google.com/calendar/" in raw_cid:
                # Handle direct links
                pass
        
        # For native Google tools, don't store dummy api_keys — the integration handles auth
        encrypted_key = None
        if tool.api_key and resolved_integration_id is None:
            encrypted_key = vault.encrypt(tool.api_key)
        
        db_tool = ToolORM(
            **tool.model_dump(exclude={"api_key", "integration_id", "config"}),
            api_key=encrypted_key,
            integration_id=resolved_integration_id,
            config=tool_config,
            user_id=current_user.id
        )
        db.add(db_tool)
        await db.commit()
        await db.refresh(db_tool)
        return db_tool
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/", response_model=List[ToolResponse])
async def list_tools(
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(ToolORM).where(ToolORM.user_id == current_user.id))
    return result.scalars().all()

@router.delete("/{tool_id}")
async def delete_tool(
    tool_id: str, 
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    # Check ownership
    result = await db.execute(select(ToolORM).where(ToolORM.id == tool_id, ToolORM.user_id == current_user.id))
    tool = result.scalar_one_or_none()
    if not tool:
        raise HTTPException(status_code=404, detail="Tool not found in your registry")
        
    await db.execute(delete(ToolORM).where(ToolORM.id == tool_id))
    await db.commit()
    return {"message": "Tool deleted"}

# --- AGENT LINKING ---

@router.post("/link")
async def link_tool_to_agent(agent_id: str, tool_id: str, db: AsyncSession = Depends(get_db)):
    # Check if link exists
    query = select(agent_tools).where(
        agent_tools.c.agent_id == agent_id, 
        agent_tools.c.tool_id == tool_id
    )
    existing = await db.execute(query)
    if existing.first():
        return {"message": "Already linked"}
    
    # Insert link
    try:
        stmt = agent_tools.insert().values(agent_id=agent_id, tool_id=tool_id)
        await db.execute(stmt)
        await db.commit()
        return {"message": "Linked successfully"}
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=400, 
            detail=f"Neural Link Failure: Agent '{agent_id}' or Tool '{tool_id}' does not exist in the Registry."
        )

# --- DIAGNOSTIC HELPERS ---

async def _run_test_call(tool: ToolBase) -> dict:
    """Helper to perform a real HTTP request for diagnostic purposes."""
    headers = {**tool.headers}
    if tool.api_key:
        if tool.api_key.startswith("Bearer ") or len(tool.api_key) > 40:
             headers["Authorization"] = tool.api_key if tool.api_key.startswith("Bearer ") else f"Bearer {tool.api_key}"
        else:
             headers["X-API-Key"] = tool.api_key

    try:
        # SMART URL DECONSTRUCTION
        url_parts = list(urlparse.urlparse(tool.url))
        query = dict(urlparse.parse_qsl(url_parts[4]))
        
        # Merge Auth into query if not in headers
        if tool.api_key and not any(k.lower() in ["authorization", "x-api-key"] for k in headers.keys()):
            if "key" not in query and "apiKey" not in query:
                query["key"] = tool.api_key # Default to 'key' param for common APIs like WeatherAPI

        # SMART GET PROBE: If GET and no search param, add a test default
        if tool.method.upper() == "GET" and not query.get("q") and not query.get("query"):
            query["q"] = "London"

        url_parts[4] = urlencode(query)
        final_url = urlparse.urlunparse(url_parts)

        async with aiohttp.ClientSession() as session:
            async with session.request(
                method=tool.method.upper(),
                url=final_url,
                headers=headers,
                json={"test": True, "source": "VoiceForge Diagnostic"},
                timeout=10
            ) as resp:
                data = await resp.json() if "application/json" in resp.headers.get("Content-Type", "") else await resp.text()
                return {
                    "status": "success",
                    "code": resp.status,
                    "url_probed": final_url, # For debugging
                    "response": data
                }
    except Exception as e:
        logger.error(f"Diagnostic failed for {tool.url}: {e}")
        return {
            "status": "failure",
            "error": str(e)
        }

@router.post("/test-config")
async def test_tool_config(tool: ToolBase):
    """Test a tool's configuration without saving it to the database."""
    if tool.tool_type not in ["WEBHOOK", "N8N"]:
        return {"status": "success", "message": f"Diagnostic: {tool.tool_type} tools are verified via the live integration loop."}
    return await _run_test_call(tool)

@router.post("/{tool_id}/test")
async def test_tool_by_id(
    tool_id: str, 
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Diagnostic endpoint to test if a tool's webhook is functional."""
    stmt = select(ToolORM).where(ToolORM.id == tool_id, ToolORM.user_id == current_user.id)
    result = await db.execute(stmt)
    tool_orm = result.scalar_one_or_none()
    
    if not tool_orm:
        raise HTTPException(status_code=404, detail="Registry Node not found")

    # Decrypt the key before the test call
    decrypted_key = vault.decrypt(tool_orm.api_key) if tool_orm.api_key else None

    # Use the helper
    return await _run_test_call(ToolBase(
        name=tool_orm.name,
        description=tool_orm.description,
        url=tool_orm.url,
        method=tool_orm.method,
        headers=tool_orm.headers,
        api_key=decrypted_key,
        body_template=tool_orm.body_template
    ))
