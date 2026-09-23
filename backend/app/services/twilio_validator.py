"""
Twilio Credential Validator.

Before provisioning SIP trunks we verify that the supplied Twilio
credentials are valid by making a lightweight test call to the Twilio API.
Fails fast with a meaningful error rather than letting LiveKit trunk
provisioning succeed but calls fail later.
"""

import logging
import httpx

logger = logging.getLogger("twilio_validator")


async def validate_twilio_credentials(
    account_sid: str,
    auth_token: str,
) -> tuple[bool, str]:
    """
    Tests Twilio credentials by fetching the account details.

    Returns: (is_valid: bool, error_message: str)
    """
    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}.json"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, auth=(account_sid, auth_token))

        if resp.status_code == 200:
            data = resp.json()
            status = data.get("status", "")
            if status == "closed":
                return False, "Twilio account is closed."
            if status == "suspended":
                return False, "Twilio account is suspended."
            return True, ""

        if resp.status_code == 401:
            return False, "Invalid Twilio Account SID or Auth Token."
        if resp.status_code == 404:
            return False, "Twilio Account SID not found."

        return False, f"Twilio API returned status {resp.status_code}."

    except httpx.ConnectError:
        return False, "Cannot reach Twilio API — check your network."
    except Exception as exc:
        logger.warning(f"[TwilioValidator] Unexpected error: {exc}")
        return False, f"Credential check failed: {exc}"
