"""
SIP Call Service — Native LiveKit Outbound Call Execution.

Handles the two-step outbound call sequence:
  Step 1: Pre-dispatch the AI agent into a named LiveKit room.
  Step 2: Create a SIP participant that dials the customer (via LiveKit → Twilio trunk).

This is the canonical (preferred) outbound path. The Twilio REST fallback
in twilio.py should only be used for trial accounts that cannot receive SIP.
"""

import asyncio
import logging
import uuid
import httpx
import json

from app.core.config import settings
from app.core.livekit_auth import make_livekit_headers

logger = logging.getLogger("sip_service")

_LK_BASE = settings.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://")

class SIPService:
    """Manages native LiveKit SIP outbound calls."""

    _http = httpx.AsyncClient(
        http2=True,
        timeout=httpx.Timeout(8.0, connect=3.0),
        limits=httpx.Limits(max_keepalive_connections=10, max_connections=20),
    )

    async def create_outbound_call(
        self,
        *,
        to_number: str,
        from_number: str,
        outbound_trunk_id: str,
        agent_name: str,
        agent_metadata: str,
        room_prefix: str = "call-",
    ) -> dict:
        """
        Full two-step outbound call:
        1. Pre-dispatch agent into a fresh room.
        2. Dial the customer via LiveKit SIP participant.

        Returns: {"room_name": str, "sip_participant_id": str}
        """
        room_name = f"{room_prefix}{uuid.uuid4().hex[:10]}"

        # Steps 1 & 2 — Dispatch agent and dial customer concurrently
        _, sip_participant = await asyncio.gather(
            self._dispatch_agent(
                room_name=room_name,
                agent_name=agent_name,
                metadata=agent_metadata,
            ),
            self._create_sip_participant(
                room_name=room_name,
                to_number=to_number,
                from_number=from_number,
                trunk_id=outbound_trunk_id,
            ),
        )
        logger.info(f"[SIP] Agent dispatched and SIP participant created for {to_number}")

        return {
            "room_name": room_name,
            "sip_participant_id": sip_participant.get("participant_id", ""),
        }

    # ─── Agent Dispatch ─────────────────────────────────────────────────────

    async def _dispatch_agent(
        self,
        *,
        room_name: str,
        agent_name: str,
        metadata: str,
    ) -> dict:
        """
        Issues an AgentDispatch request to LiveKit so the worker is waiting
        in the room before the SIP leg arrives.
        """
        url = f"{_LK_BASE}/twirp/livekit.AgentDispatch/CreateDispatch"
        body = {
            "room": room_name,
            "agent_name": agent_name,
            "metadata": metadata,
        }
        headers = make_livekit_headers()

        resp = await self._http.post(url, json=body, headers=headers)

        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"Agent dispatch failed [{resp.status_code}]: {resp.text}"
            )
        data = {}
        if resp.text and resp.text.strip():
            try:
                data = resp.json()
            except Exception:
                data = {}
        return data

    # ─── SIP Participant ────────────────────────────────────────────────────

    async def _create_sip_participant(
        self,
        *,
        room_name: str,
        to_number: str,
        from_number: str,
        trunk_id: str,
    ) -> dict:
        """
        Creates a SIP participant in an existing room which causes LiveKit to
        dial the destination phone number via the specified outbound trunk.
        """
        url = f"{_LK_BASE}/twirp/livekit.SIP/CreateSIPParticipant"
        body = {
            "room_name": room_name,
            "sip_trunk_id": trunk_id,
            "sip_call_to": to_number,
            "sip_call_from": from_number,
            "participant_identity": f"sip-{uuid.uuid4().hex[:6]}",
            "participant_name": "Customer",
        }
        headers = make_livekit_headers()

        resp = await self._http.post(url, json=body, headers=headers)

        if resp.status_code not in (200, 201):
            raise RuntimeError(
                f"SIP participant creation failed [{resp.status_code}]: {resp.text}"
            )
        data = {}
        if resp.text and resp.text.strip():
            try:
                data = resp.json()
            except Exception:
                data = {}

        return {
            "participant_id": data.get("participantIdentity", "") or data.get("participant_identity", ""),
            "raw": data,
        }


# Singleton
sip_service = SIPService()
