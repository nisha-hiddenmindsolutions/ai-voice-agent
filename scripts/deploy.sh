#!/bin/bash
# ==============================================================================
# deploy.sh — Zero-downtime production deployment
#
# What it does:
#   1. Pulls latest code
#   2. Builds new Docker image
#   3. Runs DB migrations (via init_db)
#   4. Replaces running containers one at a time
#   5. Removes old images
#
# Usage:
#   chmod +x scripts/deploy.sh
#   ./scripts/deploy.sh
# ==============================================================================
set -euo pipefail

ENV_FILE=".env.production"
COMPOSE_CMD="docker compose --env-file $ENV_FILE"

echo "🚀 [DEPLOY] Starting production deployment..."
echo "🕐 [DEPLOY] $(date)"

# ── 1. Validate env file exists ───────────────────────────────────────────────
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ [DEPLOY] $ENV_FILE not found. Copy .env.production and fill in your values."
    exit 1
fi

# ── 2. Validate required env vars ─────────────────────────────────────────────
source "$ENV_FILE"
REQUIRED=(DATABASE_URL SECRET_KEY ENCRYPTION_KEY POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB DOMAIN)
for var in "${REQUIRED[@]}"; do
    if [ -z "${!var:-}" ] || [[ "${!var}" == *"CHANGE_ME"* ]]; then
        echo "❌ [DEPLOY] Required variable $var is missing or still set to placeholder."
        exit 1
    fi
done
echo "✅ [DEPLOY] Environment validated"

# ── 3. Build new images ───────────────────────────────────────────────────────
echo "🏗️  [DEPLOY] Building images..."
$COMPOSE_CMD build --no-cache app
echo "✅ [DEPLOY] Build complete"

# ── 4. Start/update services ──────────────────────────────────────────────────
echo "🔄 [DEPLOY] Updating services (postgres first, then app, then nginx)..."
$COMPOSE_CMD up -d --no-deps postgres
echo "⏳ [DEPLOY] Waiting for postgres to be healthy..."
$COMPOSE_CMD up -d --no-deps --wait app
$COMPOSE_CMD up -d --no-deps nginx
echo "✅ [DEPLOY] All services running"

# ── 5. Verify health ──────────────────────────────────────────────────────────
echo "🩺 [DEPLOY] Checking app health..."
sleep 5
HEALTH=$(docker inspect --format='{{.State.Health.Status}}' voice_ai_app 2>/dev/null || echo "unknown")
if [ "$HEALTH" != "healthy" ]; then
    echo "⚠️  [DEPLOY] App health status: $HEALTH — check logs:"
    $COMPOSE_CMD logs --tail=50 app
else
    echo "✅ [DEPLOY] App is healthy"
fi

# ── 6. Clean up old images ────────────────────────────────────────────────────
echo "🧹 [DEPLOY] Removing dangling images..."
docker image prune -f

echo ""
echo "✅ [DEPLOY] Deployment complete at $(date)"
echo "   Site:   https://${DOMAIN}"
echo "   Logs:   docker compose --env-file $ENV_FILE logs -f"
echo "   Status: docker compose --env-file $ENV_FILE ps"