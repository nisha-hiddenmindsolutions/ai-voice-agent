import asyncio
from app.db.session import AsyncSessionLocal
from app.models.orm import UserORM
from sqlalchemy import select

async def check():
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(UserORM))
        users = res.scalars().all()
        for u in users:
            print(f"User: {u.email}, Active: {u.is_active}")

if __name__ == "__main__":
    asyncio.run(check())
