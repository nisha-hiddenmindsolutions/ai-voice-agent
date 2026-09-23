import asyncio
import os
from dotenv import load_dotenv

load_dotenv()

from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.orm import declarative_base
import importlib.util
import pathlib

# Import ORM models directly without importing app/__init__.py
spec = importlib.util.spec_from_file_location("orm", pathlib.Path(__file__).parent / "app" / "models" / "orm.py")
orm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(orm)
Base = orm.Base

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
    print(" Done! Tables created.")

if __name__ == "__main__":
    asyncio.run(reset_db())