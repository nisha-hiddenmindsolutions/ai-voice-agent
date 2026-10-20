"""
agent/tools/gmail.py

Gmail API tool capability exposed to LLM voice agents.
Allows agents to send custom emails live during a call session.

Exposes function tool:
    {name}_send_email - Composes and dispatches an email to a requested recipient
"""

import base64
import logging
from email.mime.text import MIMEText
from typing import Annotated, Any

from pydantic import Field
from livekit.agents import function_tool

from .http_client import ToolHTTPError, request_json

logger = logging.getLogger("agent-tools.gmail")

_GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me/messages"


def _auth_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }


def _create_raw_message(recipient: str, subject: str, body: str) -> str:
    """Creates a base64url-encoded RFC 2822 MIME email string."""
    message = MIMEText(body, "html" if "<html" in body.lower() or "<p>" in body.lower() else "plain")
    message["to"] = recipient
    message["subject"] = subject
    
    raw_bytes = message.as_bytes()
    encoded = base64.urlsafe_b64encode(raw_bytes).decode("utf-8")
    return encoded


async def send_email(token: str, recipient: str, subject: str, body: str) -> str:
    """Sends an email via Google Gmail REST API."""
    if not token:
        return "Failed: No Google authorization token found for Gmail."
    if not recipient:
        return "Failed: Missing recipient email address."

    # Pre-clean recipient in case it was passed phonetically or with spaces
    recipient = recipient.strip()
    if "@" not in recipient or " " in recipient:
        import re
        cand = recipient.lower().replace(" at the rate ", "@").replace(" at the ", "@").replace(" added ", "@").replace(" at ", "@").replace(" dot ", ".").replace(" ", "")
        cand = re.sub(r'^[^\w]+|[^\w]+$', '', cand)
        if re.match(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$', cand):
            recipient = cand

    if "@" not in recipient:
        return f"Failed: Invalid recipient email address '{recipient}'."
    try:
        raw_msg = _create_raw_message(recipient, subject, body)
        status, data = await request_json(
            "POST",
            f"{_GMAIL_BASE}/send",
            headers=_auth_headers(token),
            json_body={"raw": raw_msg}
        )

        if status < 300:
            logger.info(f"[Gmail] Successfully sent email to {recipient} with subject '{subject}'")
            return f"Email sent successfully to {recipient}."
        
        err_msg = data.get("error", {}).get("message", str(data)) if isinstance(data, dict) else str(data)[:200]
        logger.warning(f"[Gmail] API error {status}: {err_msg}")
        return f"Could not send email via Gmail: {err_msg}"

    except ToolHTTPError as exc:
        logger.error(f"[Gmail] HTTP exception: {exc}")
        return f"Gmail service is temporarily unreachable: {exc}"
    except Exception as exc:
        logger.exception(f"[Gmail] Unexpected error in send_email: {exc}")
        return f"Could not send email due to an error: {exc}"


def build_gmail_tools(t_cfg: dict, name: str, desc: str) -> list:
    """
    Wires the Gmail API function into a named FunctionTool object for LiveKit agent registration.
    """
    token = t_cfg.get("apiKey", "")

    tools = []

    async def _send(
        recipient_email: Annotated[
            str,
            Field(description="The destination email address specified by the caller, e.g. caller@example.com.")
        ],
        subject: Annotated[
            str,
            Field(description="Clear and professional subject line for the email.")
        ],
        message_body: Annotated[
            str,
            Field(description="Full text or HTML content of the email message to send.")
        ],
        **kwargs: Any
    ) -> str:
        """Composes and sends an email message to the specified recipient email address."""
        logger.info(f"[GMAIL] {name}_send_email to={recipient_email} subject='{subject}'")
        if not token:
            return "Failed: Gmail integration is not connected to a Google Account."
        return await send_email(token, recipient_email, subject, message_body)

    _send.__name__ = f"{name}_send_email"
    tools.append(
        function_tool(
            _send,
            name=f"{name}_send_email",
            description=f"{desc} Composes and sends an email to the specified recipient email address."
        )
    )

    return tools
