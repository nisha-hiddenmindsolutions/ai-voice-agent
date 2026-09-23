"""
agent/tools/rag.py

Knowledge-base search tool. Every agent that has an agent_id gets this
tool automatically (see registry.build_tools) so it can ground factual
answers in the user's uploaded documents instead of hallucinating.
"""

import logging
from typing import Annotated

from pydantic import Field

from livekit.agents import function_tool

from .http_client import ToolHTTPError, request_json

logger = logging.getLogger("agent-tools.rag")


def build_rag_tool(agent_id: str, backend_url: str):
    async def rag_system(
        query: Annotated[
            str, Field(description="Specific question or topic to look up in the reference documents.")
        ],
    ) -> str:
        """Search uploaded PDF/text reference files or knowledge base for relevant information."""
        logger.info(f"[RAG] agent={agent_id} query={query!r}")
        url = f"{backend_url}/api/v1/knowledge/search"
        try:
            status, data = await request_json(
                "GET", url,
                params={"agent_id": agent_id, "query": query, "limit": 4},
                timeout=8.0,
                retries=1,
            )
            if status != 200:
                return f"Search Error (Status {status}): {data}"
            if not data:
                return "No relevant information found in the knowledge base."
            chunks = [
                f"Source: {item.get('filename')}\n{item.get('text')}\n---"
                for item in data
            ]
            text = "\n\n".join(chunks)
            logger.info(f"[RAG] returning {len(data)} results ({len(text)} chars)")
            return text
        except ToolHTTPError as exc:
            return f"Knowledge base is unreachable right now: {exc}"
        except Exception as exc:
            logger.error(f"[RAG] exception: {exc}")
            return f"Search Error: {exc}"

    return function_tool(
        rag_system,
        name="rag_system",
        description=(
            "Search reference documents, guidelines, or uploaded PDFs in the knowledge base. "
            "Always call this before answering factual questions about services, pricing, or policies."
        ),
    )