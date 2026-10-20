#!/bin/sh
# =============================================================================
# start.sh — Production startup script
# Runs DB initialization first, then starts the uvicorn server.
# Executed as appuser inside the container.
# =============================================================================
set -e

echo "🚀 [START] Starting Voice AI SaaS..."

CLEAN_PORT=$(echo "${PORT:-8000}" | tr -d '"' | tr -d "'")

# ── 1. Wait for PostgreSQL to be ready ───────────────────────────────────────
echo "⏳ [START] Waiting for PostgreSQL..."
until /app/.venv/bin/python -c "
import asyncio, asyncpg, os, sys
async def check():
    try:
        raw = os.environ.get('DATABASE_URL', '').strip().strip('\"').strip(\"'\")
        if not raw:
            print('⏳ [DB] DATABASE_URL is empty')
            sys.exit(1)
        clean = raw.replace('+asyncpg', '')
        conn = await asyncpg.connect(clean)
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
echo "🌐 [START] Starting uvicorn on 0.0.0.0:${CLEAN_PORT:-8000}..."
exec /app/.venv/bin/uvicorn backend.app.main:app \
    --host 0.0.0.0 \
    --port "${CLEAN_PORT:-8000}" \
    --workers 1 \
    --loop uvloop \
    --http httptools \
    --proxy-headers \
    --forwarded-allow-ips="*" \
    --log-level info \
    --access-log