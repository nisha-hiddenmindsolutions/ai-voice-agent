import asyncio
import os
from sqlalchemy.ext.asyncio import create_async_engine
from app.models.orm import Base

# Inside Docker, DATABASE_URL is already set via docker-compose.yml env
db_url = os.getenv("DATABASE_URL")
print(f"Connecting to {db_url}...")

async def reset_db():
    engine = create_async_engine(db_url, echo=False)
    async with engine.begin() as conn:
        print("Dropping all tables...")
        await conn.run_sync(Base.metadata.drop_all)
        print("Creating all tables...")
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    print("Done! Tables created - DB ready")

if __name__ == "__main__":
    asyncio.run(reset_db())