"""
LiveKit Auth Helpers.

Provides:
  - JWT access token generation for LiveKit API calls (via python-jose)
  - Request header builder for LiveKit REST/Twirp endpoints
  - HMAC-SHA256 webhook signature verification
  - Agent dispatch token generation
"""

import hashlib
import hmac
import time
import logging
import base64
from typing import Optional

from jose import jwt as jose_jwt

from app.core.config import settings

logger = logging.getLogger("livekit_auth")

_ALGORITHM = "HS256"


# ─── Access Token ────────────────────────────────────────────────────────────

def _build_access_token(
    video_grants: Optional[dict] = None,
    sip_grants: Optional[dict] = None,
    ttl_seconds: int = 3600,
) -> str:
    """
    Creates a signed LiveKit access token (JWT) with the given video grants.
    Used for both REST API calls and agent dispatch.
    """
    now = int(time.time())
    payload = {
        "iss": settings.LIVEKIT_API_KEY,
        "sub": settings.LIVEKIT_API_KEY,
        "iat": now,
        "exp": now + ttl_seconds,
        "nbf": now,
    }
    if video_grants:
        payload["video"] = video_grants
    if sip_grants:
        payload["sip"] = sip_grants
    return jose_jwt.encode(
        payload,
        settings.LIVEKIT_API_SECRET,
        algorithm=_ALGORITHM,
    )


def make_livekit_token(grants: Optional[dict] = None) -> str:
    """Token with full admin grants — used for server-side API calls."""
    return _build_access_token(
        video_grants=grants or {
            "roomCreate": True,
            "roomList": True,
            "roomAdmin": True,
            "roomJoin": True,
            "canPublish": True,
            "canSubscribe": True,
        },
        sip_grants={"admin": True, "call": True},
    )


def make_agent_dispatch_token(room_name: str, agent_name: str) -> str:
    """Token scoped to a specific room for agent dispatch."""
    return _build_access_token(
        video_grants={
            "roomAdmin": True,
            "room": room_name,
            "agent": True,
        }
    )


def make_livekit_headers(grants: Optional[dict] = None) -> dict:
    """
    Returns HTTP headers required for LiveKit Cloud REST/Twirp API calls.
    The Authorization token is freshly signed on each call.
    """
    token = make_livekit_token(grants)
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }


# ─── Webhook Signature Verification ─────────────────────────────────────────

def verify_livekit_webhook(
    body: bytes,
    authorization_header: str,
) -> dict:
    """
    Verifies a LiveKit signed webhook and returns the decoded payload.

    LiveKit signs webhooks with HMAC-SHA256 using the API secret. The
    Authorization header carries the signed JWT; its `sha256` claim contains
    the expected hash of the request body.

    Raises ValueError if the signature is invalid.
    """
    try:
        # Decode WITHOUT verification first to get sha256 claim
        unverified = jose_jwt.get_unverified_claims(authorization_header)
    except Exception as exc:
        raise ValueError(f"Cannot decode webhook JWT: {exc}") from exc

    expected_hash = unverified.get("sha256", "")
    if not expected_hash:
        raise ValueError("Webhook JWT missing sha256 claim")

    # Compute SHA-256 of the raw request body
    actual_hash = base64.b64encode(hashlib.sha256(body).digest()).decode()
    if not hmac.compare_digest(expected_hash, actual_hash):
        raise ValueError("Webhook body hash mismatch — possible replay attack")

    # Now fully verify the JWT signature
    try:
        claims = jose_jwt.decode(
            authorization_header,
            settings.LIVEKIT_API_SECRET,
            algorithms=[_ALGORITHM],
        )
    except Exception as exc:
        raise ValueError(f"Webhook JWT signature invalid: {exc}") from exc

    return claims
