# Deployment Guide: Docker & Docker Compose

This guide outlines the steps to deploy the unified **Voice AI Agent Platform** (React frontend + FastAPI backend + LiveKit Python agent worker + PostgreSQL database) using Docker.

---

## Architecture Overview

In production, the application runs inside a single port-mapped container while connecting to a PostgreSQL database:
* **Port 8000:** Exposes both the React frontend (statically served) and all FastAPI API endpoints (`/api/v1/...`).
* **Background Agent:** Automatically runs the Python LiveKit voice agent inside the same container, connecting out to LiveKit Cloud or your self-hosted LiveKit server.

---

## Method 1: VPS Deployment (Docker Compose) - Recommended

This is the easiest way to deploy the entire stack to a virtual private server (VPS) such as DigitalOcean, AWS EC2, GCP Compute Engine, or Linode.

### Prerequisites
1. A Linux VPS (Ubuntu 20.04/22.04 recommended) with a public IP.
2. Docker and Docker Compose installed:
   ```bash
   sudo apt update
   sudo apt install docker.io docker-compose -y
   sudo systemctl enable --now docker
   ```

### Step-by-Step Setup

1. **Clone the Repository:**
   ```bash
   git clone <your-repo-url> /app/voice-agent
   cd /app/voice-agent
   ```

2. **Configure Environment Variables:**
   Create a `.env` file in the root directory:
   ```bash
   nano .env
   ```
   Add your production variables:
   ```env
   # LiveKit Credentials
   LIVEKIT_URL=wss://your-project.livekit.cloud
   LIVEKIT_API_KEY=your-api-key
   LIVEKIT_API_SECRET=your-api-secret

   # AI Provider Keys
   GROQ_API_KEY=your-groq-key
   OPENAI_API_KEY=your-openai-key
   SARVAM_API_KEY=your-sarvam-key
   GEMINI_EMBEDDING_KEY=your-gemini-key

   # Database (docker-compose will override this to use the internal db service)
   DATABASE_URL=postgresql+asyncpg://postgres:postgres@db:5432/Voice-Agent

   # Security & Session Configuration
   SECRET_KEY=generate-a-secure-random-string-for-jwt-tokens
   ENCRYPTION_KEY=generate-a-32-byte-fernet-key-in-base64
   
   # Enable voice worker in background
   ENABLE_BACKGROUND_AGENT=true
   ```

3. **Deploy the Container Stack:**
   Run Docker Compose in detached mode (background) to build and start the containers:
   ```bash
   docker-compose up -d --build
   ```

4. **Verify Deployment:**
   Check container statuses and view live logs:
   ```bash
   docker-compose ps
   docker-compose logs -f app
   ```
   *Your app is now running at `http://your-server-ip:8000`.*

---

## Method 2: Cloud Container Hosting (Railway, Render, AWS ECS)

If you prefer managed container platforms, you can deploy the single `Dockerfile` directly.

### Railway Deployment (Quickest)
1. Link your GitHub repository to [Railway](https://railway.app).
2. Railway will automatically detect the root `Dockerfile` and build it.
3. Provision a **PostgreSQL Database** plugin in your Railway project.
4. Set the following environment variables in your App service settings:
   * `DATABASE_URL` = `${{Postgres.DATABASE_URL_ASYNC}}` (or replace `postgresql://` with `postgresql+asyncpg://` in the database connection string).
   * `ENABLE_BACKGROUND_AGENT` = `true`
   * `PORT` = `8000`
   * `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`
5. Expose port `8000`.

### Render Deployment
1. Create a **Web Service** on [Render](https://render.com) pointing to your repo.
2. Select **Docker** as the Runtime environment.
3. Create a **PostgreSQL Database** on Render.
4. In the Web Service Environment settings, add:
   * `DATABASE_URL` = `postgresql+asyncpg://<render-db-details>`
   * `ENABLE_BACKGROUND_AGENT` = `true`
   * `PORT` = `8000`
   * LiveKit and AI API credentials.
5. Deploy. Render will build the image and serve the UI/API.

---

## Crucial Production Configurations

### 1. SSL/HTTPS & Reverse Proxy (Nginx / Caddy)
LiveKit WebRTC audio streams require a secure context (`https://`) to request microphone permissions in the browser. 

Here is a simple **Caddy** configuration (`/etc/caddy/Caddyfile`) to auto-provision SSL certificates and reverse proxy to your Docker app:

```caddy
yourdomain.com {
    reverse_proxy localhost:8000
}
```

### 2. Database Volume Backups
Your SQLite/Postgres data is mounted to the host using a named volume. To back up your PostgreSQL database:
```bash
docker exec -t voice-forge-db pg_dumpall -U postgres > backup.sql
```

### 3. JWT and Encryption Key Generation
Generate secure keys for production rather than using defaults. Run this python command on your host:
```bash
# JWT Secret Key
python -c "import secrets; print(secrets.token_hex(32))"

# Fernet Encryption Key (must be 32 URL-safe base64-encoded bytes)
python -c "import cryptography.fernet; print(cryptography.fernet.Fernet.generate_key().decode())"
```
Place these generated keys into `SECRET_KEY` and `ENCRYPTION_KEY` inside `.env` respectively.
