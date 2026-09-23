# syntax=docker/dockerfile:1
ARG PYTHON_VERSION=3.11

# ==============================================================================
# STAGE 1: Build the React Frontend
# ==============================================================================
FROM node:20-bookworm-slim AS frontend-builder
WORKDIR /app/frontend

# Install dependencies first (layer cached unless package files change)
COPY frontend/package*.json ./
RUN npm ci

# Copy frontend source and build
# VITE_API_URL is intentionally empty — falls back to window.location.origin at runtime
COPY frontend/ ./
ENV VITE_API_URL=""
RUN npm run build

# ==============================================================================
# STAGE 2: Build Python Dependencies & Pre-download VAD Models
# ==============================================================================
FROM ghcr.io/astral-sh/uv:python${PYTHON_VERSION}-bookworm-slim AS backend-builder

# Install build-time system deps (gcc for C extensions, git-lfs for large model files)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    python3-dev \
    git \
    git-lfs \
  && git lfs install \
  && rm -rf /var/lib/apt/lists/*

ENV UV_GIT_LFS=1

WORKDIR /app

# Copy lockfiles first for layer caching — only reinstalls if deps change
COPY pyproject.toml uv.lock ./
RUN mkdir -p agent backend

# Install production dependencies only (no dev/test tools)
RUN uv sync --frozen --no-dev

# Copy application source
COPY agent/  ./agent/
COPY backend/ ./backend/

# Pre-download Silero VAD models into the image (avoids runtime network calls)
RUN uv run python agent/main.py download-files

# ==============================================================================
# STAGE 3: Final Production Image (Slim Runtime Only)
# ==============================================================================
FROM ghcr.io/astral-sh/uv:python${PYTHON_VERSION}-bookworm-slim AS runner

WORKDIR /app

# ── Security: non-root user ───────────────────────────────────────────────────
ARG UID=10001
RUN adduser \
    --disabled-password \
    --gecos "" \
    --home "/app" \
    --shell "/sbin/nologin" \
    --uid "${UID}" \
    appuser

# ── Copy artifacts from build stages ─────────────────────────────────────────
# Python venv + application source from backend builder
COPY --from=backend-builder --chown=appuser:appuser /app /app

# Pre-built React static files served by FastAPI
COPY --from=frontend-builder --chown=appuser:appuser /app/frontend/dist /app/frontend/dist

# Pre-downloaded VAD model cache (Silero etc.) — root cache → appuser home
COPY --from=backend-builder --chown=appuser:appuser /root/.cache /app/.cache

# ── Runtime directories ───────────────────────────────────────────────────────
RUN mkdir -p /app/data && chown -R appuser:appuser /app/data

# ── Copy startup script ───────────────────────────────────────────────────────
COPY --chown=appuser:appuser scripts/start.sh /app/scripts/start.sh
RUN chmod +x /app/scripts/start.sh

# ── Environment ───────────────────────────────────────────────────────────────
# Point appuser home so ~/.cache resolves correctly
ENV HOME=/app
# Python module resolution for absolute and relative imports
ENV PYTHONPATH=/app/backend:/app
# Force stdout/stderr to be unbuffered (logs appear immediately in Docker)
ENV PYTHONUNBUFFERED=1
# Activate background voice agent alongside FastAPI
ENV ENABLE_BACKGROUND_AGENT=true

# ── Health check ──────────────────────────────────────────────────────────────
# Docker/compose will mark container unhealthy if /health stops responding.
# start_period gives the app time to initialize before checks begin.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

EXPOSE 8000

USER appuser

# Use the startup script (handles DB init before uvicorn starts)
CMD ["/app/scripts/start.sh"]