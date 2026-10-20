import asyncio
import os
import sys

backend_dir = r"c:\voice-agent\ai-voice-assistant-main\backend"
sys.path.insert(0, backend_dir)

from app.db.session import AsyncSessionLocal
from app.models.orm import UserORM
from app.api.v1.endpoints.twilio import _trigger_twilio_outbound_internal
from sqlalchemy import select

async def trigger():
    async with AsyncSessionLocal() as session:
        u_res = await session.execute(select(UserORM).where(UserORM.id == "3144076d-2582-4b45-a6d4-75cbf754ec6f"))
        user = u_res.scalar_one_or_none()
        if not user:
            print("User not found")
            return
        res = await _trigger_twilio_outbound_internal(
            to_number="+918830631380",
            agent_id="d653cc55-aeb0-4757-a3d5-8e57cf08e821",
            current_user=user,
            db=session,
        )
        print("Call triggered successfully:", res)

if __name__ == "__main__":
    asyncio.run(trigger())
