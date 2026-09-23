"""
Knowledge Base endpoints
========================
/knowledge/config/{agent_id}        GET  — fetch current RAG config (keys masked)
/knowledge/config/{agent_id}        POST — save / update RAG config
/knowledge/config/test              POST — validate credentials without saving
/knowledge/search                   GET  — internal semantic search (called by agent worker)
/knowledge/agent/{agent_id}         GET  — list documents for an agent
/knowledge/agent/{agent_id}         POST — upload & index a new document
/knowledge/{document_id}            DELETE — remove a document and its vectors
"""
from __future__ import annotations

import os
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# pyrefly: ignore [missing-import]
from app.db.session import get_db
# pyrefly: ignore [missing-import]
from app.models.orm import DocumentORM, AgentORM, UserORM, RAGConfigORM
# pyrefly: ignore [missing-import]
from app.api.deps import get_current_user
# pyrefly: ignore [missing-import]
from app.services.rag import RAGService, EMBEDDING_DIMS

router = APIRouter()

# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schemas
# ─────────────────────────────────────────────────────────────────────────────

class DocumentResponse(BaseModel):
    id: str
    filename: str
    file_type: str
    file_size: int
    chunk_count: int
    index_status: str           # "indexed" | "reindexing" | "failed"
    embedding_model_used: str
    created_at: datetime

    class Config:
        from_attributes = True


class RAGConfigRequest(BaseModel):
    """Payload for saving an agent's RAG configuration."""
    # Embedding
    embedding_provider: str           # openai | gemini | cohere | voyage
    embedding_model: str              # e.g. text-embedding-3-small
    embedding_api_key: Optional[str] = None   # omit / null to keep existing key

    # Vector DB
    vector_db_provider: str           # qdrant | pinecone | weaviate | chroma
    vector_db_url: Optional[str] = None
    vector_db_api_key: Optional[str] = None   # omit / null to keep existing key
    vector_db_index: Optional[str] = None     # Pinecone index name

    # Chunking
    chunk_strategy: str = "fixed"     # fixed | sentence | paragraph
    chunk_size: int = 600
    chunk_overlap: int = 150


class RAGConfigResponse(BaseModel):
    """Serialised RAG config — API keys are masked for security."""
    agent_id: str
    embedding_provider: str
    embedding_model: str
    embedding_dim: int
    embedding_api_key_set: bool       # True if a key is stored (never exposes the value)

    vector_db_provider: str
    vector_db_url: Optional[str]
    vector_db_index: Optional[str]
    vector_db_api_key_set: bool

    chunk_strategy: str               # fixed | sentence | paragraph
    chunk_size: int
    chunk_overlap: int

    updated_at: Optional[datetime]

    class Config:
        from_attributes = True


class TestConnectionRequest(BaseModel):
    """Payload for the credentials test endpoint."""
    embedding_provider: str
    embedding_model: str
    embedding_api_key: Optional[str] = None

    vector_db_provider: str
    vector_db_url: Optional[str] = None
    vector_db_api_key: Optional[str] = None
    vector_db_index: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _serialize_config(cfg: RAGConfigORM) -> RAGConfigResponse:
    return RAGConfigResponse(
        agent_id=cfg.agent_id,
        embedding_provider=cfg.embedding_provider,
        embedding_model=cfg.embedding_model,
        embedding_dim=cfg.embedding_dim,
        embedding_api_key_set=bool(cfg.embedding_api_key),
        vector_db_provider=cfg.vector_db_provider,
        vector_db_url=cfg.vector_db_url,
        vector_db_index=cfg.vector_db_index,
        vector_db_api_key_set=bool(cfg.vector_db_api_key),
        chunk_strategy=cfg.chunk_strategy,
        chunk_size=cfg.chunk_size,
        chunk_overlap=cfg.chunk_overlap,
        updated_at=cfg.updated_at,
    )


async def _assert_agent_ownership(agent_id: str, user_id: str, db: AsyncSession) -> AgentORM:
    """Raise 404 if agent doesn't exist or doesn't belong to user."""
    stmt = select(AgentORM).where(AgentORM.id == agent_id, AgentORM.user_id == user_id)
    res = await db.execute(stmt)
    agent = res.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found or unauthorized access.")
    return agent


# ─────────────────────────────────────────────────────────────────────────────
# RAG Config endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/config/test")
async def test_rag_connection(
    payload: TestConnectionRequest,
    current_user: UserORM = Depends(get_current_user),
):
    """
    Test embedding + vector DB credentials without saving anything.
    Returns {embedding_ok, vector_db_ok, errors}.
    """
    result = await RAGService.test_connection(
        embedding_provider=payload.embedding_provider,
        embedding_model=payload.embedding_model,
        embedding_api_key=payload.embedding_api_key,
        vector_db_provider=payload.vector_db_provider,
        vector_db_url=payload.vector_db_url,
        vector_db_api_key=payload.vector_db_api_key,
        vector_db_index=payload.vector_db_index,
    )
    return result

@router.get("/config/{agent_id}", response_model=RAGConfigResponse)
async def get_rag_config(
    agent_id: str,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Fetch the agent's current RAG configuration. API keys are masked."""
    await _assert_agent_ownership(agent_id, current_user.id, db)
    cfg = await RAGService.get_config(db, agent_id, current_user.id)
    return _serialize_config(cfg)


@router.post("/config/{agent_id}", response_model=RAGConfigResponse)
async def save_rag_config(
    agent_id: str,
    payload: RAGConfigRequest,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Save (create or update) the RAG configuration for an agent.
    Passing null/omitted for *_api_key keeps the previously stored key.
    """
    await _assert_agent_ownership(agent_id, current_user.id, db)

    # Validate model is known
    if payload.embedding_model not in EMBEDDING_DIMS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown embedding model '{payload.embedding_model}'. "
                   f"Supported: {list(EMBEDDING_DIMS.keys())}",
        )

    # Validate chunk strategy
    if payload.chunk_strategy not in ("fixed", "sentence", "paragraph"):
        raise HTTPException(
            status_code=400,
            detail=f"Invalid chunk_strategy '{payload.chunk_strategy}'. Must be: fixed | sentence | paragraph",
        )

    cfg = await RAGService.save_config(
        db=db,
        agent_id=agent_id,
        user_id=current_user.id,
        embedding_provider=payload.embedding_provider,
        embedding_model=payload.embedding_model,
        embedding_api_key=payload.embedding_api_key,
        vector_db_provider=payload.vector_db_provider,
        vector_db_url=payload.vector_db_url,
        vector_db_api_key=payload.vector_db_api_key,
        vector_db_index=payload.vector_db_index,
        chunk_strategy=payload.chunk_strategy,
        chunk_size=payload.chunk_size,
        chunk_overlap=payload.chunk_overlap,
    )
    return _serialize_config(cfg)


@router.post("/reindex/{agent_id}")
async def reindex_agent_documents(
    agent_id: str,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Re-embed all documents for this agent using the currently saved RAG config.

    Trigger this after:
    - Changing the embedding model (new dimensions → new collection)
    - Changing chunk strategy / size / overlap

    Each document is processed individually: old vectors deleted, file re-parsed,
    re-chunked with current strategy, re-embedded, re-indexed. Failures per
    document are recorded but do not abort the rest.

    Returns {reindexed, failed, total, errors}.
    """
    await _assert_agent_ownership(agent_id, current_user.id, db)
    try:
        result = await RAGService.reindex_agent(
            db=db,
            agent_id=agent_id,
            user_id=current_user.id,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Re-index failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Document endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/search")
async def search_agent_knowledge(
    agent_id: str,
    query: str,
    limit: int = 4,
    db: AsyncSession = Depends(get_db),
):
    """
    Internal semantic search called by the agent worker.
    No auth required — this is an internal service endpoint.
    """
    try:
        from sqlalchemy import select
        from app.models.orm import AgentORM
        stmt = select(AgentORM).where(AgentORM.id == agent_id)
        res = await db.execute(stmt)
        agent = res.scalar_one_or_none()
        if not agent:
            return []
        results = await RAGService.search_knowledge(
            agent_id=agent_id,
            query=query,
            limit=limit,
            db=db,
            user_id=agent.user_id,
        )
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/agent/{agent_id}", response_model=List[DocumentResponse])
async def list_agent_documents(
    agent_id: str,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all knowledge documents associated with a specific agent."""
    await _assert_agent_ownership(agent_id, current_user.id, db)

    stmt = select(DocumentORM).where(
        DocumentORM.agent_id == agent_id,
        DocumentORM.user_id == current_user.id,
    ).order_by(DocumentORM.created_at.desc())
    res = await db.execute(stmt)
    return res.scalars().all()


@router.post("/agent/{agent_id}", response_model=DocumentResponse)
async def upload_agent_document(
    agent_id: str,
    file: UploadFile = File(...),
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Upload a PDF or TXT file and index it in the agent's knowledge base."""
    await _assert_agent_ownership(agent_id, current_user.id, db)

    filename = file.filename or "unknown"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in [".pdf", ".txt"]:
        raise HTTPException(status_code=400, detail="Only PDF (.pdf) and Text (.txt) files are supported.")

    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}")

    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File exceeds 15 MB limit.")

    try:
        doc = await RAGService.add_document(
            db=db,
            agent_id=agent_id,
            user_id=current_user.id,
            file_content=content,
            filename=filename,
        )
        return doc
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Indexing error: {e}")


@router.delete("/{document_id}")
async def delete_agent_document(
    document_id: str,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a document and remove all its indexed vectors."""
    try:
        await RAGService.delete_document(db=db, document_id=document_id, user_id=current_user.id)
        return {"status": "success", "message": "Document deleted successfully."}
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Delete failed: {e}")
