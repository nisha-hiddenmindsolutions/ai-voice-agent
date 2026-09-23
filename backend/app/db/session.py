from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from typing import AsyncGenerator
# pyrefly: ignore [missing-import]
from app.core.config import settings
# pyrefly: ignore [missing-import]
from app.models.orm import Base
from sqlalchemy import text

# Create Async Engine
# Note: For SQLite for local testing, use sqlite+aiosqlite
db_url = settings.DATABASE_URL.strip('"').strip("'")
engine = create_async_engine(db_url, echo=True)

# Create Session Factory
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
)

async def init_db():
    """Initializes the database tables."""
    async with engine.begin() as conn:
        # NOTE: In production, use Alembic for migrations
        await conn.run_sync(Base.metadata.create_all)
        
        try:
            await conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS secrets JSONB DEFAULT '{}'::jsonb"))
        except Exception as e:
            print(f"⚠️ [MIGRATION] ALTER TABLE users failed: {e}")
            
        try:
            await conn.execute(text("ALTER TABLE phone_numbers ADD COLUMN IF NOT EXISTS sip_trunk_id VARCHAR"))
        except Exception as e:
            print(f"⚠️ [MIGRATION] ALTER TABLE phone_numbers failed: {e}")

        # RAG migrations — add chunk_count to documents if upgrading from old schema
        try:
            await conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS chunk_count INTEGER DEFAULT 0"))
            print("✅ [MIGRATION] documents.chunk_count ensured")
        except Exception as e:
            print(f"⚠️ [MIGRATION] ALTER TABLE documents (chunk_count) failed: {e}")

        try:
            await conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS index_status VARCHAR DEFAULT 'indexed'"))
            print("✅ [MIGRATION] documents.index_status ensured")
        except Exception as e:
            print(f"⚠️ [MIGRATION] ALTER TABLE documents (index_status) failed: {e}")

        try:
            await conn.execute(text("ALTER TABLE documents ADD COLUMN IF NOT EXISTS embedding_model_used VARCHAR DEFAULT ''"))
            print("✅ [MIGRATION] documents.embedding_model_used ensured")
        except Exception as e:
            print(f"⚠️ [MIGRATION] ALTER TABLE documents (embedding_model_used) failed: {e}")

        try:
            await conn.execute(text("ALTER TABLE rag_configs ADD COLUMN IF NOT EXISTS chunk_strategy VARCHAR DEFAULT 'fixed'"))
            print("✅ [MIGRATION] rag_configs.chunk_strategy ensured")
        except Exception as e:
            print(f"⚠️ [MIGRATION] ALTER TABLE rag_configs (chunk_strategy) failed: {e}")

        # Twilio-fallback outbound calls need a stable correlation key for the
        # status-callback webhook (LiveKit's own SIP room name is NOT usable —
        # see comment on CallORM.twilio_call_sid).
        try:
            await conn.execute(text("ALTER TABLE calls ADD COLUMN IF NOT EXISTS twilio_call_sid VARCHAR"))
            await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_calls_twilio_call_sid ON calls (twilio_call_sid)"))
            print("✅ [MIGRATION] calls.twilio_call_sid ensured")
        except Exception as e:
            print(f"⚠️ [MIGRATION] ALTER TABLE calls (twilio_call_sid) failed: {e}")

        # Fix "can't subtract offset-naive and offset-aware datetimes" on Google OAuth callback —
        # integrations timestamp columns were TIMESTAMP WITHOUT TIME ZONE but the app writes
        # tz-aware UTC datetimes (datetime.now(timezone.utc)) into them.
        try:
            await conn.execute(text(
                "ALTER TABLE integrations ALTER COLUMN expires_at TYPE TIMESTAMPTZ USING expires_at AT TIME ZONE 'UTC'"
            ))
            await conn.execute(text(
                "ALTER TABLE integrations ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at AT TIME ZONE 'UTC'"
            ))
            await conn.execute(text(
                "ALTER TABLE integrations ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at AT TIME ZONE 'UTC'"
            ))
            print("✅ [MIGRATION] integrations timestamp columns converted to TIMESTAMPTZ")
        except Exception as e:
            print(f"⚠️ [MIGRATION] integrations TIMESTAMPTZ conversion failed: {e}")

async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for providing a database session for FastAPI."""
    async with AsyncSessionLocal() as session:
        yield session