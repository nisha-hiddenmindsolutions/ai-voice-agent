"""
RAG Service — Multi-Provider Architecture
==========================================
Supports pluggable Embedding Providers and Vector DB Providers.
Each agent can have its own independent RAG configuration stored in RAGConfigORM.

Embedding providers : openai | gemini | cohere | voyage
Vector DB providers : qdrant | pinecone | weaviate | chroma
"""
from __future__ import annotations

import hashlib
import io
import logging
import os
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, List, Optional

import httpx
import numpy as np
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# pyrefly: ignore [missing-import]
from app.core.config import settings
# pyrefly: ignore [missing-import]
from app.core.security import vault
# pyrefly: ignore [missing-import]
from app.models.orm import DocumentORM, RAGConfigORM

logger = logging.getLogger("rag-service")

# ─────────────────────────────────────────────────────────────────────────────
# Dimension map — used to set vector DB collection size and validate config
# ─────────────────────────────────────────────────────────────────────────────
EMBEDDING_DIMS: Dict[str, int] = {
    # OpenAI
    "text-embedding-3-small":       1536,
    "text-embedding-3-large":       3072,
    "text-embedding-ada-002":       1536,
    # Google Gemini
    "gemini-embedding-2":           768,
    "text-embedding-004":           768,
    # Cohere
    "embed-english-v3.0":           1024,
    "embed-multilingual-v3.0":      1024,
    "embed-english-light-v3.0":     384,
    # Voyage AI
    "voyage-3":                     1024,
    "voyage-3-lite":                512,
    "voyage-finance-2":             1024,
    "voyage-law-2":                 1024,
}


# ─────────────────────────────────────────────────────────────────────────────
# Abstract interfaces
# ─────────────────────────────────────────────────────────────────────────────

class EmbeddingProvider(ABC):
    """Generates vector embeddings for text chunks."""

    def __init__(self, api_key: str, model: str, dim: int):
        self.api_key = api_key
        self.model = model
        self.dim = dim

    @abstractmethod
    async def embed(self, texts: List[str], is_query: bool = False) -> List[List[float]]:
        """Returns a list of embedding vectors, one per input text."""

    def _fallback_embed(self, texts: List[str]) -> List[List[float]]:
        """Deterministic pseudo-embedding fallback (hash-seeded). Never use in production."""
        logger.warning("Using deterministic pseudo-embedding fallback — NOT suitable for production!")
        result = []
        for text in texts:
            seed = int(hashlib.sha256(text.encode()).hexdigest()[:8], 16)
            rng = np.random.default_rng(seed)
            vec = rng.standard_normal(self.dim)
            vec /= np.linalg.norm(vec)
            result.append(vec.tolist())
        return result


class VectorDBProvider(ABC):
    """Stores and retrieves vector embeddings."""

    @abstractmethod
    async def ensure_collection(self, collection_name: str, dim: int) -> None:
        """Create the collection/index if it does not already exist."""

    @abstractmethod
    async def upsert(self, collection_name: str, points: List[Dict[str, Any]]) -> None:
        """
        Insert or update vectors.
        Each point: {id, vector, payload}
        """

    @abstractmethod
    async def search(
        self,
        collection_name: str,
        query_vector: List[float],
        agent_id: str,
        limit: int,
    ) -> List[Dict[str, Any]]:
        """
        Semantic search filtered by agent_id.
        Returns list of {text, filename, score}.
        """

    @abstractmethod
    async def delete_by_document(self, collection_name: str, document_id: str) -> None:
        """Delete all vectors whose payload.document_id == document_id."""

    @abstractmethod
    async def ensure_payload_indexes(self, collection_name: str) -> None:
        """Create payload/metadata indexes needed for filtered search (Qdrant specific, no-op elsewhere)."""


# ─────────────────────────────────────────────────────────────────────────────
# Embedding Provider implementations
# ─────────────────────────────────────────────────────────────────────────────

class OpenAIEmbeddingProvider(EmbeddingProvider):
    """Uses OpenAI /v1/embeddings — supports text-embedding-3-small/large and ada-002."""

    async def embed(self, texts: List[str], is_query: bool = False) -> List[List[float]]:
        if not self.api_key:
            return self._fallback_embed(texts)
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://api.openai.com/v1/embeddings",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={"model": self.model, "input": texts},
                    timeout=30.0,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    sorted_items = sorted(data["data"], key=lambda x: x["index"])
                    return [item["embedding"] for item in sorted_items]
                logger.warning(f"OpenAI embedding failed ({resp.status_code}): {resp.text[:300]}")
        except Exception as e:
            logger.error(f"OpenAI embedding exception: {e}")
        return self._fallback_embed(texts)


class GeminiEmbeddingProvider(EmbeddingProvider):
    """Uses Google Gemini batchEmbedContents — supports gemini-embedding-2 and text-embedding-004."""

    async def embed(self, texts: List[str], is_query: bool = False) -> List[List[float]]:
        if not self.api_key:
            return self._fallback_embed(texts)
        task_type = "RETRIEVAL_QUERY" if is_query else "RETRIEVAL_DOCUMENT"
        requests_payload = [
            {
                "model": f"models/{self.model}",
                "outputDimensionality": self.dim,
                "taskType": task_type,
                "content": {"parts": [{"text": t}]},
            }
            for t in texts
        ]
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:batchEmbedContents",
                    headers={
                        "Content-Type": "application/json",
                        "x-goog-api-key": self.api_key,
                    },
                    json={"requests": requests_payload},
                    timeout=30.0,
                )
                if resp.status_code == 200:
                    return [item["values"] for item in resp.json()["embeddings"]]
                logger.warning(f"Gemini embedding failed ({resp.status_code}): {resp.text[:300]}")
        except Exception as e:
            logger.error(f"Gemini embedding exception: {e}")
        return self._fallback_embed(texts)


class CohereEmbeddingProvider(EmbeddingProvider):
    """Uses Cohere /v1/embed — supports embed-english-v3.0 and multilingual variants."""

    async def embed(self, texts: List[str], is_query: bool = False) -> List[List[float]]:
        if not self.api_key:
            return self._fallback_embed(texts)
        input_type = "search_query" if is_query else "search_document"
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://api.cohere.com/v1/embed",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "texts": texts,
                        "model": self.model,
                        "input_type": input_type,
                        "embedding_types": ["float"],
                    },
                    timeout=30.0,
                )
                if resp.status_code == 200:
                    return resp.json()["embeddings"]["float"]
                logger.warning(f"Cohere embedding failed ({resp.status_code}): {resp.text[:300]}")
        except Exception as e:
            logger.error(f"Cohere embedding exception: {e}")
        return self._fallback_embed(texts)


class VoyageEmbeddingProvider(EmbeddingProvider):
    """Uses Voyage AI /v1/embeddings — supports voyage-3 and voyage-3-lite."""

    async def embed(self, texts: List[str], is_query: bool = False) -> List[List[float]]:
        if not self.api_key:
            return self._fallback_embed(texts)
        input_type = "query" if is_query else "document"
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://api.voyageai.com/v1/embeddings",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "input": texts,
                        "model": self.model,
                        "input_type": input_type,
                    },
                    timeout=30.0,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    sorted_items = sorted(data["data"], key=lambda x: x["index"])
                    return [item["embedding"] for item in sorted_items]
                logger.warning(f"Voyage embedding failed ({resp.status_code}): {resp.text[:300]}")
        except Exception as e:
            logger.error(f"Voyage embedding exception: {e}")
        return self._fallback_embed(texts)


# ─────────────────────────────────────────────────────────────────────────────
# Vector DB Provider implementations
# ─────────────────────────────────────────────────────────────────────────────

class QdrantVectorDBProvider(VectorDBProvider):
    """Qdrant Cloud or self-hosted. Uses qdrant-client."""

    def __init__(self, url: str, api_key: Optional[str]):
        from qdrant_client import QdrantClient
        self._client = QdrantClient(url=url, api_key=api_key or None)

    async def ensure_collection(self, collection_name: str, dim: int) -> None:
        from qdrant_client.http import models as qm
        try:
            if not self._client.collection_exists(collection_name):
                self._client.create_collection(
                    collection_name=collection_name,
                    vectors_config=qm.VectorParams(size=dim, distance=qm.Distance.COSINE),
                )
                logger.info(f"[Qdrant] Created collection '{collection_name}' ({dim}d)")
        except Exception as e:
            logger.error(f"[Qdrant] ensure_collection error: {e}")

    async def ensure_payload_indexes(self, collection_name: str) -> None:
        from qdrant_client.http import models as qm
        for field in ["document_id", "agent_id"]:
            try:
                self._client.create_payload_index(
                    collection_name=collection_name,
                    field_name=field,
                    field_schema=qm.PayloadSchemaType.KEYWORD,
                )
            except Exception:
                pass  # index already exists

    async def upsert(self, collection_name: str, points: List[Dict[str, Any]]) -> None:
        from qdrant_client.http import models as qm
        qdrant_points = [
            qm.PointStruct(id=p["id"], vector=p["vector"], payload=p["payload"])
            for p in points
        ]
        batch_size = 100
        for offset in range(0, len(qdrant_points), batch_size):
            self._client.upsert(
                collection_name=collection_name,
                points=qdrant_points[offset : offset + batch_size],
            )

    async def search(
        self,
        collection_name: str,
        query_vector: List[float],
        agent_id: str,
        limit: int,
    ) -> List[Dict[str, Any]]:
        from qdrant_client.http import models as qm
        result = self._client.query_points(
            collection_name=collection_name,
            query=query_vector,
            query_filter=qm.Filter(
                must=[qm.FieldCondition(key="agent_id", match=qm.MatchValue(value=agent_id))]
            ),
            limit=limit,
        )
        return [
            {"text": p.payload.get("text", ""), "filename": p.payload.get("filename", ""), "score": p.score}
            for p in result.points
        ]

    async def delete_by_document(self, collection_name: str, document_id: str) -> None:
        from qdrant_client.http import models as qm
        self._client.delete(
            collection_name=collection_name,
            points_selector=qm.FilterSelector(
                filter=qm.Filter(
                    must=[qm.FieldCondition(key="document_id", match=qm.MatchValue(value=document_id))]
                )
            ),
        )


class PineconeVectorDBProvider(VectorDBProvider):
    """Pinecone serverless. Uses the pinecone Python SDK."""

    def __init__(self, api_key: str, index_name: str):
        from pinecone import Pinecone
        pc = Pinecone(api_key=api_key)
        self._index = pc.Index(index_name)
        self._index_name = index_name

    async def ensure_collection(self, collection_name: str, dim: int) -> None:
        # Pinecone indexes are pre-created by the user; we just validate connectivity
        try:
            stats = self._index.describe_index_stats()
            logger.info(f"[Pinecone] Index '{self._index_name}' ready. Vectors: {stats.total_vector_count}")
        except Exception as e:
            logger.error(f"[Pinecone] ensure_collection connectivity check failed: {e}")
            raise

    async def ensure_payload_indexes(self, collection_name: str) -> None:
        pass  # Pinecone metadata filtering is automatic

    async def upsert(self, collection_name: str, points: List[Dict[str, Any]]) -> None:
        vectors = [
            (p["id"], p["vector"], p["payload"])
            for p in points
        ]
        batch_size = 100
        for offset in range(0, len(vectors), batch_size):
            self._index.upsert(vectors=vectors[offset : offset + batch_size], namespace=collection_name)

    async def search(
        self,
        collection_name: str,
        query_vector: List[float],
        agent_id: str,
        limit: int,
    ) -> List[Dict[str, Any]]:
        result = self._index.query(
            vector=query_vector,
            top_k=limit,
            namespace=collection_name,
            filter={"agent_id": {"$eq": agent_id}},
            include_metadata=True,
        )
        return [
            {
                "text": m.metadata.get("text", ""),
                "filename": m.metadata.get("filename", ""),
                "score": m.score,
            }
            for m in result.matches
        ]

    async def delete_by_document(self, collection_name: str, document_id: str) -> None:
        self._index.delete(
            filter={"document_id": {"$eq": document_id}},
            namespace=collection_name,
        )


class WeaviateVectorDBProvider(VectorDBProvider):
    """Weaviate Cloud Services or self-hosted (v4 client)."""

    def __init__(self, url: str, api_key: Optional[str]):
        import weaviate
        auth = weaviate.auth.AuthApiKey(api_key) if api_key else None
        self._client = weaviate.connect_to_custom(
            http_host=url.rstrip("/"),
            http_port=443,
            http_secure=True,
            grpc_host=url.rstrip("/"),
            grpc_port=50051,
            grpc_secure=True,
            auth_credentials=auth,
        )

    async def ensure_collection(self, collection_name: str, dim: int) -> None:
        import weaviate.classes.config as wc
        try:
            if not self._client.collections.exists(collection_name):
                self._client.collections.create(
                    name=collection_name,
                    vectorizer_config=wc.Configure.Vectorizer.none(),
                    properties=[
                        wc.Property(name="document_id", data_type=wc.DataType.TEXT),
                        wc.Property(name="agent_id", data_type=wc.DataType.TEXT),
                        wc.Property(name="filename", data_type=wc.DataType.TEXT),
                        wc.Property(name="chunk_index", data_type=wc.DataType.INT),
                        wc.Property(name="text", data_type=wc.DataType.TEXT),
                    ],
                )
                logger.info(f"[Weaviate] Created collection '{collection_name}'")
        except Exception as e:
            logger.error(f"[Weaviate] ensure_collection error: {e}")
            raise

    async def ensure_payload_indexes(self, collection_name: str) -> None:
        pass  # Weaviate indexes properties automatically

    async def upsert(self, collection_name: str, points: List[Dict[str, Any]]) -> None:
        collection = self._client.collections.get(collection_name)
        with collection.batch.dynamic() as batch:
            for p in points:
                batch.add_object(
                    properties=p["payload"],
                    vector=p["vector"],
                    uuid=p["id"],
                )

    async def search(
        self,
        collection_name: str,
        query_vector: List[float],
        agent_id: str,
        limit: int,
    ) -> List[Dict[str, Any]]:
        import weaviate.classes.query as wq
        collection = self._client.collections.get(collection_name)
        result = collection.query.near_vector(
            near_vector=query_vector,
            limit=limit,
            filters=wq.Filter.by_property("agent_id").equal(agent_id),
            return_metadata=wq.MetadataQuery(certainty=True),
        )
        return [
            {
                "text": o.properties.get("text", ""),
                "filename": o.properties.get("filename", ""),
                "score": o.metadata.certainty or 0.0,
            }
            for o in result.objects
        ]

    async def delete_by_document(self, collection_name: str, document_id: str) -> None:
        import weaviate.classes.query as wq
        collection = self._client.collections.get(collection_name)
        collection.data.delete_many(
            where=wq.Filter.by_property("document_id").equal(document_id)
        )


class ChromaVectorDBProvider(VectorDBProvider):
    """ChromaDB HTTP client (self-hosted)."""

    def __init__(self, url: str):
        import chromadb
        self._client = chromadb.HttpClient(host=url.rstrip("/"))

    def _get_collection(self, collection_name: str):
        return self._client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )

    async def ensure_collection(self, collection_name: str, dim: int) -> None:
        try:
            col = self._get_collection(collection_name)
            logger.info(f"[Chroma] Collection '{collection_name}' ready. Count: {col.count()}")
        except Exception as e:
            logger.error(f"[Chroma] ensure_collection error: {e}")
            raise

    async def ensure_payload_indexes(self, collection_name: str) -> None:
        pass  # Chroma supports metadata filtering natively

    async def upsert(self, collection_name: str, points: List[Dict[str, Any]]) -> None:
        col = self._get_collection(collection_name)
        col.upsert(
            ids=[p["id"] for p in points],
            embeddings=[p["vector"] for p in points],
            metadatas=[p["payload"] for p in points],
            documents=[p["payload"].get("text", "") for p in points],
        )

    async def search(
        self,
        collection_name: str,
        query_vector: List[float],
        agent_id: str,
        limit: int,
    ) -> List[Dict[str, Any]]:
        col = self._get_collection(collection_name)
        result = col.query(
            query_embeddings=[query_vector],
            n_results=limit,
            where={"agent_id": agent_id},
        )
        output = []
        for i, doc in enumerate(result["documents"][0]):
            meta = result["metadatas"][0][i]
            dist = result["distances"][0][i]
            output.append({
                "text": doc,
                "filename": meta.get("filename", ""),
                "score": 1.0 - dist,  # convert cosine distance → similarity
            })
        return output

    async def delete_by_document(self, collection_name: str, document_id: str) -> None:
        col = self._get_collection(collection_name)
        col.delete(where={"document_id": document_id})


# ─────────────────────────────────────────────────────────────────────────────
# Provider factories
# ─────────────────────────────────────────────────────────────────────────────

def build_embedding_provider(cfg: RAGConfigORM) -> EmbeddingProvider:
    """Instantiate the correct EmbeddingProvider from a RAGConfigORM row."""
    api_key = vault.decrypt(cfg.embedding_api_key) if cfg.embedding_api_key else ""
    dim = cfg.embedding_dim or EMBEDDING_DIMS.get(cfg.embedding_model, 768)

    provider_map = {
        "openai":  OpenAIEmbeddingProvider,
        "gemini":  GeminiEmbeddingProvider,
        "cohere":  CohereEmbeddingProvider,
        "voyage":  VoyageEmbeddingProvider,
    }
    cls = provider_map.get(cfg.embedding_provider)
    if cls is None:
        raise ValueError(f"Unknown embedding provider: '{cfg.embedding_provider}'")
    return cls(api_key=api_key, model=cfg.embedding_model, dim=dim)


def build_vector_db_provider(cfg: RAGConfigORM) -> VectorDBProvider:
    """Instantiate the correct VectorDBProvider from a RAGConfigORM row."""
    api_key = vault.decrypt(cfg.vector_db_api_key) if cfg.vector_db_api_key else ""

    if cfg.vector_db_provider == "qdrant":
        url = cfg.vector_db_url
        if not url:
            raise ValueError(
                "Qdrant requires a Cluster URL. "
                "Please set it in the RAG Configuration panel."
            )
        return QdrantVectorDBProvider(url=url, api_key=api_key or None)

    if cfg.vector_db_provider == "pinecone":
        if not cfg.vector_db_index:
            raise ValueError("Pinecone requires a vector_db_index (index name).")
        return PineconeVectorDBProvider(api_key=api_key, index_name=cfg.vector_db_index)

    if cfg.vector_db_provider == "weaviate":
        return WeaviateVectorDBProvider(url=cfg.vector_db_url or "", api_key=api_key or None)

    if cfg.vector_db_provider == "chroma":
        return ChromaVectorDBProvider(url=cfg.vector_db_url or "http://localhost:8080")

    raise ValueError(f"Unknown vector DB provider: '{cfg.vector_db_provider}'")


def collection_name_for_agent(agent_id: str, embedding_model: str) -> str:
    """
    Each agent+model combination gets its own isolated collection/namespace.
    This prevents cross-agent data leakage and avoids dimension mismatches
    when an agent switches embedding models.
    """
    safe_model = embedding_model.replace("-", "_").replace(".", "_")
    return f"agent_{agent_id[:8]}_{safe_model}"


# ─────────────────────────────────────────────────────────────────────────────
# Default RAG config (used when an agent has no RAGConfigORM row yet)
# Falls back to the global .env Qdrant + Gemini setup from the old system
# ─────────────────────────────────────────────────────────────────────────────

def _default_rag_config(agent_id: str, user_id: str) -> RAGConfigORM:
    cfg = RAGConfigORM(
        agent_id=agent_id,
        user_id=user_id,
        embedding_provider="gemini",
        embedding_model="gemini-embedding-2",
        embedding_dim=768,
        embedding_api_key=None,
        vector_db_provider="qdrant",
        vector_db_url=None,
        vector_db_api_key=None,
        chunk_size=600,
        chunk_overlap=150,
    )
    return cfg


# ─────────────────────────────────────────────────────────────────────────────
# Text utilities
# ─────────────────────────────────────────────────────────────────────────────

def _parse_document(file_content: bytes, filename: str) -> tuple[str, str]:
    """Extract plain text from a PDF or TXT file. Returns (text, file_type)."""
    if filename.lower().endswith(".pdf"):
        try:
            reader = PdfReader(io.BytesIO(file_content))
            pages = [p.extract_text() or "" for p in reader.pages]
            return "\n".join(pages), "pdf"
        except Exception as e:
            raise ValueError(f"Failed to parse PDF '{filename}': {e}")
    else:
        try:
            return file_content.decode("utf-8", errors="ignore"), "txt"
        except Exception as e:
            raise ValueError(f"Failed to decode text file '{filename}': {e}")


# ─────────────────────────────────────────────────────────────────────────────
# Chunking strategies
# ─────────────────────────────────────────────────────────────────────────────

def _chunk_fixed(text: str, chunk_size: int = 600, overlap: int = 150) -> List[str]:
    """
    Fixed-size character chunking with overlap.
    Fast, predictable, best for dense reference docs and technical manuals.
    """
    if not text:
        return []
    chunks, start = [], 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks


def _chunk_sentence(text: str, chunk_size: int = 600, overlap: int = 150) -> List[str]:
    """
    Sentence-aware chunking: accumulate sentences until the chunk_size limit is
    reached, then start a new chunk. Overlap is expressed in characters and
    re-attaches the tail sentences from the previous chunk.
    Preserves sentence boundaries — ideal for Q&A and conversational content.
    """
    import re
    if not text:
        return []

    # Split on sentence-ending punctuation followed by whitespace or end-of-string
    sentence_endings = re.compile(r'(?<=[.!?])\s+')
    raw_sentences = sentence_endings.split(text.strip())
    sentences = [s.strip() for s in raw_sentences if s.strip()]

    chunks: List[str] = []
    current_parts: List[str] = []
    current_len = 0

    for sentence in sentences:
        slen = len(sentence)
        if current_len + slen + 1 > chunk_size and current_parts:
            chunk_text = " ".join(current_parts)
            chunks.append(chunk_text)

            # Roll back by overlap characters worth of sentences
            overlap_parts: List[str] = []
            overlap_len = 0
            for part in reversed(current_parts):
                if overlap_len + len(part) + 1 <= overlap:
                    overlap_parts.insert(0, part)
                    overlap_len += len(part) + 1
                else:
                    break
            current_parts = overlap_parts
            current_len = overlap_len

        current_parts.append(sentence)
        current_len += slen + 1

    if current_parts:
        chunks.append(" ".join(current_parts))

    return chunks


def _chunk_paragraph(text: str, chunk_size: int = 600, overlap: int = 150) -> List[str]:
    """
    Paragraph-aware chunking: splits on blank lines, then groups paragraphs
    until chunk_size is reached. Overlap re-attaches the last paragraph.
    Best for structured documents (reports, legal docs, FAQs) where each
    paragraph is a cohesive unit of meaning.
    """
    import re
    if not text:
        return []

    raw_paragraphs = re.split(r'\n\s*\n', text.strip())
    paragraphs = [p.strip() for p in raw_paragraphs if p.strip()]

    # If the document has no paragraph breaks, fall back to fixed chunking
    if len(paragraphs) == 1:
        return _chunk_fixed(text, chunk_size, overlap)

    chunks: List[str] = []
    current_parts: List[str] = []
    current_len = 0

    for para in paragraphs:
        plen = len(para)
        # A single paragraph bigger than chunk_size gets fixed-chunked on its own
        if plen > chunk_size:
            if current_parts:
                chunks.append("\n\n".join(current_parts))
                current_parts = []
                current_len = 0
            chunks.extend(_chunk_fixed(para, chunk_size, overlap))
            continue

        if current_len + plen + 2 > chunk_size and current_parts:
            chunks.append("\n\n".join(current_parts))
            # Overlap: keep the last paragraph
            last = current_parts[-1]
            current_parts = [last] if len(last) <= overlap else []
            current_len = len(last) + 2 if current_parts else 0

        current_parts.append(para)
        current_len += plen + 2

    if current_parts:
        chunks.append("\n\n".join(current_parts))

    return chunks


def _chunk_text(
    text: str,
    strategy: str = "fixed",
    chunk_size: int = 600,
    overlap: int = 150,
) -> List[str]:
    """
    Route to the right chunking strategy.
    strategy: "fixed" | "sentence" | "paragraph"
    """
    if strategy == "sentence":
        return _chunk_sentence(text, chunk_size, overlap)
    if strategy == "paragraph":
        return _chunk_paragraph(text, chunk_size, overlap)
    return _chunk_fixed(text, chunk_size, overlap)


# ─────────────────────────────────────────────────────────────────────────────
# RAGService — public API used by endpoints
# ─────────────────────────────────────────────────────────────────────────────

class RAGService:
    """
    High-level orchestration layer.
    All methods accept the SQLAlchemy AsyncSession so they can load/store
    RAGConfigORM rows and DocumentORM rows within the same transaction.
    """

    # ── Config management ─────────────────────────────────────────────────────

    @classmethod
    async def get_config(cls, db: AsyncSession, agent_id: str, user_id: str) -> RAGConfigORM:
        """Return the agent's RAGConfigORM, creating a default one if missing."""
        stmt = select(RAGConfigORM).where(RAGConfigORM.agent_id == agent_id)
        res = await db.execute(stmt)
        cfg = res.scalar_one_or_none()
        if cfg is None:
            cfg = _default_rag_config(agent_id, user_id)
            db.add(cfg)
            await db.commit()
            await db.refresh(cfg)
        return cfg

    @classmethod
    async def save_config(
        cls,
        db: AsyncSession,
        agent_id: str,
        user_id: str,
        embedding_provider: str,
        embedding_model: str,
        embedding_api_key: Optional[str],
        vector_db_provider: str,
        vector_db_url: Optional[str],
        vector_db_api_key: Optional[str],
        vector_db_index: Optional[str],
        chunk_strategy: str = "fixed",
        chunk_size: int = 600,
        chunk_overlap: int = 150,
    ) -> RAGConfigORM:
        """
        Upsert the RAG configuration for an agent.
        API keys are encrypted before persisting.
        """
        dim = EMBEDDING_DIMS.get(embedding_model, 768)

        stmt = select(RAGConfigORM).where(RAGConfigORM.agent_id == agent_id)
        res = await db.execute(stmt)
        cfg = res.scalar_one_or_none()

        if cfg is None:
            cfg = RAGConfigORM(agent_id=agent_id, user_id=user_id)
            db.add(cfg)

        cfg.embedding_provider = embedding_provider
        cfg.embedding_model = embedding_model
        cfg.embedding_dim = dim
        if embedding_api_key is not None:
            cfg.embedding_api_key = vault.encrypt(embedding_api_key) if embedding_api_key else None

        cfg.vector_db_provider = vector_db_provider
        if vector_db_api_key is not None:
            cfg.vector_db_api_key = vault.encrypt(vector_db_api_key) if vector_db_api_key else None
        cfg.vector_db_url = vector_db_url
        cfg.vector_db_index = vector_db_index
        cfg.chunk_strategy = chunk_strategy
        cfg.chunk_size = chunk_size
        cfg.chunk_overlap = chunk_overlap

        await db.commit()
        await db.refresh(cfg)
        return cfg

    @classmethod
    async def test_connection(
        cls,
        embedding_provider: str,
        embedding_model: str,
        embedding_api_key: Optional[str],
        vector_db_provider: str,
        vector_db_url: Optional[str],
        vector_db_api_key: Optional[str],
        vector_db_index: Optional[str],
    ) -> Dict[str, Any]:
        """
        Validate credentials without persisting anything.
        Returns {embedding_ok, vector_db_ok, errors: []}.
        """
        errors: List[str] = []
        dim = EMBEDDING_DIMS.get(embedding_model, 768)

        # Build a throwaway config object (not an ORM row)
        class _TempCfg:
            pass

        tmp = _TempCfg()
        tmp.embedding_provider = embedding_provider
        tmp.embedding_model = embedding_model
        tmp.embedding_dim = dim
        tmp.embedding_api_key = vault.encrypt(embedding_api_key) if embedding_api_key else None
        tmp.vector_db_provider = vector_db_provider
        tmp.vector_db_api_key = vault.encrypt(vector_db_api_key) if vector_db_api_key else None
        tmp.vector_db_url = vector_db_url
        tmp.vector_db_index = vector_db_index

        embedding_ok = False
        vector_db_ok = False

        # Test embedding
        try:
            ep = build_embedding_provider(tmp)
            vecs = await ep.embed(["connection test"], is_query=True)
            embedding_ok = bool(vecs and len(vecs[0]) > 0)
        except Exception as e:
            errors.append(f"Embedding provider error: {e}")

        # Test vector DB
        try:
            vp = build_vector_db_provider(tmp)
            test_col = f"_test_{uuid.uuid4().hex[:8]}"
            await vp.ensure_collection(test_col, dim)
            vector_db_ok = True
        except Exception as e:
            errors.append(f"Vector DB error: {e}")

        return {"embedding_ok": embedding_ok, "vector_db_ok": vector_db_ok, "errors": errors}

    # ── Document management ───────────────────────────────────────────────────

    @classmethod
    async def add_document(
        cls,
        db: AsyncSession,
        agent_id: str,
        user_id: str,
        file_content: bytes,
        filename: str,
    ) -> DocumentORM:
        """
        Full pipeline: parse → chunk → embed → index → persist metadata.
        Uses the agent's saved RAGConfigORM (or default).
        """
        # 1. Load agent config
        cfg = await cls.get_config(db, agent_id, user_id)
        ep = build_embedding_provider(cfg)
        vp = build_vector_db_provider(cfg)
        col = collection_name_for_agent(agent_id, cfg.embedding_model)

        # 2. Ensure collection + indexes exist
        await vp.ensure_collection(col, cfg.embedding_dim)
        await vp.ensure_payload_indexes(col)

        # 3. Parse document
        text, file_type = _parse_document(file_content, filename)
        if not text.strip():
            raise ValueError("Document contains no readable text content.")

        # 4. Chunk
        chunks = _chunk_text(text, cfg.chunk_strategy, cfg.chunk_size, cfg.chunk_overlap)
        if not chunks:
            raise ValueError("Failed to split document into chunks.")

        # 5. Embed
        embeddings = await ep.embed(chunks, is_query=False)

        # 6. Save file to disk
        doc_id = str(uuid.uuid4())
        doc_dir = settings.DATA_DIR / "documents"
        doc_dir.mkdir(parents=True, exist_ok=True)
        ext = Path(filename).suffix.lower()
        with open(doc_dir / f"{doc_id}{ext}", "wb") as f:
            f.write(file_content)

        # 7. Upsert vectors
        points = [
            {
                "id": str(uuid.uuid4()),
                "vector": vec,
                "payload": {
                    "document_id": doc_id,
                    "agent_id": agent_id,
                    "filename": filename,
                    "chunk_index": i,
                    "text": chunk,
                },
            }
            for i, (chunk, vec) in enumerate(zip(chunks, embeddings))
        ]
        await vp.upsert(col, points)

        # 8. Persist metadata
        doc_orm = DocumentORM(
            id=doc_id,
            user_id=user_id,
            agent_id=agent_id,
            filename=filename,
            file_type=file_type,
            file_size=len(file_content),
            chunk_count=len(chunks),
            index_status="indexed",
            embedding_model_used=cfg.embedding_model,
        )
        db.add(doc_orm)
        await db.commit()
        await db.refresh(doc_orm)

        logger.info(
            f"[RAG] Indexed '{filename}' → {len(chunks)} chunks | "
            f"embed={cfg.embedding_provider}/{cfg.embedding_model} | "
            f"db={cfg.vector_db_provider} | col={col}"
        )
        return doc_orm

    @classmethod
    async def delete_document(cls, db: AsyncSession, document_id: str, user_id: str) -> None:
        """Remove vectors, disk file, and SQL metadata for a document."""
        stmt = select(DocumentORM).where(
            DocumentORM.id == document_id,
            DocumentORM.user_id == user_id,
        )
        res = await db.execute(stmt)
        doc = res.scalar_one_or_none()
        if not doc:
            raise ValueError("Document not found or unauthorized access.")

        cfg = await cls.get_config(db, doc.agent_id, user_id)
        vp = build_vector_db_provider(cfg)
        col = collection_name_for_agent(doc.agent_id, cfg.embedding_model)

        # Delete from vector DB
        try:
            await vp.delete_by_document(col, document_id)
        except Exception as e:
            logger.warning(f"[RAG] Vector delete failed for doc {document_id}: {e}")

        # Delete from disk
        doc_dir = settings.DATA_DIR / "documents"
        local_path = doc_dir / f"{document_id}.{doc.file_type}"
        if local_path.exists():
            try:
                local_path.unlink()
            except Exception as e:
                logger.warning(f"[RAG] Disk delete failed for {local_path}: {e}")

        await db.delete(doc)
        await db.commit()
        logger.info(f"[RAG] Deleted document {document_id}")

    # ── Re-index ──────────────────────────────────────────────────────────────

    @classmethod
    async def reindex_agent(
        cls,
        db: AsyncSession,
        agent_id: str,
        user_id: str,
    ) -> Dict[str, Any]:
        """
        Re-embed all documents for an agent using the current RAGConfigORM.

        Use this after changing:
          • embedding_provider / embedding_model  (dimension change requires new collection)
          • chunk_strategy / chunk_size / chunk_overlap

        Flow per document:
          1. Mark document as "reindexing"
          2. Delete old vectors from the OLD collection (identified by embedding_model_used)
          3. Re-parse the file from disk
          4. Re-chunk with current strategy + sizes
          5. Re-embed with current provider/model
          6. Upsert into NEW collection
          7. Update document metadata (chunk_count, embedding_model_used, index_status)

        Returns {reindexed, failed, errors}.
        """
        # Load current config
        cfg = await cls.get_config(db, agent_id, user_id)
        ep = build_embedding_provider(cfg)
        vp = build_vector_db_provider(cfg)
        new_col = collection_name_for_agent(agent_id, cfg.embedding_model)
        await vp.ensure_collection(new_col, cfg.embedding_dim)
        await vp.ensure_payload_indexes(new_col)

        # Fetch all documents for this agent
        stmt = select(DocumentORM).where(
            DocumentORM.agent_id == agent_id,
            DocumentORM.user_id == user_id,
        )
        res = await db.execute(stmt)
        docs: List[DocumentORM] = list(res.scalars().all())

        reindexed, failed = 0, 0
        errors: List[str] = []
        doc_dir = settings.DATA_DIR / "documents"

        for doc in docs:
            try:
                # Mark reindexing
                doc.index_status = "reindexing"
                await db.commit()

                # 1. Delete vectors from the old collection
                #    (may differ from new collection if model changed)
                old_model = doc.embedding_model_used or cfg.embedding_model
                old_col = collection_name_for_agent(agent_id, old_model)
                if old_col != new_col:
                    # Old collection used a different model — delete there
                    try:
                        old_vp = build_vector_db_provider(cfg)  # same DB, different collection
                        await old_vp.delete_by_document(old_col, doc.id)
                    except Exception as e:
                        logger.warning(f"[ReIndex] Could not delete old vectors for {doc.id} in '{old_col}': {e}")
                else:
                    await vp.delete_by_document(new_col, doc.id)

                # 2. Re-read file from disk
                ext = f".{doc.file_type}"
                local_path = doc_dir / f"{doc.id}{ext}"
                if not local_path.exists():
                    raise FileNotFoundError(f"Source file not found on disk: {local_path}")

                with open(local_path, "rb") as f:
                    file_content = f.read()

                # 3. Parse
                text, _ = _parse_document(file_content, doc.filename)
                if not text.strip():
                    raise ValueError("Document produced no readable text after re-parse.")

                # 4. Chunk with current strategy
                chunks = _chunk_text(text, cfg.chunk_strategy, cfg.chunk_size, cfg.chunk_overlap)

                # 5. Embed
                embeddings = await ep.embed(chunks, is_query=False)

                # 6. Upsert into new collection
                points = [
                    {
                        "id": str(uuid.uuid4()),
                        "vector": vec,
                        "payload": {
                            "document_id": doc.id,
                            "agent_id": agent_id,
                            "filename": doc.filename,
                            "chunk_index": i,
                            "text": chunk,
                        },
                    }
                    for i, (chunk, vec) in enumerate(zip(chunks, embeddings))
                ]
                await vp.upsert(new_col, points)

                # 7. Update metadata
                doc.chunk_count = len(chunks)
                doc.embedding_model_used = cfg.embedding_model
                doc.index_status = "indexed"
                await db.commit()

                reindexed += 1
                logger.info(
                    f"[ReIndex] '{doc.filename}' → {len(chunks)} chunks | "
                    f"model={cfg.embedding_model} | col={new_col}"
                )

            except Exception as e:
                failed += 1
                err_msg = f"'{doc.filename}': {e}"
                errors.append(err_msg)
                logger.error(f"[ReIndex] Failed for doc {doc.id}: {e}")
                try:
                    doc.index_status = "failed"
                    await db.commit()
                except Exception:
                    pass

        return {"reindexed": reindexed, "failed": failed, "total": len(docs), "errors": errors}

    # ── Semantic search ───────────────────────────────────────────────────────

    @classmethod
    async def search_knowledge(
        cls,
        agent_id: str,
        query: str,
        limit: int = 4,
        db: Optional[AsyncSession] = None,
        user_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Semantic search over an agent's knowledge base.
        Called by the agent worker at inference time.
        """
        if not query or not query.strip():
            return []

        if db is None or user_id is None:
            logger.warning(
                "[RAG] search_knowledge called without db/user_id — "
                "cannot perform search without a RAG config. Returning empty."
            )
            return []

        cfg = await cls.get_config(db, agent_id, user_id)

        if not cfg.embedding_api_key:
            logger.warning(f"[RAG] Agent {agent_id} has no embedding API key configured.")
            return []
        if not cfg.vector_db_api_key and cfg.vector_db_provider != "chroma":
            logger.warning(f"[RAG] Agent {agent_id} has no vector DB credentials configured.")
            return []

        ep = build_embedding_provider(cfg)
        vp = build_vector_db_provider(cfg)
        col = collection_name_for_agent(agent_id, cfg.embedding_model)

        query_vecs = await ep.embed([query], is_query=True)
        return await vp.search(col, query_vecs[0], agent_id, limit)