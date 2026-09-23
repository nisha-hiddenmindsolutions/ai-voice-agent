# Force reload to apply new Google OAuth client keys
from typing import List, Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel
# pyrefly: ignore [missing-import]
from app.db.session import get_db
# pyrefly: ignore [missing-import]
from app.api.deps import get_current_user
# pyrefly: ignore [missing-import]
from app.models.orm import UserORM, IntegrationORM
# pyrefly: ignore [missing-import]
from app.core.config import settings
# pyrefly: ignore [missing-import]
from app.core.security import vault
from datetime import datetime, timedelta, timezone
import uuid

router = APIRouter()

# --- SCHEMAS ---
class IntegrationResponse(BaseModel):
    id: str
    provider: str
    integration_type: str
    scopes: List[str]
    created_at: datetime

    class Config:
        from_attributes = True

class ServiceAccountCreate(BaseModel):
    provider: str # google
    credentials: dict # Full JSON object

# --- ENDPOINTS ---

@router.get("/google/authorize")
async def google_authorize(current_user: UserORM = Depends(get_current_user)):
    """Redirects user to Google OAuth 2.0 flow."""
    client_id = settings.GOOGLE_CLIENT_ID
    if not client_id:
        raise HTTPException(
            status_code=500,
            detail="Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables in your .env file."
        )
        
    params = {
        "client_id": client_id,
        "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/spreadsheets",
        "access_type": "offline",
        "prompt": "consent",
        "state": current_user.id # Bind to current authenticated user
    }
    
    url = f"https://accounts.google.com/o/oauth2/v2/auth?{'&'.join([f'{k}={v}' for k, v in params.items()])}"
    return {"url": url}

@router.get("/google/callback")
async def google_callback(
    code: str, 
    state: str = None, # User ID passed back from Google
    db: AsyncSession = Depends(get_db)
):
    """Handles the redirect from Google, exchanges code for tokens, and secures them."""
    from app.core.config import settings as _s
    _frontend = getattr(_s, "FRONTEND_URL", "http://localhost:5173")

    if not state:
        return RedirectResponse(url=f"{_frontend}/integrations?status=error&detail=missing_state")

    # Exchange code for token
    token_url = "https://oauth2.googleapis.com/token"
    data = {
        "code": code,
        "client_id": settings.GOOGLE_CLIENT_ID,
        "client_secret": settings.GOOGLE_CLIENT_SECRET,
        "redirect_uri": settings.GOOGLE_OAUTH_REDIRECT_URI,
        "grant_type": "authorization_code",
    }
    
    async with httpx.AsyncClient() as client:
        resp = await client.post(token_url, data=data)
        if resp.status_code != 200:
            return RedirectResponse(url=f"{_frontend}/integrations?status=error")
        
        tokens = resp.json()
        access_token = tokens.get("access_token")
        refresh_token = tokens.get("refresh_token")
        expires_in = tokens.get("expires_in", 3600)
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
        
        # 1. Encrypt and Save
        encrypted_access = vault.encrypt(access_token)
        encrypted_refresh = vault.encrypt(refresh_token) if refresh_token else None
        
        # 2. Bind to User from 'state'
        # Check if user already has a Google OAuth integration
        stmt = select(IntegrationORM).where(
            IntegrationORM.user_id == state, 
            IntegrationORM.provider == "google",
            IntegrationORM.integration_type == "OAUTH"
        )
        result = await db.execute(stmt)
        integration = result.scalar_one_or_none()
        
        if integration:
            # Update existing
            integration.access_token = encrypted_access
            if encrypted_refresh:
                integration.refresh_token = encrypted_refresh
            integration.expires_at = expires_at
            integration.updated_at = datetime.now(timezone.utc)
        else:
            # Create new
            integration = IntegrationORM(
                user_id=state,
                provider="google",
                integration_type="OAUTH",
                access_token=encrypted_access,
                refresh_token=encrypted_refresh,
                expires_at=expires_at,
                scopes=["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/spreadsheets"]
            )
            db.add(integration)
        
        await db.commit()
        
        return RedirectResponse(url=f"{_frontend}/integrations?status=success")

@router.post("/service-account", response_model=IntegrationResponse)
async def create_service_account_integration(
    data: ServiceAccountCreate,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Saves a Google Service Account key for formal agent access."""
    # Basic validation of the JSON structure
    missing_fields = [f for f in ["private_key", "client_email"] if f not in data.credentials]
    if missing_fields:
        raise HTTPException(
            status_code=400, 
            detail=f"Invalid Service Account JSON: Missing required fields {missing_fields}. Please ensure you are uploading a SERVICE ACCOUNT key, not an OAuth client secret."
        )
    
    new_integration = IntegrationORM(
        user_id=current_user.id,
        provider=data.provider,
        integration_type="SERVICE_ACCOUNT",
        credentials=data.credentials, # Stored as JSONB
        scopes=["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/spreadsheets"],
        access_token="SERVICE_ACCOUNT_MANAGED" # Marker
    )
    
    db.add(new_integration)
    await db.commit()
    await db.refresh(new_integration)
    return new_integration

@router.get("/", response_model=List[IntegrationResponse])
async def list_integrations(
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(IntegrationORM).where(IntegrationORM.user_id == current_user.id))
    return result.scalars().all()

@router.delete("/{integration_id}")
async def disconnect_integration(
    integration_id: str,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    stmt = select(IntegrationORM).where(IntegrationORM.id == integration_id, IntegrationORM.user_id == current_user.id)
    result = await db.execute(stmt)
    integration = result.scalar_one_or_none()
    
    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")
        
    await db.execute(delete(IntegrationORM).where(IntegrationORM.id == integration_id))
    await db.commit()
    return {"message": "Integration disconnected"}
