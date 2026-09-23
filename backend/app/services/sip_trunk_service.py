"""
SIP Trunk Service — LiveKit SIP Trunk Provisioning & Management.

Handles all LiveKit SIP API calls:
  - Inbound trunk creation  (SIP Provider → LiveKit)
  - Outbound trunk creation (LiveKit → SIP Provider)
  - Dispatch rule creation/deletion (routes inbound calls to agent workers)
  - Trunk listing and deletion

All methods are async-safe and idempotent where possible.
"""

import logging
import httpx
from typing import Optional

from app.core.config import settings
from app.core.livekit_auth import make_livekit_headers

logger = logging.getLogger("sip_trunk_service")

def _livekit_http_base() -> str:
    return settings.LIVEKIT_URL.replace("wss://", "https://").replace("ws://", "http://").rstrip("/")


class SIPTrunkService:
    """Async wrapper around LiveKit's SIP Trunk REST API."""

    # ─── Inbound Trunk ──────────────────────────────────────────────────────

    async def create_inbound_trunk(
        self,
        *,
        name: str,
        numbers: list[str],
        allowed_addresses: Optional[list[str]] = None,
        auth_username: Optional[str] = None,
        auth_password: Optional[str] = None,
    ) -> dict:
        """
        Creates a LiveKit Inbound SIP Trunk.

        The trunk accepts calls from the SIP provider (e.g., Twilio) and passes
        them into LiveKit's SIP gateway. The numbers list tells LiveKit which
        DIDs to accept calls on.

        Returns: {"trunk_id": str, "name": str}
        """
        body: dict = {
            "trunk": {
                "name": name,
                "numbers": numbers,
            }
        }
        if allowed_addresses:
            body["trunk"]["allowed_addresses"] = allowed_addresses
        if auth_username and auth_password:
            body["trunk"]["auth_username"] = auth_username
            body["trunk"]["auth_password"] = auth_password

        resp = await self._post("/twirp/livekit.SIP/CreateSIPInboundTrunk", body)
        trunk_id = (
            resp.get("sipTrunk", {}).get("sipTrunkId")
            or resp.get("sip_trunk_id")
            or resp.get("trunk_id", "")
        )

        if not trunk_id:
            raise RuntimeError(
                f"LiveKit returned no inbound trunk ID. Full response: {resp}"
            )

        logger.info(f"[SIP] Inbound trunk created: {trunk_id}")
        return {"trunk_id": trunk_id, "name": name, "raw": resp}

    async def list_inbound_trunks(self) -> list[dict]:
        """Lists all inbound SIP trunks on the LiveKit project."""
        resp = await self._post("/twirp/livekit.SIP/ListSIPInboundTrunk", {})
        return resp.get("items", [])

    async def delete_inbound_trunk(self, trunk_id: str) -> None:
        """Deletes a LiveKit Inbound SIP Trunk by its ID."""
        await self._post("/twirp/livekit.SIP/DeleteSIPTrunk", {"sip_trunk_id": trunk_id})
        logger.info(f"[SIP] Inbound trunk deleted: {trunk_id}")

    # ─── Outbound Trunk ─────────────────────────────────────────────────────

    async def create_outbound_trunk(
        self,
        *,
        name: str,
        address: str,
        numbers: list[str],
        auth_username: Optional[str] = None,
        auth_password: Optional[str] = None,
        transport: str = "AUTO",
    ) -> dict:
        """
        Creates a LiveKit Outbound SIP Trunk.

        The trunk dials out through the SIP provider (e.g., Twilio Elastic SIP).
        `address` is the SIP termination URI (e.g., "my-trunk.pstn.twilio.com").

        Returns: {"trunk_id": str, "name": str}
        """
        body: dict = {
            "trunk": {
                "name": name,
                "address": address,
                "numbers": numbers,
                "transport": transport,
            }
        }
        if auth_username and auth_password:
            body["trunk"]["auth_username"] = auth_username
            body["trunk"]["auth_password"] = auth_password

        resp = await self._post("/twirp/livekit.SIP/CreateSIPOutboundTrunk", body)
        trunk_id = (
            resp.get("sipTrunk", {}).get("sipTrunkId")
            or resp.get("sip_trunk_id")
            or resp.get("trunk_id", "")
        )
        if not trunk_id:
            raise RuntimeError(
                f"LiveKit returned no outbound trunk ID. Full response: {resp}"
            )

        logger.info(f"[SIP] Outbound trunk created: {trunk_id}")
        return {"trunk_id": trunk_id, "name": name, "raw": resp}

    async def list_outbound_trunks(self) -> list[dict]:
        """Lists all outbound SIP trunks on the LiveKit project."""
        resp = await self._post("/twirp/livekit.SIP/ListSIPOutboundTrunk", {})
        return resp.get("items", [])

    async def delete_outbound_trunk(self, trunk_id: str) -> None:
        """Deletes a LiveKit Outbound SIP Trunk by its ID."""
        await self._post("/twirp/livekit.SIP/DeleteSIPTrunk", {"sip_trunk_id": trunk_id})
        logger.info(f"[SIP] Outbound trunk deleted: {trunk_id}")

    async def delete_trunk(self, trunk_id: str, trunk_type: str = "inbound") -> None:
        """Deletes either an inbound or outbound trunk."""
        await self._post("/twirp/livekit.SIP/DeleteSIPTrunk", {"sip_trunk_id": trunk_id})
        logger.info(f"[SIP] Trunk ({trunk_type}) deleted: {trunk_id}")

    # ─── Dispatch Rules ─────────────────────────────────────────────────────

    async def create_dispatch_rule(
        self,
        *,
        trunk_ids: list[str],
        agent_name: str,
        room_prefix: str = "call-",
        metadata: Optional[str] = None,
        rule_name: Optional[str] = None,
    ) -> dict:
        """
        Creates a LiveKit SIP Dispatch Rule.

        The dispatch rule tells LiveKit which agent worker to dispatch when an
        inbound call arrives on the specified trunks.

        `metadata` should be the JSON string produced by _build_agent_metadata().
        If empty, the agent worker will use its own fallback configuration.

        Returns: {"dispatch_rule_id": str}
        """
        rule: dict = {
            "dispatch_rule": {
                "rule": {
                    "dispatchRuleIndividual": {
                        "roomPrefix": room_prefix
                    }
                },
                "name": rule_name or "VoiceForge dispatch rule",
                "trunkIds": trunk_ids,
                "roomConfig": {
                    "agents": [
                        {
                            "agentName": agent_name,
                            "metadata": metadata or "",
                        }
                    ]
                },
            }
        }

        resp = await self._post("/twirp/livekit.SIP/CreateSIPDispatchRule", rule)
        rule_id = (
            resp.get("sipDispatchRule", {}).get("sipDispatchRuleId")
            or resp.get("sip_dispatch_rule_id")
            or resp.get("dispatch_rule_id", "")
        )
        logger.info(f"[SIP] Dispatch rule created: {rule_id}")
        return {"dispatch_rule_id": rule_id, "raw": resp}

    async def list_dispatch_rules(self) -> list[dict]:
        """Lists all SIP dispatch rules on the LiveKit project."""
        resp = await self._post("/twirp/livekit.SIP/ListSIPDispatchRule", {})
        return resp.get("items", [])

    async def delete_dispatch_rule(self, rule_id: str) -> None:
        """Deletes a SIP dispatch rule by its ID."""
        await self._post(
            "/twirp/livekit.SIP/DeleteSIPDispatchRule",
            {"sip_dispatch_rule_id": rule_id},
        )
        logger.info(f"[SIP] Dispatch rule deleted: {rule_id}")

    # ─── HTTP Helper ────────────────────────────────────────────────────────

    async def _post(self, path: str, body: dict) -> dict:
        """Sends a signed POST request to the LiveKit Cloud SIP API."""
        url = f"{_livekit_http_base()}{path}"
        headers = make_livekit_headers()

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, json=body, headers=headers)

        if resp.status_code not in (200, 201):
            logger.error(f"[SIP] LiveKit API error {resp.status_code}: {resp.text}")
            raise RuntimeError(
                f"LiveKit SIP API error [{resp.status_code}]: {resp.text}"
            )

        return resp.json() if resp.text else {}


# Singleton
sip_trunk_service = SIPTrunkService()
