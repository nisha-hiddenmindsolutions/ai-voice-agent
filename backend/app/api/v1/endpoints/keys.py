from typing import Any, Annotated, Optional, Dict
from pydantic import BaseModel
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

# pyrefly: ignore [missing-import]
from app.api.deps import get_db, get_current_user
# pyrefly: ignore [missing-import]
from app.core.security import vault
# pyrefly: ignore [missing-import]
from app.models.orm import UserORM

router = APIRouter()

class KeysUpdate(BaseModel):
    llm_provider: Optional[str] = None
    llm_key: Optional[str] = None
    stt_provider: Optional[str] = None
    stt_key: Optional[str] = None
    tts_provider: Optional[str] = None
    tts_key: Optional[str] = None

    # Provider-specific keys
    groq_key: Optional[str] = None
    cerebras_key: Optional[str] = None
    openai_key: Optional[str] = None
    deepgram_key: Optional[str] = None
    sarvam_key: Optional[str] = None
    openrouter_key: Optional[str] = None

    # Twilio credentials
    twilio_account_sid: Optional[str] = None
    twilio_auth_token: Optional[str] = None
    twilio_phone_number: Optional[str] = None

    # Store settings defaults (e.g., default models)
    default_settings: Optional[Dict[str, Any]] = None


@router.get("/")
async def get_user_keys(
    current_user: Annotated[UserORM, Depends(get_current_user)]
) -> Any:
    """
    Retrieve all configured keys in a masked format and default settings.
    """
    secrets = current_user.secrets or {}

    masked_keys = {}
    key_names = [
        "groq_key", "cerebras_key", "openai_key", "deepgram_key",
        "sarvam_key", "openrouter_key", "llm_key", "stt_key", "tts_key",
        "twilio_account_sid", "twilio_auth_token", "twilio_phone_number",
    ]
    for key_name in key_names:
        if key_name in secrets:
            decrypted = vault.decrypt(secrets[key_name])
            masked_keys[key_name] = (
                f"{decrypted[:4]}...{decrypted[-4:]}" if len(decrypted) > 8 else "****"
            )

    return {
        "keys": masked_keys,
        "providers": {
            "llm": secrets.get("llm_provider", "groq"),
            "stt": secrets.get("stt_provider", "groq"),
            "tts": secrets.get("tts_provider", "sarvam"),
        },
        "default_settings": secrets.get("default_settings", {}),
    }


@router.post("/", response_model=dict)
async def update_user_keys(
    db: Annotated[AsyncSession, Depends(get_db)],
    current_user: Annotated[UserORM, Depends(get_current_user)],
    payload: KeysUpdate,
) -> Any:
    """
    Update global model API keys (encrypted) and provider settings.
    """
    # Explicit copy so SQLAlchemy always sees a new object reference
    secrets = dict(current_user.secrets or {})

    # Update providers
    if payload.llm_provider is not None:
        secrets["llm_provider"] = payload.llm_provider
    if payload.stt_provider is not None:
        secrets["stt_provider"] = payload.stt_provider
    if payload.tts_provider is not None:
        secrets["tts_provider"] = payload.tts_provider

    # Update keys securely: empty string = delete, any value = encrypt and store
    key_names = [
        "groq_key", "cerebras_key", "openai_key", "deepgram_key",
        "sarvam_key", "openrouter_key", "llm_key", "stt_key", "tts_key",
        "twilio_account_sid", "twilio_auth_token", "twilio_phone_number",
    ]
    for key_name in key_names:
        val = getattr(payload, key_name, None)
        if val is not None:
            if val.strip() == "":
                secrets.pop(key_name, None)
            else:
                secrets[key_name] = vault.encrypt(val)

    if payload.default_settings is not None:
        secrets["default_settings"] = payload.default_settings

    current_user.secrets = secrets
    # Required: tell SQLAlchemy the JSONB column is dirty so it writes to DB
    flag_modified(current_user, "secrets")
    await db.commit()

    return {"status": "success", "message": "BYOK profiles synchronized successfully"}