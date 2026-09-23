"""
Per-User Concurrent Call Rate Limiter.

Prevents a single user from flooding the SIP gateway with simultaneous
outbound calls. Uses Redis counters when available; falls back to an
in-process dict.

Usage:
    limiter = CallRateLimiter(max_concurrent=5)
    async with limiter.acquire(user_id):
        ...  # make the call
    # counter auto-decremented on exit (even on exception)
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional

logger = logging.getLogger("rate_limiter")

_COUNTER_TTL = 3600  # 1 hour safety expiry on Redis counters


class _LocalCounter:
    def __init__(self) -> None:
        self._counts: dict[str, int] = {}
        self._lock = asyncio.Lock()

    async def increment(self, key: str) -> int:
        async with self._lock:
            self._counts[key] = self._counts.get(key, 0) + 1
            return self._counts[key]

    async def decrement(self, key: str) -> None:
        async with self._lock:
            v = self._counts.get(key, 1) - 1
            self._counts[key] = max(v, 0)

    async def get(self, key: str) -> int:
        async with self._lock:
            return self._counts.get(key, 0)


class CallRateLimiter:
    def __init__(self, max_concurrent: int = 10) -> None:
        self.max_concurrent = max_concurrent
        self._local = _LocalCounter()
        self._redis: Optional[object] = None
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
                return self._redis
        except Exception:
            pass
        self._redis_ready = True
        return None

    async def _increment(self, key: str) -> int:
        r = await self._get_redis()
        if r:
            try:
                count = await r.incr(key)
                await r.expire(key, _COUNTER_TTL)
                return count
            except Exception:
                pass
        return await self._local.increment(key)

    async def _decrement(self, key: str) -> None:
        r = await self._get_redis()
        if r:
            try:
                await r.decr(key)
                return
            except Exception:
                pass
        await self._local.decrement(key)

    @asynccontextmanager
    async def acquire(self, user_id: str):
        """Context manager that acquires a concurrent call slot for a user."""
        from fastapi import HTTPException

        key = f"calls:active:{user_id}"
        count = await self._increment(key)
        if count > self.max_concurrent:
            await self._decrement(key)
            raise HTTPException(
                status_code=429,
                detail=(
                    f"Too many concurrent calls. "
                    f"Limit is {self.max_concurrent} simultaneous calls per account."
                ),
            )
        try:
            yield
        finally:
            await self._decrement(key)


# Singleton — tune max_concurrent via env/config if needed
call_rate_limiter = CallRateLimiter(max_concurrent=10)
