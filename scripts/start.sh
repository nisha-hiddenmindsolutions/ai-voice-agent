#!/bin/sh
# =============================================================================
# start.sh — Production startup script
# Runs DB initialization first, then starts the uvicorn server.
# Executed as appuser inside the container.
# =============================================================================
set -e

echo "🚀 [START] Starting Voice AI SaaS..."

# ── 1. Wait for PostgreSQL to be ready ───────────────────────────────────────
echo "⏳ [START] Waiting for PostgreSQL..."
until /app/.venv/bin/python -c "
import asyncio, asyncpg, os, sys
async def check():
    try:
        conn = await asyncpg.connect(os.environ['DATABASE_URL'].replace('+asyncpg',''))
        await conn.close()
        print('✅ [DB] PostgreSQL is ready')
    except Exception as e:
        print(f'⏳ [DB] Not ready yet: {e}')
        sys.exit(1)
asyncio.run(check())
"; do
  echo "⏳ [DB] Retrying in 2 seconds..."
  sleep 2
done

# ── 2. Run database initialization / migrations ───────────────────────────────
echo "🗄️  [START] Initializing database schema..."
/app/.venv/bin/python -c "
import asyncio
from app.db.session import init_db
asyncio.run(init_db())
print('✅ [DB] Schema ready')
"

# ── 3. Start uvicorn ──────────────────────────────────────────────────────────
echo "🌐 [START] Starting uvicorn on 0.0.0.0:8000..."
exec /app/.venv/bin/uvicorn backend.app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 1 \
    --loop uvloop \
    --http httptools \
    --proxy-headers \
    --forwarded-allow-ips="*" \
    --log-level info \
    --access-log