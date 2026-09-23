from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import String, Float, DateTime, ForeignKey, Text, Enum, Table, Column, Integer
import uuid
from datetime import datetime, timezone
import enum
from typing import Optional

class Base(DeclarativeBase):
    pass

# Many-to-Many relationship between Agents and Tools
agent_tools = Table(
    "agent_tools",
    Base.metadata,
    Column("agent_id", String, ForeignKey("agents.id", ondelete="CASCADE"), primary_key=True),
    Column("tool_id", String, ForeignKey("tools.id", ondelete="CASCADE"), primary_key=True),
)

class UserORM(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str] = mapped_column(String, nullable=True)
    hashed_password: Mapped[str] = mapped_column(String, nullable=True) # None for social logins
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    
    secrets: Mapped[dict] = mapped_column(JSONB, default=dict, server_default='{}', nullable=False) # Encrypted global model keys (LLM/TTS/STT)
    
    # Relationships
    agents: Mapped[list["AgentORM"]] = relationship(back_populates="user")
    tools: Mapped[list["ToolORM"]] = relationship(back_populates="user")
    phone_numbers: Mapped[list["PhoneNumberORM"]] = relationship(back_populates="user")
    integrations: Mapped[list["IntegrationORM"]] = relationship(back_populates="user")
    sip_trunks: Mapped[list["SIPTrunkORM"]] = relationship(back_populates="user")

class AgentORM(Base):
    __tablename__ = "agents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    agent_name: Mapped[str] = mapped_column(String, index=True)
    description: Mapped[str] = mapped_column(String, default="")
    status: Mapped[str] = mapped_column(String, default="draft")
    language: Mapped[str] = mapped_column(String, default="hi-IN")
    prompt: Mapped[str] = mapped_column(Text, default="")
    
    # Configuration
    llm_model: Mapped[str] = mapped_column(String, default="llama-3.3-70b-versatile")
    voice_id: Mapped[str] = mapped_column(String, default="neha")
    
    # Nested configurations stored as JSONB for flexibility
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    secrets: Mapped[dict] = mapped_column(JSONB, default=dict) # Encrypted model keys (LLM/TTS/STT)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    user: Mapped["UserORM"] = relationship(back_populates="agents")
    tools: Mapped[list["ToolORM"]] = relationship(secondary=agent_tools, back_populates="agents")
    calls: Mapped[list["CallORM"]] = relationship(back_populates="agent")
    documents: Mapped[list["DocumentORM"]] = relationship(back_populates="agent", cascade="all, delete-orphan")
    rag_config: Mapped[Optional["RAGConfigORM"]] = relationship(back_populates="agent", uselist=False, cascade="all, delete-orphan")

class ToolORM(Base):
    __tablename__ = "tools"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String, index=True)
    description: Mapped[str] = mapped_column(String, default="")
    
    # API configuration
    tool_type: Mapped[str] = mapped_column(String, default="WEBHOOK") # WEBHOOK, CALENDAR, SHEETS
    category: Mapped[str] = mapped_column(String, default="Webhooks") # Webhooks, AI Workflows, Google Apps
    url: Mapped[str] = mapped_column(String, nullable=True) # Webhook URL
    method: Mapped[str] = mapped_column(String, default="POST")
    headers: Mapped[dict] = mapped_column(JSONB, default=dict)
    api_key: Mapped[str] = mapped_column(String, nullable=True) 
    body_template: Mapped[str] = mapped_column(Text, nullable=True)
    
    # Native Config (for integrated tools)
    config: Mapped[dict] = mapped_column(JSONB, default=dict)
    
    # Link to external integration (Google/Microsoft account)
    integration_id: Mapped[str] = mapped_column(String, ForeignKey("integrations.id"), nullable=True)
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    user: Mapped["UserORM"] = relationship(back_populates="tools")
    agents: Mapped[list["AgentORM"]] = relationship(secondary=agent_tools, back_populates="tools")

class IntegrationORM(Base):
    __tablename__ = "integrations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    provider: Mapped[str] = mapped_column(String) # google, microsoft, slack
    
    # NEW: Integration Type and Credentials
    integration_type: Mapped[str] = mapped_column(String, default="OAUTH") # OAUTH, SERVICE_ACCOUNT
    credentials: Mapped[dict] = mapped_column(JSONB, nullable=True) # Full Service Account JSON
    
    # Encrypted credentials (managed by Vault) for OAUTH flow
    access_token: Mapped[str] = mapped_column(Text, nullable=True)
    refresh_token: Mapped[str] = mapped_column(Text, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    
    scopes: Mapped[list[str]] = mapped_column(JSONB, default=list) # Authorized scopes
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))

    # Relationships
    user: Mapped["UserORM"] = relationship(back_populates="integrations")

class SIPTrunkORM(Base):
    """Tracks per-user LiveKit SIP trunk provisioning for telephony."""
    __tablename__ = "sip_trunks"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id: Mapped[str] = mapped_column(String, nullable=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    livekit_trunk_id: Mapped[str] = mapped_column(String, index=True) # LiveKit's assigned trunk ID
    provider: Mapped[str] = mapped_column(String, nullable=True, default="twilio")
    trunk_type: Mapped[str] = mapped_column(String) # "inbound" or "outbound"
    name: Mapped[str] = mapped_column(String, default="")
    
    # Twilio SIP Trunk Configuration
    termination_uri: Mapped[str] = mapped_column(String, nullable=True) # e.g., "my-trunk.pstn.twilio.com"
    auth_username: Mapped[str] = mapped_column(String, nullable=True) # Encrypted
    auth_password: Mapped[str] = mapped_column(String, nullable=True) # Encrypted
    numbers: Mapped[list] = mapped_column(JSONB, default=list) # E.164 phone numbers
    
    # LiveKit Dispatch Rule (for inbound trunks)
    dispatch_rule_id: Mapped[str] = mapped_column(String, nullable=True)
    
    status: Mapped[str] = mapped_column(String, default="active") # active, inactive, error
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    user: Mapped["UserORM"] = relationship(back_populates="sip_trunks")


class PhoneNumberORM(Base):
    __tablename__ = "phone_numbers"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True)
    number: Mapped[str] = mapped_column(String, unique=True, index=True)
    provider: Mapped[str] = mapped_column(String) # e.g., 'twilio', 'telnyx'
    provider_sid: Mapped[str] = mapped_column(String, nullable=True)
    agent_id: Mapped[str] = mapped_column(String, nullable=True)
    sip_trunk_id: Mapped[str] = mapped_column(String, ForeignKey("sip_trunks.id", ondelete="SET NULL"), nullable=True) # FK to sip_trunks.id
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    user: Mapped["UserORM"] = relationship(back_populates="phone_numbers")

class CallDirection(enum.Enum):
    INBOUND = "inbound"
    OUTBOUND = "outbound"

class CallORM(Base):
    __tablename__ = "calls"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, index=True)
    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agents.id"), index=True)
    session_id: Mapped[str] = mapped_column(String, index=True) # LiveKit Room Name
    
    from_number: Mapped[str] = mapped_column(String, nullable=True)
    to_number: Mapped[str] = mapped_column(String, nullable=True)
    direction: Mapped[CallDirection] = mapped_column(Enum(CallDirection), default=CallDirection.OUTBOUND)
    
    status: Mapped[str] = mapped_column(String, default="initiated")
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    tokens_used: Mapped[int] = mapped_column(default=0)

    # Twilio's own Call SID — the authoritative correlation key for the
    # Twilio REST fallback outbound path. LiveKit auto-generates its OWN
    # room name for the SIP leg once Twilio bridges into it (different from
    # the room_name we picked when creating this row), so session_id can't
    # be trusted to match on room_finished for that path. CallSid never
    # changes, so Twilio's status-callback webhook can always find this row.
    twilio_call_sid: Mapped[str] = mapped_column(String, nullable=True, index=True)
    
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ended_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)

    call_meta: Mapped[dict] = mapped_column("metadata", JSONB, default=dict)

    # Relationships
    agent: Mapped["AgentORM"] = relationship(back_populates="calls")
    transcripts: Mapped[list["TranscriptORM"]] = relationship(back_populates="call")

class TranscriptORM(Base):
    __tablename__ = "transcripts"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    call_id: Mapped[str] = mapped_column(String, ForeignKey("calls.id"), index=True)
    role: Mapped[str] = mapped_column(String) # "user" or "agent"
    content: Mapped[str] = mapped_column(Text)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    call: Mapped["CallORM"] = relationship(back_populates="transcripts")

class UsageORM(Base):
    """Legacy usage logs table for backward compatibility or general tracking."""
    __tablename__ = "usage_logs"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String, index=True)
    agent_id: Mapped[str] = mapped_column(String, index=True)
    session_id: Mapped[str] = mapped_column(String, index=True)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    tokens_used: Mapped[int] = mapped_column(default=0)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ProviderConnectionORM(Base):
    __tablename__ = "provider_connections"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String, index=True) # openai, openrouter, anthropic, groq, gemini, together_ai, deepseek, elevenlabs, cartesia, assemblyai
    api_key: Mapped[str] = mapped_column(Text) # Encrypted
    status: Mapped[str] = mapped_column(String, default="connected")
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    models: Mapped[list["ProviderModelORM"]] = relationship(back_populates="connection", cascade="all, delete-orphan")


class ProviderModelORM(Base):
    __tablename__ = "provider_models"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    provider_connection_id: Mapped[str] = mapped_column(String, ForeignKey("provider_connections.id", ondelete="CASCADE"), index=True)
    model_id: Mapped[str] = mapped_column(String, index=True) # API model id (gpt-4o, etc.)
    name: Mapped[str] = mapped_column(String) # friendly name
    context_window: Mapped[int] = mapped_column(default=0)
    capabilities: Mapped[dict] = mapped_column(JSONB, default=dict) # supports_vision, supports_audio, etc.
    
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    connection: Mapped["ProviderConnectionORM"] = relationship(back_populates="models")


class DocumentORM(Base):
    __tablename__ = "documents"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), index=True)
    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agents.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String)
    file_type: Mapped[str] = mapped_column(String)           # "pdf" or "txt"
    file_size: Mapped[int] = mapped_column(default=0)
    chunk_count: Mapped[int] = mapped_column(default=0)      # Number of vector chunks indexed
    # index_status: "indexed" | "reindexing" | "failed"
    index_status: Mapped[str] = mapped_column(String, default="indexed")
    # Which embedding model was used — so re-index knows when the model changed
    embedding_model_used: Mapped[str] = mapped_column(String, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Relationships
    agent: Mapped["AgentORM"] = relationship(back_populates="documents")


class RAGConfigORM(Base):
    """
    Stores per-agent RAG configuration: which embedding model and vector database
    to use, with all credentials encrypted via NeuralVault.

    Embedding providers supported: openai, gemini, cohere, voyage
    Vector DB providers supported: qdrant, pinecone, weaviate, chroma
    """
    __tablename__ = "rag_configs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id: Mapped[str] = mapped_column(String, ForeignKey("agents.id", ondelete="CASCADE"), unique=True, index=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id", ondelete="CASCADE"), index=True)

    # ── Embedding provider ────────────────────────────────────────────────────
    embedding_provider: Mapped[str] = mapped_column(String, default="gemini")
    # openai  → text-embedding-3-small | text-embedding-3-large
    # gemini  → gemini-embedding-2
    # cohere  → embed-english-v3.0 | embed-multilingual-v3.0
    # voyage  → voyage-3 | voyage-3-lite
    embedding_model: Mapped[str] = mapped_column(String, default="gemini-embedding-2")
    embedding_dim: Mapped[int] = mapped_column(default=768)
    embedding_api_key: Mapped[str] = mapped_column(Text, nullable=True)  # Encrypted

    # ── Vector database ───────────────────────────────────────────────────────
    vector_db_provider: Mapped[str] = mapped_column(String, default="qdrant")
    # qdrant   → url + api_key
    # pinecone → api_key + index_name
    # weaviate → url + api_key
    # chroma   → url (no key)
    vector_db_api_key: Mapped[str] = mapped_column(Text, nullable=True)   # Encrypted
    vector_db_url: Mapped[str] = mapped_column(Text, nullable=True)        # Qdrant / Weaviate / Chroma URL
    vector_db_index: Mapped[str] = mapped_column(Text, nullable=True)      # Pinecone index name

    # ── Chunking tuning ───────────────────────────────────────────────────────
    # chunk_strategy: "fixed" | "sentence" | "paragraph"
    chunk_strategy: Mapped[str] = mapped_column(String, default="fixed")
    chunk_size: Mapped[int] = mapped_column(default=600)
    chunk_overlap: Mapped[int] = mapped_column(default=150)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    agent: Mapped["AgentORM"] = relationship(back_populates="rag_config")