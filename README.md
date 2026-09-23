# VoiceForge: Voice AI Agent Platform

VoiceForge is a fully-featured, production-ready Voice AI SaaS platform designed to build, customize, test, and deploy highly interactive, multilingual voice agents. Powered by LiveKit, FastAPI, React, and PostgreSQL, the platform allows you to configure conversational voice assistants with custom LLMs, STT, and TTS engines, integrate RAG document search, orchestrate webhook tools, and manage telephony routing (SIP & Twilio) through a sleek Web UI.

---

## 🚀 Key Features

*   **Custom Voice Agent Builder:** Create agents with tailored instructions, system prompts, and custom VAD (Voice Activity Detection) sensitivities using Silero.
*   **Multilingual Support & Localized TTS:** Deploy agents optimized for English, Hindi (`hi-IN`), and other languages with advanced voice quality support (including Sarvam Bulbul and ElevenLabs).
*   **Comprehensive AI Provider Ecosystem:**
    *   **LLMs:** OpenAI, Anthropic, Gemini, Groq, Cerebras, Together AI, Deepseek, OpenRouter.
    *   **STT (Speech-to-Text):** Deepgram, Groq (Whisper), Sarvam.
    *   **TTS (Text-to-Speech):** OpenAI TTS, ElevenLabs, Cartesia, Sarvam Bulbul (`bulbul:v3`).
*   **Neural Tools Integration (Super-Tools):**
    *   📅 **Google Calendar:** Automate booking and scheduling with dynamic ISO 8601 timezone math.
    *   📊 **Google Sheets:** Log leads, user input, and transcripts directly to remote spreadsheets.
    *   🔌 **n8n / Webhooks:** Trigger external workflow pipelines (POST/GET) with secure auth header injection.
*   **Knowledge Base (RAG System):** Upload text and PDF files to index them in a semantic search database (Qdrant). The agent automatically queries the `rag_system` tool when asked about reference policies, documentation, or FAQs.
*   **Telephony & Outbound Dialing:** Integrated Twilio management. Purchase/bind phone numbers, configure SIP endpoints, make outbound calls, and track campaigns.
*   **Analytics & Session Control:**
    *   📊 **Metrics:** Charts for call durations, provider token costs, latencies, and system health.
    *   📜 **Call Logs & Transcripts:** Review complete conversation logs and session transcripts.
    *   🛑 **Smart Session Auto-Termination:** Automatic farewell detection hooks (e.g., "bye", "goodbye", "dhanyawad") disconnect call sessions gracefully.

---

## 📐 Architecture Overview

```mermaid
graph TD
    Client[React Web Client] <-->|WebRTC / SIP / WebSockets| LiveKit[LiveKit Cloud / Self-Hosted Server]
    Client <-->|REST API / JWT Auth| FastAPI[FastAPI Backend]
    FastAPI <-->|SQLAlchemy / asyncpg| Postgres[(PostgreSQL Database)]
    FastAPI <-->|Embeddings / Vectors| Qdrant[(Qdrant Vector DB / RAG)]
    FastAPI <-->|Subprocess Spawn| AgentWorker[LiveKit Python Agent Worker]
    AgentWorker <-->|WebRTC Voice Sessions| LiveKit
    AgentWorker <-->|STT / TTS / LLM| AIProviders[AI APIs: OpenAI, Groq, Sarvam, ElevenLabs, etc.]
    AgentWorker <-->|Super-Tools| Integrations[Google Calendar, Sheets, n8n, Webhooks]
    Twilio[Twilio SIP / PSTN] <-->|SIP Trunking| LiveKit
    FastAPI <-->|Outbound Triggers| Twilio
```

In development and production, the platform is designed to run in a unified container format:
1.  **FastAPI Backend (Port 8000):** Exposes all REST API endpoints (`/api/v1/...`) and mounts the built static React assets from the frontend to serve the UI.
2.  **LiveKit Agent Worker Daemon:** Automatically runs as a background process managed by the FastAPI lifecycle (via `ENABLE_BACKGROUND_AGENT=true`), removing the need to run multiple command-line workers in production.

---

## 📂 Project Structure

```text
├── agent/                  # LiveKit Python Agent Worker logic
│   ├── factory.py          # Dynamic LLM, STT, TTS, VAD, and Tool components constructor
│   └── main.py             # Agent entry point, event listeners, and dynamic SIP dispatcher
├── backend/                # FastAPI Application
│   ├── app/
│   │   ├── api/            # API endpoints (Auth, Agents, Telephony, Tools, RAG, etc.)
│   │   ├── core/           # Configuration settings, security, and JWT utilities
│   │   ├── db/             # SQLAlchemy engine & database sessions
│   │   ├── models/         # SQLAlchemy schemas (Users, Agents, Calls, Tools, Keys)
│   │   └── services/       # Core service abstractions (RAG, Telephony orchestration)
│   ├── main.py             # Backend server entry point
│   └── reset_db.py         # DB migration & table initialization script
├── frontend/               # React + TypeScript + Vite + Tailwind CSS Application
│   ├── src/
│   │   ├── components/     # Shared layout, charts, and interactive call UI blocks
│   │   ├── pages/          # Console views (Dashboard, Agents, Tools, RAG, Telephony, etc.)
│   │   ├── services/       # Axios API client services
│   │   └── App.tsx         # Routing configuration
│   └── package.json
├── DEPLOYMENT_GUIDE.md     # Production VPS & Cloud hosting guides
├── docker-compose.yml      # Orchestrates Postgres and unified VoiceForge containers
├── Dockerfile              # Builds React app & packs with Python server env
├── pyproject.toml          # uv/Python dependencies and formatting config
└── taskfile.yaml           # Local helper scripts
```

---

## 🛠️ Prerequisites

*   Python `3.10` to `3.14` (with `uv` package manager recommended).
*   Node.js `18+` and npm/pnpm.
*   A **LiveKit Cloud** account (sign up at [livekit.io](https://livekit.io)) or a self-hosted LiveKit instance.
*   **Docker** & **Docker Compose** (if using containerized setup).

---

## ⚙️ Configuration

Create a `.env` file in the root directory. Copy settings from `.env.example`:

```env
# LiveKit Cloud Credentials
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret

# AI Providers API Keys
GROQ_API_KEY=your_groq_api_key
OPENAI_API_KEY=your_openai_api_key
GOOGLE_API_KEY=your_google_api_key
SARVAM_API_KEY=your_sarvam_api_key

# PostgreSQL Database (Docker Compose overrides this automatically)
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/Voice-Agent

# Security Configuration (JWT Token signing & data encryption)
# Generate random 32-byte keys for tokens and credential encryption:
SECRET_KEY=generate_a_secure_jwt_secret
ENCRYPTION_KEY=generate_a_32_byte_fernet_key

# Background Voice Worker Activation
ENABLE_BACKGROUND_AGENT=true
```

---

## 💻 Local Development Setup

Follow these steps to run the application components locally in your development environment.

### 1. Initialize Python Environment

We recommend using `uv` to manage the virtual environment and dependencies:

```bash
# Sync dependencies and build virtual env
uv sync
```

*If you do not have `uv` installed, you can use standard pip:*
```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -e .
```

### 2. Set Up the Database

Make sure you have a running PostgreSQL server matching your `DATABASE_URL`. Run the database reset script to generate the database schema and initialize empty tables:

```bash
uv run python backend/reset_db.py
```

### 3. Build & Run Frontend

The React application must be built before starting the backend if you want FastAPI to serve the web UI statically. 

```bash
cd frontend
npm install

# Option A: Build production bundle (Served directly by FastAPI on port 8000)
npm run build

# Option B: Run Hot Module Reload (HMR) Development server on port 5173
npm run dev
```

### 4. Run the Unified Backend

Start the FastAPI application. If `ENABLE_BACKGROUND_AGENT=true` is set, this command will launch both the web server and the LiveKit agent worker in the background:

```bash
uv run python main.py
```

*   **Backend API & Served Web Interface:** `http://localhost:8000`
*   **Interactive API Docs:** `http://localhost:8000/docs`
*   **React Dev server (if Option B was selected):** `http://localhost:5173`

---

## 🐳 Containerized Deployment

For a robust, single-command setup, you can deploy the complete platform using Docker Compose.

```bash
# Start Postgres and the Unified App in the background
docker-compose up -d --build

# View real-time aggregated logs
docker-compose logs -f app
```

Once healthy, the database schema will auto-initialize, and you can visit `http://localhost:8000` to register your administrator account, configure credentials, and start building voice agents.

For full cloud/VPS deployment configurations, reverse-proxy setup (Caddy/Nginx), and database backups, please refer to the detailed [Deployment Guide](DEPLOYMENT_GUIDE.md).

---

## 🔒 Security & Encryption

To protect credentials for third-party tools (like OAuth tokens for Google Calendar/Sheets and external provider keys) in the database, VoiceForge encrypts sensitive data symmetrically at rest.
*   Make sure `ENCRYPTION_KEY` is a 32-byte, URL-safe base64 string.
*   Keep your `SECRET_KEY` secret. If compromised, active JWT tokens can be spoofed.
