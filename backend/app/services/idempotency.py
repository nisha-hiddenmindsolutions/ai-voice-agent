"""
Webhook Idempotency Store.

Prevents double-processing of LiveKit / Twilio webhook events that are
retried on delivery failure.

Strategy:
  - Primary: Redis (SETEX with TTL)
  - Fallback: In-process TTL dict (single-instance only — sufficient for
    most deployments; replace with Redis for multi-replica)

Usage:
    store = IdempotencyStore()
    if await store.is_seen("lk_webhook", event_id):
        return  # already processed
    await store.mark_seen("lk_webhook", event_id)
"""

import asyncio
import logging
import time
from typing import Optional

logger = logging.getLogger("idempotency")

# TTL for deduplication keys (seconds) — webhooks are retried within 5 min
_TTL = 600


class _LocalStore:
    """Simple in-process dict store with TTL expiry. Thread-safe via asyncio."""

    def __init__(self) -> None:
        self._store: dict[str, float] = {}
        self._lock = asyncio.Lock()

    async def is_seen(self, key: str) -> bool:
        async with self._lock:
            exp = self._store.get(key)
            if exp is None:
                return False
            if time.monotonic() > exp:
                del self._store[key]
                return False
            return True

    async def mark_seen(self, key: str) -> None:
        async with self._lock:
            self._store[key] = time.monotonic() + _TTL
            # Prune expired entries occasionally
            if len(self._store) > 10_000:
                now = time.monotonic()
                self._store = {k: v for k, v in self._store.items() if v > now}


class IdempotencyStore:
    """Idempotency store — Redis-preferred, local fallback."""

    def __init__(self) -> None:
        self._redis: Optional[object] = None  # redis.asyncio.Redis
        self._local = _LocalStore()
        self._redis_ready = False

    async def _get_redis(self):
        if self._redis_ready:
            return self._redis
        try:
            import redis.asyncio as aioredis
            from app.core.config import settings

            redis_url = getattr(settings, "REDIS_URL", None)
            if redis_url:
                self._redis = aioredis.from_url(redis_url, decode_responses=True)
                await self._redis.ping()
                self._redis_ready = True
                logger.info("[Idempotency] Redis backend connected")
                return self._redis
        except Exception as exc:
            logger.warning(f"[Idempotency] Redis unavailable, using local store: {exc}")
        self._redis_ready = True  # mark as attempted so we don't retry every call
        return None

    async def is_seen(self, namespace: str, event_id: str) -> bool:
        key = f"idem:{namespace}:{event_id}"
        r = await self._get_redis()
        if r:
            try:
                return bool(await r.exists(key))
            except Exception:
                pass
        return await self._local.is_seen(key)

    async def mark_seen(self, namespace: str, event_id: str) -> None:
        key = f"idem:{namespace}:{event_id}"
        r = await self._get_redis()
        if r:
            try:
                await r.setex(key, _TTL, "1")
                return
            except Exception:
                pass
        await self._local.mark_seen(key)


# Singleton
idempotency_store = IdempotencyStore()
