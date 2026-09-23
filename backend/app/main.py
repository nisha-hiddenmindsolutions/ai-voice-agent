import contextlib
import os
import pathlib
import subprocess
import sys

# Ensure stdout and stderr use UTF-8 encoding on Windows to prevent UnicodeEncodeError with emojis
if sys.stdout and sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
if sys.stderr and sys.stderr.encoding != 'utf-8':
    try:
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
# pyrefly: ignore [missing-import]
from app.api.v1.endpoints import (
    agents,
    sessions,
    tools,
    numbers,
    calls, 
    auth, 
    integrations,
    keys,
    providers,
    dashboard,
    twilio,
    telephony, 
    knowledge,
    livekit_webhook,
)
# pyrefly: ignore [missing-import]
from app.api.v1.endpoints import settings as settings_ep
# pyrefly: ignore [missing-import]
from app.core.config import settings, validate_required_settings
# pyrefly: ignore [missing-import]
from app.db.session import init_db

@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Unified Startup: Automatically runs the VoiceForge Agent Worker and initializes the database.
    """
    validate_required_settings()
    await init_db()
    
    if os.getenv("ENABLE_BACKGROUND_AGENT") == "true":
        agent_path = settings.DATA_DIR.parent / "agent" / "main.py"
        print(f"\n🚀 [SYSTEM] Starting VoiceForge Agent (v5) in Background: {agent_path}")
        
        # Run the agent in the background using the same Python interpreter
        cmd = [sys.executable, str(agent_path), "start"]
        try:
            agent_process = subprocess.Popen(
                cmd,
                cwd=str(settings.DATA_DIR.parent),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
        except Exception as e:
            print(f"⚠️ [SYSTEM] Could not start background agent: {e}")
            agent_process = None

        if agent_process:
            import threading
            def pipe_logs(process):
                try:
                    for line in iter(process.stdout.readline, ""):
                        if line:
                            print(f"🤖 [AGENT] {line.strip()}")
                except:
                    pass

            threading.Thread(target=pipe_logs, args=(agent_process,), daemon=True).start()
    else:
        print("\n💡 [SYSTEM] Manual Agent Mode: Please run 'uv run python agent/main.py dev' in a separate terminal.")
        agent_process = None

    yield
    
    if agent_process:
        print("🛑 [SYSTEM] Shutting down Agent Worker...")
        agent_process.terminate()
        try:
            agent_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            agent_process.kill()

app = FastAPI(title=settings.PROJECT_NAME, lifespan=lifespan)

# Middleware
_ALLOWED_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ALLOWED_ORIGINS",
        "http://localhost:5173,http://localhost:3000,http://localhost:8000",
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(agents.router, prefix=f"{settings.API_V1_STR}/agents", tags=["Agents"])
app.include_router(sessions.router, prefix=f"{settings.API_V1_STR}/sessions", tags=["Sessions"])
app.include_router(tools.router, prefix=f"{settings.API_V1_STR}/tools", tags=["Tools"])
app.include_router(numbers.router, prefix=f"{settings.API_V1_STR}/numbers", tags=["Numbers"])
app.include_router(calls.router, prefix=f"{settings.API_V1_STR}/calls", tags=["Calls"])
app.include_router(twilio.router, prefix=f"{settings.API_V1_STR}/telephony/twilio", tags=["Twilio Telephony"])
app.include_router(auth.router, prefix=f"{settings.API_V1_STR}/auth", tags=["Auth"])
app.include_router(integrations.router, prefix=f"{settings.API_V1_STR}/integrations", tags=["Integrations"])
app.include_router(keys.router, prefix=f"{settings.API_V1_STR}/keys", tags=["Keys"])
app.include_router(providers.router, prefix=f"{settings.API_V1_STR}/providers", tags=["Providers"])
app.include_router(dashboard.router, prefix=f"{settings.API_V1_STR}/dashboard", tags=["Dashboard"])
app.include_router(telephony.router, prefix=f"{settings.API_V1_STR}/telephony", tags=["Telephony"])
app.include_router(settings_ep.router, prefix=f"{settings.API_V1_STR}/settings", tags=["Settings"])
app.include_router(knowledge.router, prefix=f"{settings.API_V1_STR}/knowledge", tags=["Knowledge"])
app.include_router(livekit_webhook.router, prefix=f"{settings.API_V1_STR}/telephony/livekit", tags=["LiveKit Webhooks"])

@app.get("/hello")
def read_root():
    return {"message": f"Welcome to {settings.PROJECT_NAME} API"}

@app.get("/health")
async def root_health_check():
    return {"status": "ok", "service": settings.PROJECT_NAME}

# Serve static frontend files if the build directory exists
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

frontend_dist = pathlib.Path(__file__).parent.parent.parent / "frontend" / "dist"
if frontend_dist.exists():
    print(f"📦 [SYSTEM] Mounting static frontend assets from {frontend_dist}")
    if (frontend_dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=str(frontend_dist / "assets")), name="assets")
    
    @app.get("/{catchall:path}")
    async def serve_frontend(catchall: str):
        # Prevent intercepting API routes
        if catchall.startswith("api/") or catchall.startswith("docs") or catchall.startswith("openapi.json") or catchall.startswith("hello"):
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="Not Found")
            
        file_path = frontend_dist / catchall
        if file_path.is_file():
            return FileResponse(str(file_path))
        return FileResponse(str(frontend_dist / "index.html"))
