import asyncio
from app.db.session import engine
from app.models.orm import Base

async def reinit_db():
    print("🧹 [FORGE] Purging Registry Tables...")
    async with engine.begin() as conn:
        # Drop all tables
        await conn.run_sync(Base.metadata.drop_all)
        print("⚡ [FORGE] Registry Cleared. Rebuilding Secure Architecture...")
        # Create all tables
        await conn.run_sync(Base.metadata.create_all)
    print("✅ [FORGE] Database Re-initialized. Ready for Sync.")

if __name__ == "__main__":
    asyncio.run(reinit_db())
