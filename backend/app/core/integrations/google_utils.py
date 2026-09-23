import httpx
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
import logging
# pyrefly: ignore [missing-import]
from app.core.config import settings
# pyrefly: ignore [missing-import]
from app.core.security import vault
from sqlalchemy.ext.asyncio import AsyncSession
# pyrefly: ignore [missing-import]
from app.models.orm import IntegrationORM

logger = logging.getLogger("google-utils")

class GoogleManager:
    """
    Handles Google OAuth token orchestration, including refreshing expired tokens.
    """
    
    @staticmethod
    async def refresh_token(db: AsyncSession, integration: IntegrationORM) -> Optional[str]:
        """
        Refreshes the OAuth access token if it is expired or nearing expiration.
        Returns the valid access token (decrypted).
        """
        # 1. Decrypt tokens
        access_token = vault.decrypt(integration.access_token)
        refresh_token = vault.decrypt(integration.refresh_token)
        
        if not refresh_token:
            logger.warning(f"No refresh token found for integration {integration.id}")
            return access_token # Return existing, might still be valid or fail later
            
        # 2. Check Expiration (with 5-minute buffer)
        is_expired = False
        if integration.expires_at:
            expires_at = integration.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            is_expired = datetime.now(timezone.utc) + timedelta(minutes=5) >= expires_at
        else:
            is_expired = True # Assume expired if no date
            
        if not is_expired:
            return access_token
            
        logger.info(f"Refreshing Google token for user {integration.user_id}...")
        
        # 3. Request New Token
        token_url = "https://oauth2.googleapis.com/token"
        data = {
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        }
        
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(token_url, data=data)
                if resp.status_code != 200:
                    logger.error(f"Failed to refresh Google token: {resp.text}")
                    return None
                
                new_tokens = resp.json()
                new_access = new_tokens.get("access_token")
                expires_in = new_tokens.get("expires_in", 3600)
                
                # 4. Update Database
                integration.access_token = vault.encrypt(new_access)
                integration.expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
                
                # If a new refresh token is provided (rotating), update it too
                if "refresh_token" in new_tokens:
                    integration.refresh_token = vault.encrypt(new_tokens["refresh_token"])
                
                await db.commit()
                logger.info(f"Successfully refreshed Google token for user {integration.user_id}")
                return new_access
                
        except Exception as e:
            logger.exception(f"Error during Google token refresh: {e}")
            return None

    @staticmethod
    async def get_valid_token(db: AsyncSession, integration_id: str) -> Optional[str]:
        """Helper to get a valid token by ID."""
        from sqlalchemy import select
        stmt = select(IntegrationORM).where(IntegrationORM.id == integration_id)
        result = await db.execute(stmt)
        integration = result.scalar_one_or_none()
        
        if not integration:
            return None
            
        return await GoogleManager.refresh_token(db, integration)
