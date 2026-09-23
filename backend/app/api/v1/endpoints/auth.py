from datetime import timedelta
from typing import Any, Annotated, Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
# pyrefly: ignore [missing-import]
from app.core.config import settings
# pyrefly: ignore [missing-import]
from app.core.security import create_access_token, get_password_hash, verify_password
# pyrefly: ignore [missing-import]
from app.api.deps import get_db, get_current_user
# pyrefly: ignore [missing-import]
from app.models.orm import UserORM
import uuid

router = APIRouter()

@router.post("/register", response_model=dict)
async def register(
    db: Annotated[AsyncSession, Depends(get_db)],
    email: str,
    password: str,
    full_name: str = None
) -> Any:
    """
    Register a new user in the Neural Forge.
    """
    result = await db.execute(select(UserORM).where(UserORM.email == email))
    if result.scalar_one_or_none():
        raise HTTPException(
            status_code=400,
            detail="A user with this email already exists in the Forge registry.",
        )
    
    user = UserORM(
        id=str(uuid.uuid4()),
        email=email,
        hashed_password=get_password_hash(password),
        full_name=full_name,
        is_active=True
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    
    return {"id": user.id, "email": user.email, "status": "Ready for Sync"}

@router.post("/login")
async def login(
    db: Annotated[AsyncSession, Depends(get_db)],
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()]
) -> Any:
    """
    Login to retrieve a JWT access token.
    """
    result = await db.execute(select(UserORM).where(UserORM.email == form_data.username))
    user = result.scalar_one_or_none()
    
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    elif not user.is_active:
        raise HTTPException(status_code=400, detail="User is decommissioned")
        
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return {
        "access_token": create_access_token(user.id, expires_delta=access_token_expires),
        "token_type": "bearer",
    }

@router.get("/me")
async def read_user_me(
    current_user: Annotated[UserORM, Depends(get_current_user)]
) -> Any:
    """
    Get current user profile from the registry.
    """
    return {
        "id": current_user.id,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "avatar_url": current_user.avatar_url,
        "is_active": current_user.is_active,
        "created_at": current_user.created_at
    }

class ProfileUpdate(BaseModel):
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None

@router.put("/me", response_model=dict)
async def update_profile(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserORM, Depends(get_current_user)],
    profile_data: ProfileUpdate
) -> Any:
    """
    Update current user profile details in the registry.
    """
    if profile_data.full_name is not None:
        current_user.full_name = profile_data.full_name
    if profile_data.avatar_url is not None:
        current_user.avatar_url = profile_data.avatar_url
    
    await db.commit()
    await db.refresh(current_user)
    
    return {
        "id": current_user.id,
        "email": current_user.email,
        "full_name": current_user.full_name,
        "avatar_url": current_user.avatar_url,
        "is_active": current_user.is_active,
        "created_at": current_user.created_at
    }
