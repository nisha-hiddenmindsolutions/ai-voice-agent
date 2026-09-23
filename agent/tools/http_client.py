"""
agent/tools/http_client.py

Shared HTTP helper for every tool that calls an external API (Google
Calendar, Google Sheets, generic webhooks, the RAG search endpoint).

Centralizing this gives every tool, for free:
  - Bounded retries with exponential backoff on transient failures
    (timeouts, connection resets, 429/5xx) instead of failing a voice
    turn on a single blip.
  - Consistent JSON/text response handling.
  - A single exception type (ToolHTTPError) that callers can catch and
    turn into a short, spoken-friendly message instead of leaking a
    stack trace into the conversation.
"""

import asyncio
import logging
from typing import Any, Optional

import aiohttp

logger = logging.getLogger("agent-tools.http")

# Status codes worth retrying — everything else (4xx auth/validation
# errors) is almost certainly not going to succeed on a second try, so we
# return immediately and let the caller surface a clear message instead
# of silently waiting out multiple retries for nothing.
_RETRYABLE_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


class ToolHTTPError(Exception):
    """Raised only once retries are exhausted or the request cannot be made at all."""


async def request_json(
    method: str,
    url: str,
    *,
    headers: Optional[dict] = None,
    json_body: Any = None,
    params: Optional[dict] = None,
    timeout: float = 10.0,
    retries: int = 2,
    backoff_base: float = 0.5,
) -> tuple[int, Any]:
    """
    Performs an HTTP request with bounded retries + exponential backoff.

    Returns (status_code, parsed_body) where parsed_body is a dict/list
    if the response was JSON, otherwise raw text. Raises ToolHTTPError
    only when every retry attempt has failed outright (network error) —
    a "successful" HTTP call that merely returned a 4xx/5xx status is
    still returned normally so the caller can inspect the error body.
    """
    str_params = {k: str(v) for k, v in params.items()} if params else None
    attempt = 0
    last_exc: Optional[Exception] = None

    while attempt <= retries:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.request(
                    method=method.upper(),
                    url=url,
                    headers=headers,
                    json=json_body,
                    params=str_params,
                    timeout=aiohttp.ClientTimeout(total=timeout),
                ) as resp:
                    content_type = resp.headers.get("Content-Type", "")
                    if "application/json" in content_type:
                        body = await resp.json(content_type=None)
                    else:
                        body = await resp.text()

                    if resp.status in _RETRYABLE_STATUS and attempt < retries:
                        wait = backoff_base * (2 ** attempt)
                        logger.warning(
                            f"[HTTP] {method} {url} -> {resp.status}; "
                            f"retrying in {wait:.1f}s ({attempt + 1}/{retries})"
                        )
                        attempt += 1
                        await asyncio.sleep(wait)
                        continue

                    return resp.status, body
        except (asyncio.TimeoutError, aiohttp.ClientError) as exc:
            last_exc = exc
            if attempt < retries:
                wait = backoff_base * (2 ** attempt)
                logger.warning(
                    f"[HTTP] {method} {url} network error: {exc}; "
                    f"retrying in {wait:.1f}s ({attempt + 1}/{retries})"
                )
                attempt += 1
                await asyncio.sleep(wait)
                continue
            raise ToolHTTPError(f"network error after {retries + 1} attempts: {exc}") from exc

    raise ToolHTTPError(f"request failed: {last_exc}")