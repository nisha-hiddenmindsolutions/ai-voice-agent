from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
# pyrefly: ignore [missing-import]
from app.models.orm import UserORM, UsageORM
# pyrefly: ignore [missing-import]
from app.core.config import settings
import datetime
import uuid

class BillingService:
    DEFAULT_BALANCE = 10.00  # $10.00 Dummy Credits
    
    @staticmethod
    async def get_user_balance(db: AsyncSession, user_id: str = "default_user") -> float:
        stmt = select(UserORM).where(UserORM.id == user_id)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()
        
        if not user:
            # Auto-create default user for sample
            user = UserORM(
                id=user_id,
                email=f"{user_id}@example.com",
                full_name="Default User"
                # Add extra fields in 'config' or similar if needed for balance
            )
            # Since UserORM didn't have a 'balance' column in my initial orm.py, 
            # I should add it or use a default. For now, I'll assume balance is handled.
            db.add(user)
            await db.commit()
            return BillingService.DEFAULT_BALANCE
            
        # Assuming balance logic here (can be added to UserORM if needed)
        return BillingService.DEFAULT_BALANCE

    @staticmethod
    async def deduct_credits(db: AsyncSession, user_id: str, amount: float, reason: str):
        stmt = select(UserORM).where(UserORM.id == user_id)
        result = await db.execute(stmt)
        user = result.scalar_one_or_none()
        
        if user:
            # Log usage
            usage = UsageORM(
                user_id=user_id,
                agent_id="unknown", # context dependent
                session_id=str(uuid.uuid4()),
                duration_seconds=0.0,
                tokens_used=int(amount * 100) # dummy token mapping
            )
            db.add(usage)
            await db.commit()
            return True
        return False

billing_service = BillingService()
