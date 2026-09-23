from typing import AsyncGenerator, Annotated
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
# pyrefly: ignore [missing-import]
from app.core.config import settings
# pyrefly: ignore [missing-import]
from app.core.security import ALGORITHM
# pyrefly: ignore [missing-import]
from app.db.session import AsyncSessionLocal
# pyrefly: ignore [missing-import]
from app.models.orm import UserORM

# Standard OAuth2 login URL
oauth2_scheme = OAuth2PasswordBearer(tokenUrl=f"{settings.API_V1_STR}/auth/login")

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session

async def get_current_user(
    db: Annotated[AsyncSession, Depends(get_db)],
    token: Annotated[str, Depends(oauth2_scheme)]
) -> UserORM:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    result = await db.execute(select(UserORM).where(UserORM.id == user_id))
    user = result.scalar_one_or_none()
    
    if user is None:
        raise credentials_exception
    return user

async def get_current_active_user(
    current_user: Annotated[UserORM, Depends(get_current_user)]
) -> UserORM:
    if not current_user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user
