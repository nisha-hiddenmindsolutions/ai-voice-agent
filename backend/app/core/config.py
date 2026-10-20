import os
from pydantic_settings import BaseSettings
from pathlib import Path
from dotenv import load_dotenv

# Pathing
_BACKEND_APP_DIR = Path(__file__).parent.parent
_ROOT = _BACKEND_APP_DIR.parent.parent
load_dotenv(_ROOT / ".env")

def _clean_env(name: str, default: str = "") -> str:
    val = os.getenv(name)
    if val is None:
        return default
    s = val.strip()
    if (s.startswith('"') and s.endswith('"')) or (s.startswith("'") and s.endswith("'")):
        s = s[1:-1].strip()
    return s

class Settings(BaseSettings):
    PROJECT_NAME: str = "Voice AI SaaS"
    API_V1_STR: str = "/api/v1"
    
    # LiveKit
    LIVEKIT_API_KEY: str = _clean_env("LIVEKIT_API_KEY") or _clean_env("LIVEKIT_APT_KEY")
    LIVEKIT_API_SECRET: str = _clean_env("LIVEKIT_API_SECRET")
    LIVEKIT_URL: str = _clean_env("LIVEKIT_URL")
    LIVEKIT_SIP_DOMAIN: str = _clean_env("LIVEKIT_SIP_DOMAIN", "sip.livekit.cloud")
    
    # Storage
    DATA_DIR: Path = _ROOT / "data"
    AGENTS_FILE: Path = DATA_DIR / "agents.json"
    USERS_FILE: Path = DATA_DIR / "users.json"
    USAGE_FILE: Path = DATA_DIR / "usage.json"
    
    # Database
    DATABASE_URL: str = _clean_env("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/Voice-Agent")
    
    # Security
    SECRET_KEY: str = _clean_env("SECRET_KEY") # HS256
    ENCRYPTION_KEY: str = _clean_env("ENCRYPTION_KEY") or _clean_env("ENCRYPTTON_KEY") # Fernet (Base64)
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 # 1 week
    
    # Dynamic Domain Discovery (Local, Railway, or custom cloud)
    _railway_domain = _clean_env("RAILWAY_PUBLIC_DOMAIN")
    _custom_backend = _clean_env("BACKEND_URL") or _clean_env("BACKEND_BASE_URL")

    if _custom_backend:
        _default_base = _custom_backend.rstrip("/")
    elif _railway_domain:
        _default_base = f"https://{_railway_domain}".rstrip("/")
    else:
        _default_base = "http://localhost:8000"

    _default_frontend = _default_base if (_railway_domain or _custom_backend) else "http://localhost:5173"
    _default_google_redirect = f"{_default_base}/api/v1/integrations/google/callback"

    # Backend base URL
    BACKEND_BASE_URL: str = _clean_env("BACKEND_BASE_URL", _default_base)

    # Frontend URL (used for OAuth redirects)
    FRONTEND_URL: str = _clean_env("FRONTEND_URL", _default_frontend)

    # Google OAuth
    GOOGLE_CLIENT_ID: str = _clean_env("GOOGLE_CLIENT_ID")
    GOOGLE_CLIENT_SECRET: str = _clean_env("GOOGLE_CLIENT_SECRET")
    GOOGLE_OAUTH_REDIRECT_URI: str = _clean_env("GOOGLE_OAUTH_REDIRECT_URI", _default_google_redirect)

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
