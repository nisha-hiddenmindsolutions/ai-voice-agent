"""
agent/tools/gmail.py

Gmail API tool capabilities exposed to LLM voice agents.
Expands a single GMAIL tool configured in the workspace into four distinct,
domain-agnostic voice functions:

    1. {name}_send_email              - Composes and dispatches a custom free-form email
    2. {name}_send_templated_email    - Sends branded, styled HTML emails (confirmations, brochures, directions, quotes)
    3. {name}_send_internal_staff_alert - Dispatches high-priority alerts to business staff/managers for callbacks or VIPs
    4. {name}_check_recent_email      - Verifies whether an email or document was received from the caller in Gmail
"""

import base64
import html
import logging
import re
import urllib.parse
from datetime import datetime, timezone
from email.mime.text import MIMEText
from typing import Annotated, Any, Dict, List, Optional

from pydantic import Field
from livekit.agents import function_tool

from .http_client import ToolHTTPError, request_json

logger = logging.getLogger("agent-tools.gmail")

_GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me/messages"
_GMAIL_PROFILE = "https://gmail.googleapis.com/gmail/v1/users/me/profile"


def _auth_headers(token: str) -> dict:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }


def _clean_email(email_str: str) -> str:
    """Pre-cleans email string in case it was passed phonetically or with spaces."""
    if not email_str:
        return ""
    cand = email_str.strip().lower()
    cand = (
        cand.replace(" at the rate ", "@")
        .replace(" at the ", "@")
        .replace(" added ", "@")
        .replace(" at ", "@")
        .replace(" dot ", ".")
        .replace(" ", "")
    )
    cand = re.sub(r'^[^\w]+|[^\w]+$', '', cand)
    match = re.search(r'[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+', cand)
    if match:
        return match.group(0)
    return cand


def _create_raw_message(recipient: str, subject: str, body: str) -> str:
    """Creates a base64url-encoded RFC 2822 MIME email string."""
    is_html = any(tag in body.lower() for tag in ("<html", "<p>", "<div", "<table", "<br"))
    message = MIMEText(body, "html" if is_html else "plain", "utf-8")
    message["to"] = recipient
    message["subject"] = subject
    
    raw_bytes = message.as_bytes()
    encoded = base64.urlsafe_b64encode(raw_bytes).decode("utf-8")
    return encoded


async def _get_authenticated_user_email(token: str) -> Optional[str]:
    """Retrieves the email address of the authenticated Google account."""
    if not token:
        return None
    try:
        status, data = await request_json(
            "GET",
            _GMAIL_PROFILE,
            headers=_auth_headers(token)
        )
        if status < 300 and isinstance(data, dict):
            return data.get("emailAddress")
    except Exception as exc:
        logger.warning(f"[Gmail] Could not resolve user profile email: {exc}")
    return None


# ---------------------------------------------------------------------------
# 1. Send Custom Email
# ---------------------------------------------------------------------------
async def send_email(token: str, recipient: str, subject: str, body: str) -> str:
    """Sends an email via Google Gmail REST API."""
    if not token:
        return "Failed: No Google authorization token found for Gmail."
    if not recipient:
        return "Failed: Missing recipient email address."

    recipient = _clean_email(recipient)
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


# ---------------------------------------------------------------------------
# 2. Send Templated Branded Email
# ---------------------------------------------------------------------------
def _build_templated_html(
    template_type: str,
    title: str,
    customer_name: str,
    service_or_item: str,
    scheduled_time_or_slot: str,
    location_or_address: str,
    notes_or_message: str,
    resource_url: str = "",
) -> str:
    """Generates clean, mobile-responsive HTML for various business templates."""
    t_type = (template_type or "confirmation").lower().strip()
    c_name = html.escape(customer_name.strip()) if customer_name else "Valued Client"
    svc = html.escape(service_or_item.strip()) if service_or_item else ""
    slot = html.escape(scheduled_time_or_slot.strip()) if scheduled_time_or_slot else ""
    loc = html.escape(location_or_address.strip()) if location_or_address else ""
    notes = html.escape(notes_or_message.strip()) if notes_or_message else ""
    res_url = resource_url.strip()

    # Brand Colors
    if "brochure" in t_type or "catalog" in t_type or "info" in t_type:
        header_grad = "linear-gradient(135deg, #3730a3, #4f46e5)"
        badge_text = "INFORMATION PACK"
        h_title = title or "Requested Information & Overview"
        h_sub = "Here are the details and materials requested during our call."
    elif "direction" in t_type or "map" in t_type or "location" in t_type:
        header_grad = "linear-gradient(135deg, #1e3a8a, #2563eb)"
        badge_text = "LOCATION & DIRECTIONS"
        h_title = title or "Office & Visiting Directions"
        h_sub = "Find our office location, map pin, and visiting instructions below."
    elif "quote" in t_type or "estimate" in t_type or "price" in t_type:
        header_grad = "linear-gradient(135deg, #581c87, #7c3aed)"
        badge_text = "QUOTATION & PRICING"
        h_title = title or "Quotation & Pricing Details"
        h_sub = "Estimated pricing and package scope as discussed on your call."
    else:  # Default / Confirmation
        header_grad = "linear-gradient(135deg, #065f46, #059669)"
        badge_text = "CONFIRMATION"
        h_title = title or "Booking & Appointment Confirmation"
        h_sub = "Your scheduled appointment has been successfully confirmed."

    rows_html = []
    if svc:
        rows_html.append(f"""
        <tr>
          <td style="padding: 10px 14px; color: #64748b; font-size: 13px; font-weight: 500; border-bottom: 1px solid #f1f5f9;">Service / Subject</td>
          <td style="padding: 10px 14px; color: #0f172a; font-size: 13px; font-weight: 600; border-bottom: 1px solid #f1f5f9;">{svc}</td>
        </tr>""")
    if slot:
        rows_html.append(f"""
        <tr>
          <td style="padding: 10px 14px; color: #64748b; font-size: 13px; font-weight: 500; border-bottom: 1px solid #f1f5f9;">Scheduled Time</td>
          <td style="padding: 10px 14px; color: #0f172a; font-size: 13px; font-weight: 600; border-bottom: 1px solid #f1f5f9;">{slot}</td>
        </tr>""")
    if loc:
        rows_html.append(f"""
        <tr>
          <td style="padding: 10px 14px; color: #64748b; font-size: 13px; font-weight: 500; border-bottom: 1px solid #f1f5f9;">Location / Address</td>
          <td style="padding: 10px 14px; color: #0f172a; font-size: 13px; font-weight: 600; border-bottom: 1px solid #f1f5f9;">{loc}</td>
        </tr>""")

    # Status row for confirmation
    if "confirmation" in t_type or not rows_html:
        rows_html.append("""
        <tr>
          <td style="padding: 10px 14px; color: #64748b; font-size: 13px; font-weight: 500; border-bottom: 1px solid #f1f5f9;">Status</td>
          <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9;">
            <span style="display: inline-block; background: #ecfdf5; color: #059669; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 9999px; border: 1px solid #a7f3d0;">CONFIRMED</span>
          </td>
        </tr>""")

    table_content = "".join(rows_html)

    # Optional Button / Resource Link
    button_html = ""
    if res_url:
        button_html = f"""
        <div style="margin-top: 20px; text-align: center;">
          <a href="{res_url}" target="_blank" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 22px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">Open Attached Resource / Document</a>
        </div>"""
    elif loc and ("direction" in t_type or "location" in t_type):
        maps_link = f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(location_or_address)}"
        button_html = f"""
        <div style="margin-top: 20px; text-align: center;">
          <a href="{maps_link}" target="_blank" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 600; padding: 10px 22px; border-radius: 6px; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">View on Google Maps</a>
        </div>"""

    # Notes section
    notes_block = ""
    if notes:
        notes_block = f"""
        <div style="margin-top: 18px; padding: 12px 16px; background: #f8fafc; border-left: 4px solid #3b82f6; border-radius: 4px;">
          <p style="margin: 0; font-size: 12px; color: #475569; line-height: 1.5;"><strong>Instructions & Notes:</strong> {notes}</p>
        </div>"""

    return f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 24px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b;">
  <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    
    <!-- Banner Header -->
    <div style="background: {header_grad}; padding: 26px 24px; text-align: left;">
      <span style="display: inline-block; background: rgba(255,255,255,0.2); color: #ffffff; font-size: 10px; font-weight: 700; padding: 3px 8px; border-radius: 4px; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 8px;">{badge_text}</span>
      <h1 style="color: #ffffff; margin: 0; font-size: 19px; font-weight: 700; letter-spacing: -0.02em;">{h_title}</h1>
      <p style="color: #e2e8f0; margin: 6px 0 0 0; font-size: 13px; line-height: 1.4;">{h_sub}</p>
    </div>

    <!-- Main Content -->
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px 0; font-size: 14px; color: #334155;">Hello <strong>{c_name}</strong>,</p>

      <!-- Details Table -->
      <table style="width: 100%; border-collapse: collapse; background: #ffffff; border: 1px solid #f1f5f9; border-radius: 8px; overflow: hidden;">
        <tbody>
          {table_content}
        </tbody>
      </table>

      {button_html}
      {notes_block}

      <p style="margin: 22px 0 0 0; font-size: 13px; color: #64748b; line-height: 1.5;">If you need to reschedule or have further questions, please contact our team directly.</p>
    </div>

    <!-- Footer -->
    <div style="background: #f8fafc; padding: 14px 24px; text-align: center; border-top: 1px solid #e2e8f0;">
      <p style="margin: 0; font-size: 11px; color: #94a3b8;">Automated communication dispatched by your AI Voice Assistant.</p>
    </div>
  </div>
</body>
</html>"""


async def send_templated_email(
    token: str,
    recipient: str,
    template_type: str,
    title: str = "",
    customer_name: str = "",
    service_or_item: str = "",
    scheduled_time_or_slot: str = "",
    location_or_address: str = "",
    notes_or_message: str = "",
    resource_url: str = "",
) -> str:
    """Dispatches a styled, branded HTML email based on standard templates."""
    if not token:
        return "Failed: No Google authorization token found for Gmail."
    if not recipient:
        return "Failed: Missing recipient email address."

    recipient = _clean_email(recipient)
    if "@" not in recipient:
        return f"Failed: Invalid recipient email address '{recipient}'."

    # Subject line synthesis
    t_type = (template_type or "confirmation").lower().strip()
    if not title:
        if "brochure" in t_type or "catalog" in t_type:
            subj = f"Information Pack: {service_or_item or 'Requested Overview'} - {customer_name or 'Valued Client'}"
        elif "direction" in t_type or "location" in t_type:
            subj = f"Visiting Directions: {location_or_address or 'Our Office'} - {customer_name or 'Valued Client'}"
        elif "quote" in t_type or "price" in t_type:
            subj = f"Pricing Quotation: {service_or_item or 'Requested Services'} - {customer_name or 'Valued Client'}"
        else:
            subj = f"Confirmation: {service_or_item or 'Your Booking'} - {customer_name or 'Appointment Reserved'}"
    else:
        subj = title

    html_body = _build_templated_html(
        template_type=t_type,
        title=title,
        customer_name=customer_name,
        service_or_item=service_or_item,
        scheduled_time_or_slot=scheduled_time_or_slot,
        location_or_address=location_or_address,
        notes_or_message=notes_or_message,
        resource_url=resource_url,
    )

    return await send_email(token, recipient, subj, html_body)


# ---------------------------------------------------------------------------
# 3. Send Internal Staff Alert (Escalation & VIP Callbacks)
# ---------------------------------------------------------------------------
async def send_internal_staff_alert(
    token: str,
    alert_type: str,
    caller_name: str,
    caller_phone: str,
    reason: str,
    urgency_level: str = "high",
    staff_email: Optional[str] = None,
    default_email: Optional[str] = None,
) -> str:
    """Sends an immediate priority alert to internal staff or managers."""
    if not token:
        return "Failed: No Google authorization token found for Gmail."

    target_email = _clean_email(staff_email) if staff_email else ""
    if not target_email and default_email:
        target_email = _clean_email(default_email)
    
    # Auto-resolve connected business owner's Gmail if not specified
    if not target_email:
        target_email = await _get_authenticated_user_email(token) or ""

    if not target_email or "@" not in target_email:
        return "Failed: Could not resolve a valid staff or manager email address to deliver the alert."

    urgency = (urgency_level or "high").upper().strip()
    category = (alert_type or "Urgent Request").replace("_", " ").title()
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

    # Header color by urgency
    if urgency in ("EMERGENCY", "CRITICAL", "URGENT"):
        header_color = "linear-gradient(135deg, #7f1d1d, #b91c1c)"
        badge_color = "#fee2e2"
        badge_text_color = "#991b1b"
    elif urgency == "HIGH":
        header_color = "linear-gradient(135deg, #78350f, #d97706)"
        badge_color = "#fef3c7"
        badge_text_color = "#92400e"
    else:
        header_color = "linear-gradient(135deg, #1e293b, #334155)"
        badge_color = "#f1f5f9"
        badge_text_color = "#334155"

    subj = f"🚨 [{urgency} ALERT] {category}: {caller_name} ({caller_phone})"

    alert_html = f"""<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 24px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b;">
  <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    
    <!-- Banner Header -->
    <div style="background: {header_color}; padding: 24px; text-align: left;">
      <span style="display: inline-block; background: {badge_color}; color: {badge_text_color}; font-size: 11px; font-weight: 800; padding: 3px 8px; border-radius: 4px; letter-spacing: 0.05em; text-transform: uppercase; margin-bottom: 6px;">{urgency} PRIORITY</span>
      <h1 style="color: #ffffff; margin: 0; font-size: 19px; font-weight: 700;">{category}</h1>
      <p style="color: #f8fafc; margin: 6px 0 0 0; font-size: 12px;">Triggered live during an AI phone call at {now_str}</p>
    </div>

    <!-- Alert Details -->
    <div style="padding: 24px;">
      <p style="margin: 0 0 16px 0; font-size: 14px; color: #334155;">A caller requires immediate staff attention or escalation:</p>

      <table style="width: 100%; border-collapse: collapse; background: #ffffff; border: 1px solid #f1f5f9; border-radius: 8px; overflow: hidden;">
        <tbody>
          <tr>
            <td style="padding: 10px 14px; color: #64748b; font-size: 13px; font-weight: 500; border-bottom: 1px solid #f1f5f9;">Caller Name</td>
            <td style="padding: 10px 14px; color: #0f172a; font-size: 14px; font-weight: 700; border-bottom: 1px solid #f1f5f9;">{html.escape(caller_name)}</td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; color: #64748b; font-size: 13px; font-weight: 500; border-bottom: 1px solid #f1f5f9;">Phone Number</td>
            <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9;">
              <a href="tel:{caller_phone}" style="color: #2563eb; font-size: 14px; font-weight: 700; text-decoration: none;">{html.escape(caller_phone)}</a>
            </td>
          </tr>
          <tr>
            <td style="padding: 10px 14px; color: #64748b; font-size: 13px; font-weight: 500; border-bottom: 1px solid #f1f5f9;">Reason / Notes</td>
            <td style="padding: 10px 14px; color: #0f172a; font-size: 13px; line-height: 1.5; border-bottom: 1px solid #f1f5f9;">{html.escape(reason)}</td>
          </tr>
        </tbody>
      </table>

      <div style="margin-top: 20px; padding: 12px 16px; background: #fff1f2; border: 1px solid #fecdd3; border-radius: 6px;">
        <p style="margin: 0; font-size: 13px; color: #9f1239; font-weight: 600;">Action Required: Please review this alert and initiate follow-up contact with the customer promptly.</p>
      </div>
    </div>

    <!-- Footer -->
    <div style="background: #f8fafc; padding: 12px 24px; text-align: center; border-top: 1px solid #e2e8f0;">
      <p style="margin: 0; font-size: 11px; color: #94a3b8;">Automated live escalation dispatched by Voice Agent integration.</p>
    </div>
  </div>
</body>
</html>"""

    result = await send_email(token, target_email, subj, alert_html)
    if "successfully" in result.lower():
        return f"Urgent alert successfully dispatched to staff ({target_email}) regarding {caller_name}."
    return result


# ---------------------------------------------------------------------------
# 4. Check / Search Recent Emails
# ---------------------------------------------------------------------------
async def check_recent_email(
    token: str,
    sender_email: str = "",
    search_query: str = "",
    max_results: int = 3,
) -> str:
    """Verifies whether an email or document was received from the caller in Gmail."""
    if not token:
        return "Failed: No Google authorization token found for Gmail."

    sender = _clean_email(sender_email) if sender_email else ""
    query_terms: List[str] = []
    if sender:
        query_terms.append(f"from:{sender}")
    if search_query:
        query_terms.append(search_query.strip())

    q = " ".join(query_terms) if query_terms else "label:INBOX"

    try:
        status, data = await request_json(
            "GET",
            _GMAIL_BASE,
            headers=_auth_headers(token),
            params={"q": q, "maxResults": max_results}
        )

        if status >= 300:
            err_msg = data.get("error", {}).get("message", str(data)) if isinstance(data, dict) else str(data)[:200]
            logger.warning(f"[Gmail] check_recent_email error {status}: {err_msg}")
            return f"Could not check emails via Gmail: {err_msg}"

        messages = data.get("messages", []) if isinstance(data, dict) else []
        if not messages:
            target_desc = f"from '{sender}'" if sender else f"matching '{search_query}'"
            return f"No recent emails found {target_desc} in the inbox."

        summaries: List[str] = []
        for idx, item in enumerate(messages[:max_results]):
            msg_id = item.get("id")
            if not msg_id:
                continue

            m_status, m_data = await request_json(
                "GET",
                f"{_GMAIL_BASE}/{msg_id}",
                headers=_auth_headers(token),
                params={"format": "metadata"}
            )

            if m_status < 300 and isinstance(m_data, dict):
                headers = m_data.get("payload", {}).get("headers", [])
                subj = next((h["value"] for h in headers if h.get("name", "").lower() == "subject"), "(No Subject)")
                from_hdr = next((h["value"] for h in headers if h.get("name", "").lower() == "from"), "(Unknown)")
                date_hdr = next((h["value"] for h in headers if h.get("name", "").lower() == "date"), "")
                snippet = html.unescape(m_data.get("snippet", "")).strip()
                if len(snippet) > 130:
                    snippet = snippet[:127] + "..."

                summaries.append(
                    f"Email #{idx+1}: From: {from_hdr} | Date: {date_hdr} | Subject: '{subj}' | Preview: \"{snippet}\""
                )

        if not summaries:
            return f"Emails were detected for {sender or search_query}, but details could not be read."

        return f"Found {len(summaries)} matching email(s):\n" + "\n".join(summaries)

    except ToolHTTPError as exc:
        logger.error(f"[Gmail] HTTP exception in check_recent_email: {exc}")
        return f"Gmail service is temporarily unreachable: {exc}"
    except Exception as exc:
        logger.exception(f"[Gmail] Unexpected error in check_recent_email: {exc}")
        return f"Could not check emails due to an error: {exc}"


# ---------------------------------------------------------------------------
# Tool Builder for LiveKit Agent Function Tools
# ---------------------------------------------------------------------------
def build_gmail_tools(t_cfg: dict, name: str, desc: str) -> list:
    """
    Wires the Gmail API functions into named FunctionTool objects for LiveKit agent registration.
    Expands into 4 distinct tools:
      1. {name}_send_email
      2. {name}_send_templated_email
      3. {name}_send_internal_staff_alert
      4. {name}_check_recent_email
    """
    token = t_cfg.get("apiKey", "")
    cfg_staff_email = t_cfg.get("config", {}).get("staff_email") or t_cfg.get("config", {}).get("notification_email") or ""

    tools = []

    # 1. Custom Send Email
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
        """Composes and sends a custom email message to the specified recipient email address."""
        logger.info(f"[GMAIL] {name}_send_email to={recipient_email} subject='{subject}'")
        if not token:
            return "Failed: Gmail integration is not connected to a Google Account."
        return await send_email(token, recipient_email, subject, message_body)

    _send.__name__ = f"{name}_send_email"
    tools.append(
        function_tool(
            _send,
            name=f"{name}_send_email",
            description=f"{desc} Composes and sends a custom email to the specified recipient."
        )
    )

    # 2. Templated Branded Email
    async def _send_templated(
        recipient_email: Annotated[
            str,
            Field(description="The destination email address specified by the caller, e.g. caller@example.com.")
        ],
        template_type: Annotated[
            str,
            Field(description="Type of branded template to send. Choices: 'confirmation' (booking/visit/order confirmation), 'brochure' (information pack, floorplans, service catalog), 'directions' (location address, landmarks, map link), or 'quote' (price estimate).")
        ],
        title: Annotated[
            str,
            Field(description="Optional custom title or subject for the email, e.g. 'Dental Consultation Confirmation' or '3BHK Floor Plan Pack'.")
        ] = "",
        customer_name: Annotated[
            str,
            Field(description="Name of the customer or caller.")
        ] = "",
        service_or_item: Annotated[
            str,
            Field(description="Service, property, doctor, or item discussed on the call (e.g. 'Dental Consultation', '3BHK Luxury Flat').")
        ] = "",
        scheduled_time_or_slot: Annotated[
            str,
            Field(description="Date and time, slot, or appointment schedule (e.g. 'Tomorrow at 2:00 PM').")
        ] = "",
        location_or_address: Annotated[
            str,
            Field(description="Physical address, clinic location, or office address.")
        ] = "",
        notes_or_message: Annotated[
            str,
            Field(description="Additional notes, instructions, pricing, or details for the caller.")
        ] = "",
        resource_url: Annotated[
            str,
            Field(description="Optional web link to a brochure PDF, catalog, intake form, or document.")
        ] = "",
        **kwargs: Any
    ) -> str:
        """Sends a beautifully styled, branded HTML email (confirmation, brochure, directions, or quote) to the caller."""
        logger.info(f"[GMAIL] {name}_send_templated_email to={recipient_email} template={template_type}")
        if not token:
            return "Failed: Gmail integration is not connected to a Google Account."
        return await send_templated_email(
            token=token,
            recipient=recipient_email,
            template_type=template_type,
            title=title,
            customer_name=customer_name,
            service_or_item=service_or_item,
            scheduled_time_or_slot=scheduled_time_or_slot,
            location_or_address=location_or_address,
            notes_or_message=notes_or_message,
            resource_url=resource_url,
        )

    _send_templated.__name__ = f"{name}_send_templated_email"
    tools.append(
        function_tool(
            _send_templated,
            name=f"{name}_send_templated_email",
            description="Sends a branded HTML email (confirmation pass, brochure/information pack, office directions, or pricing quote) to the caller."
        )
    )

    # 3. Internal Staff Alert
    async def _send_alert(
        alert_type: Annotated[
            str,
            Field(description="Category of alert: 'urgent_callback', 'vip_lead', 'medical_emergency', 'customer_complaint', or 'escalation'.")
        ],
        caller_name: Annotated[
            str,
            Field(description="Full name of the caller.")
        ],
        caller_phone: Annotated[
            str,
            Field(description="Contact phone number of the caller.")
        ],
        reason: Annotated[
            str,
            Field(description="Detailed explanation of why staff attention is required, what the caller requested, or the urgent matter.")
        ],
        urgency_level: Annotated[
            str,
            Field(description="Urgency priority: 'high', 'urgent', or 'medium'. Defaults to 'high'.")
        ] = "high",
        staff_email: Annotated[
            str,
            Field(description="Optional specific staff or department email to notify. If omitted, automatically alerts the connected business owner.")
        ] = "",
        **kwargs: Any
    ) -> str:
        """Sends an immediate priority alert email to internal staff, manager, or doctor when an urgent matter or VIP is detected."""
        logger.info(f"[GMAIL] {name}_send_internal_staff_alert type={alert_type} caller={caller_name} phone={caller_phone}")
        if not token:
            return "Failed: Gmail integration is not connected to a Google Account."
        return await send_internal_staff_alert(
            token=token,
            alert_type=alert_type,
            caller_name=caller_name,
            caller_phone=caller_phone,
            reason=reason,
            urgency_level=urgency_level,
            staff_email=staff_email,
            default_email=cfg_staff_email,
        )

    _send_alert.__name__ = f"{name}_send_internal_staff_alert"
    tools.append(
        function_tool(
            _send_alert,
            name=f"{name}_send_internal_staff_alert",
            description="Sends an urgent priority alert to internal staff or managers when a caller has an emergency, asks for a human callback, or is a VIP."
        )
    )

    # 4. Check / Verify Recent Email
    async def _check_recent(
        sender_email: Annotated[
            str,
            Field(description="Email address of the caller to search for in incoming emails, e.g. caller@example.com.")
        ] = "",
        search_query: Annotated[
            str,
            Field(description="Optional search keywords, subject title, prescription, or reference ID to match in emails.")
        ] = "",
        **kwargs: Any
    ) -> str:
        """Searches the business Gmail inbox to verify if an email, document, prescription, or receipt was received from the caller."""
        logger.info(f"[GMAIL] {name}_check_recent_email sender={sender_email} query='{search_query}'")
        if not token:
            return "Failed: Gmail integration is not connected to a Google Account."
        return await check_recent_email(
            token=token,
            sender_email=sender_email,
            search_query=search_query,
        )

    _check_recent.__name__ = f"{name}_check_recent_email"
    tools.append(
        function_tool(
            _check_recent,
            name=f"{name}_check_recent_email",
            description="Searches incoming Gmail to verify if an email, document, or prescription sent by the caller has been received."
        )
    )

    return tools
