"""
Settings API — Global user settings for telephony, preferences, and account management.
"""
import logging
from pydantic import BaseModel
from typing import Optional
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm.attributes import flag_modified

# pyrefly: ignore [missing-import]
from app.db.session import get_db
# pyrefly: ignore [missing-import]
from app.models.orm import UserORM, SIPTrunkORM, PhoneNumberORM, AgentORM
# pyrefly: ignore [missing-import]
from app.api.deps import get_current_user
# pyrefly: ignore [missing-import]
from app.core.security import vault

logger = logging.getLogger("settings")
router = APIRouter()


# ─── SCHEMAS ─────────────────────────────────────────────────────────────────

class TelephonySettings(BaseModel):
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_phone_number: str = ""
    default_agent_id: Optional[str] = None
    has_sip_trunks: bool = False
    inbound_active: bool = False
    outbound_active: bool = False
    trunk_count: int = 0

class GeneralSettings(BaseModel):
    timezone: str = "UTC"
    default_language: str = "en"
    notifications_enabled: bool = True
    auto_disconnect_seconds: int = 300

class UpdateTelephonyRequest(BaseModel):
    twilio_account_sid: Optional[str] = None
    twilio_auth_token: Optional[str] = None
    twilio_phone_number: Optional[str] = None
    default_agent_id: Optional[str] = None

class UpdateGeneralRequest(BaseModel):
    timezone: Optional[str] = None
    default_language: Optional[str] = None
    notifications_enabled: Optional[bool] = None
    auto_disconnect_seconds: Optional[int] = None


# ─── TELEPHONY SETTINGS ──────────────────────────────────────────────────────

@router.get("/telephony")
async def get_telephony_settings(
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns telephony configuration for the current user."""
    secrets = current_user.secrets or {}

    # Decrypt Twilio keys (show masked versions)
    sid = ""
    token = ""
    phone = ""
    try:
        raw_sid   = vault.decrypt(secrets.get("twilio_account_sid", ""))
        raw_token = vault.decrypt(secrets.get("twilio_auth_token", ""))
        raw_phone = vault.decrypt(secrets.get("twilio_phone_number", ""))
        sid   = f"{'*' * (len(raw_sid)   - 4)}{raw_sid[-4:]}"   if len(raw_sid)   > 4 else raw_sid
        token = f"{'*' * (len(raw_token) - 4)}{raw_token[-4:]}" if len(raw_token) > 4 else raw_token
        phone = raw_phone
    except Exception:
        logger.warning(
            "Failed to decrypt Twilio credentials for user %s — "
            "vault may be misconfigured or secrets corrupted.",
            current_user.id,
        )

    # Get trunk status
    trunk_result = await db.execute(
        select(SIPTrunkORM).where(SIPTrunkORM.user_id == current_user.id)
    )
    trunks = trunk_result.scalars().all()
    has_inbound  = any(t.trunk_type == "inbound"  and t.status == "active" for t in trunks)
    has_outbound = any(t.trunk_type == "outbound" and t.status == "active" for t in trunks)

    default_agent_id = secrets.get("default_agent_id", None)

    return {
        "twilio_account_sid":  sid,
        "twilio_auth_token":   token,
        "twilio_phone_number": phone,
        "default_agent_id":    default_agent_id,
        "has_sip_trunks":      len(trunks) > 0,
        "inbound_active":      has_inbound,
        "outbound_active":     has_outbound,
        "trunk_count":         len(trunks),
    }


@router.put("/telephony")
async def update_telephony_settings(
    payload: UpdateTelephonyRequest,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Updates telephony configuration."""
    logger.info(
        "[Settings] Saving telephony for user %s — payload keys: %s",
        current_user.id,
        [k for k, v in payload.model_dump().items() if v is not None],
    )

    # Re-fetch the user inside this session to avoid stale state from the
    # auth-middleware session (which may have already been expunged/closed).
    from sqlalchemy import select as _select
    result = await db.execute(_select(UserORM).where(UserORM.id == current_user.id))
    user = result.scalar_one()

    # Explicit copy so SQLAlchemy always sees a new object reference
    secrets = dict(user.secrets or {})

    if payload.twilio_account_sid is not None:
        # Guard against empty strings overwriting previously-set values
        if payload.twilio_account_sid.strip():
            secrets["twilio_account_sid"] = vault.encrypt(payload.twilio_account_sid.strip())
    if payload.twilio_auth_token is not None:
        if payload.twilio_auth_token.strip():
            secrets["twilio_auth_token"] = vault.encrypt(payload.twilio_auth_token.strip())
    if payload.twilio_phone_number is not None:
        if payload.twilio_phone_number.strip():
            secrets["twilio_phone_number"] = vault.encrypt(payload.twilio_phone_number.strip())
    if payload.default_agent_id is not None:
        secrets["default_agent_id"] = payload.default_agent_id

    user.secrets = secrets
    # Required: tell SQLAlchemy the JSONB column is dirty so it writes to DB
    flag_modified(user, "secrets")

    try:
        await db.commit()
        await db.refresh(user)
        logger.info(
            "[Settings] Telephony saved for user %s — keys now in secrets: %s",
            user.id,
            list(user.secrets.keys()),
        )
    except Exception as exc:
        await db.rollback()
        logger.error(
            "[Settings] Failed to commit telephony settings for user %s: %s",
            user.id,
            exc,
        )
        raise

    return {"status": "success", "message": "Telephony settings updated"}


# ─── GENERAL SETTINGS ────────────────────────────────────────────────────────

@router.get("/general")
async def get_general_settings(
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns general user settings."""
    secrets = current_user.secrets or {}

    return {
        "timezone":                secrets.get("timezone", "UTC"),
        "default_language":        secrets.get("default_language", "en"),
        "notifications_enabled":   secrets.get("notifications_enabled", True),
        "auto_disconnect_seconds": secrets.get("auto_disconnect_seconds", 300),
    }


@router.put("/general")
async def update_general_settings(
    payload: UpdateGeneralRequest,
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Updates general settings."""
    secrets = dict(current_user.secrets or {})

    if payload.timezone is not None:
        secrets["timezone"] = payload.timezone
    if payload.default_language is not None:
        secrets["default_language"] = payload.default_language
    if payload.notifications_enabled is not None:
        secrets["notifications_enabled"] = payload.notifications_enabled
    if payload.auto_disconnect_seconds is not None:
        secrets["auto_disconnect_seconds"] = payload.auto_disconnect_seconds

    current_user.secrets = secrets
    flag_modified(current_user, "secrets")
    await db.commit()

    return {"status": "success", "message": "General settings updated"}


# ─── ACCOUNT INFO ─────────────────────────────────────────────────────────────

@router.get("/account")
async def get_account_info(
    current_user: UserORM = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """Returns account summary including agent count, number count, etc."""
    agent_count = (await db.execute(
        select(func.count(AgentORM.id)).where(AgentORM.user_id == current_user.id)
    )).scalar_one()

    number_count = (await db.execute(
        select(func.count(PhoneNumberORM.id)).where(PhoneNumberORM.user_id == current_user.id)
    )).scalar_one()

    return {
        "user_id":    current_user.id,
        "email":      current_user.email,
        "full_name":  current_user.full_name,
        "created_at": current_user.created_at.isoformat() if current_user.created_at else None,
        "agent_count":  agent_count,
        "number_count": number_count,
    }