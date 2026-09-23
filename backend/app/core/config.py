import os
from pydantic_settings import BaseSettings
from pathlib import Path
from dotenv import load_dotenv

# Pathing
_BACKEND_APP_DIR = Path(__file__).parent.parent
_ROOT = _BACKEND_APP_DIR.parent.parent
load_dotenv(_ROOT / ".env")

class Settings(BaseSettings):
    PROJECT_NAME: str = "Voice AI SaaS"
    API_V1_STR: str = "/api/v1"
    
    # LiveKit
    LIVEKIT_API_KEY: str = os.getenv("LIVEKIT_API_KEY", "")
    LIVEKIT_API_SECRET: str = os.getenv("LIVEKIT_API_SECRET", "")
    LIVEKIT_URL: str = os.getenv("LIVEKIT_URL", "")
    LIVEKIT_SIP_DOMAIN: str = os.getenv("LIVEKIT_SIP_DOMAIN", "sip.livekit.cloud")
    
    # Storage
    DATA_DIR: Path = _ROOT / "data"
    AGENTS_FILE: Path = DATA_DIR / "agents.json"
    USERS_FILE: Path = DATA_DIR / "users.json"
    USAGE_FILE: Path = DATA_DIR / "usage.json"
    
    # Database
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/Voice-Agent")
    
    # Security
    SECRET_KEY: str = os.getenv("SECRET_KEY", "") # HS256
    ENCRYPTION_KEY: str = os.getenv("ENCRYPTION_KEY", "") # Fernet (Base64)
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 # 1 week
    
    # Google OAuth
    GOOGLE_CLIENT_ID: str = os.getenv("GOOGLE_CLIENT_ID", "")
    GOOGLE_CLIENT_SECRET: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    GOOGLE_OAUTH_REDIRECT_URI: str = os.getenv("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:8000/api/v1/integrations/google/callback")

    # Backend base URL
    BACKEND_BASE_URL: str = os.getenv("BACKEND_BASE_URL", "http://localhost:8000")

    # Frontend URL (used for OAuth redirects)
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:5173")

    class Config:
        case_sensitive = True

settings = Settings()

def validate_required_settings() -> None:
    required_names = (
        "SECRET_KEY",
        "ENCRYPTION_KEY",
        "LIVEKIT_URL",
        "LIVEKIT_API_KEY",
        "LIVEKIT_API_SECRET",
    )
    missing = [name for name in required_names if not getattr(settings, name)]
    if missing:
        raise RuntimeError(f"Missing required configuration: {', '.join(missing)}")
