"""
agent/tools/google_calendar.py

Google Calendar capabilities exposed to the LLM. A single CALENDAR tool
configured in the dashboard now expands into FIVE distinct function tools
instead of one "create event only" tool:

    {name}_schedule_event      - book a new event
    {name}_check_availability  - free/busy check before booking
    {name}_list_events         - "what's on my calendar" style queries
    {name}_cancel_event        - cancel, matched by title + approx time
    {name}_reschedule_event    - move an existing event to a new time

Splitting one logical integration into several narrowly-scoped tools is
deliberate: smaller, single-purpose tools are far more reliable for
LLM tool-selection (especially fast/weaker models) than one tool with a
"mode" argument the model has to get right.

Event lookup for cancel/reschedule is done by title + approximate time
rather than a raw event ID, since a voice caller will say "cancel my
4pm with Dr. Vikas", never a Google event ID.
"""

import datetime
import logging
from typing import Annotated, Any, Optional

from dateutil import parser as date_parser
from pydantic import Field

from livekit.agents import function_tool

from .http_client import ToolHTTPError, request_json

logger = logging.getLogger("agent-tools.calendar")

_CAL_BASE = "https://www.googleapis.com/calendar/v3"


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _to_utc(value: str) -> datetime.datetime:
    dt = date_parser.parse(value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.datetime.now().astimezone().tzinfo)
    return dt.astimezone(datetime.timezone.utc)


def _iso_z(dt: datetime.datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _api_error_message(data: Any) -> str:
    if isinstance(data, dict):
        return data.get("error", {}).get("message", str(data))
    return str(data)[:300]


# ---------------------------------------------------------------------------
# Core operations (pure functions — no LLM/tool-schema concerns here)
# ---------------------------------------------------------------------------
async def schedule_event(
    token: str,
    calendar_id: str,
    summary: str,
    start_time: str,
    duration_mins: int = 30,
    description: str = "",
    attendee_email: Optional[str] = None,
) -> str:
    try:
        start_utc = _to_utc(start_time)
        end_utc = start_utc + datetime.timedelta(minutes=duration_mins)
        payload: dict[str, Any] = {
            "summary": summary,
            "description": description or "",
            "start": {"dateTime": _iso_z(start_utc), "timeZone": "UTC"},
            "end": {"dateTime": _iso_z(end_utc), "timeZone": "UTC"},
        }
        if attendee_email:
            payload["attendees"] = [{"email": attendee_email}]

        status, data = await request_json(
            "POST",
            f"{_CAL_BASE}/calendars/{calendar_id}/events",
            headers=_auth_headers(token),
            json_body=payload,
        )
        if status < 300:
            return f"Booked: '{summary}' on {start_time} for {duration_mins} minutes."
        return f"Could not book the event: {_api_error_message(data)}"
    except ToolHTTPError as exc:
        return f"Calendar is unreachable right now: {exc}"
    except Exception as exc:
        logger.error(f"[Calendar] schedule_event error: {exc}")
        return f"Could not book the event due to an unexpected error: {exc}"


async def check_availability(token: str, calendar_id: str, start_time: str, end_time: str) -> str:
    try:
        payload = {
            "timeMin": _iso_z(_to_utc(start_time)),
            "timeMax": _iso_z(_to_utc(end_time)),
            "items": [{"id": calendar_id}],
        }
        status, data = await request_json(
            "POST", f"{_CAL_BASE}/freeBusy",
            headers=_auth_headers(token), json_body=payload,
        )
        if status >= 300:
            return f"Could not check availability: {_api_error_message(data)}"
        busy = data.get("calendars", {}).get(calendar_id, {}).get("busy", []) if isinstance(data, dict) else []
        if not busy:
            return f"Free between {start_time} and {end_time}."
        busy_desc = "; ".join(f"{b.get('start')} to {b.get('end')}" for b in busy)
        return f"Not free the whole window — existing bookings: {busy_desc}."
    except ToolHTTPError as exc:
        return f"Calendar is unreachable right now: {exc}"
    except Exception as exc:
        logger.error(f"[Calendar] check_availability error: {exc}")
        return f"Could not check availability due to an unexpected error: {exc}"


async def list_events(token: str, calendar_id: str, time_min: str, time_max: str, max_results: int = 10) -> str:
    try:
        params = {
            "timeMin": _iso_z(_to_utc(time_min)),
            "timeMax": _iso_z(_to_utc(time_max)),
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": max_results,
        }
        status, data = await request_json(
            "GET", f"{_CAL_BASE}/calendars/{calendar_id}/events",
            headers=_auth_headers(token), params=params,
        )
        if status >= 300:
            return f"Could not list events: {_api_error_message(data)}"
        items = data.get("items", []) if isinstance(data, dict) else []
        if not items:
            return f"No events between {time_min} and {time_max}."
        lines = []
        for ev in items[:max_results]:
            summary = ev.get("summary", "(no title)")
            start = ev.get("start", {}).get("dateTime") or ev.get("start", {}).get("date")
            lines.append(f"- {summary} at {start}")
        return "\n".join(lines)
    except ToolHTTPError as exc:
        return f"Calendar is unreachable right now: {exc}"
    except Exception as exc:
        logger.error(f"[Calendar] list_events error: {exc}")
        return f"Could not list events due to an unexpected error: {exc}"


async def _find_event(
    token: str,
    calendar_id: str,
    summary_hint: str,
    near_time: Optional[str] = None,
    search_window_days: int = 30,
) -> Optional[dict]:
    """Best-effort search for an event by title text + optional approximate
    time. Voice callers virtually never know a raw Google event ID."""
    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        center = _to_utc(near_time) if near_time else now
    except Exception:
        center = now

    params = {
        "timeMin": _iso_z(center - datetime.timedelta(days=search_window_days)),
        "timeMax": _iso_z(center + datetime.timedelta(days=search_window_days)),
        "singleEvents": "true",
        "orderBy": "startTime",
        "q": summary_hint,
        "maxResults": 10,
    }
    status, data = await request_json(
        "GET", f"{_CAL_BASE}/calendars/{calendar_id}/events",
        headers=_auth_headers(token), params=params,
    )
    if status >= 300 or not isinstance(data, dict):
        return None
    items = data.get("items", [])
    if not items:
        return None
    if not near_time:
        return items[0]

    def _delta(ev: dict) -> float:
        s = ev.get("start", {}).get("dateTime") or ev.get("start", {}).get("date")
        try:
            return abs((date_parser.parse(s) - center.replace(tzinfo=None)).total_seconds())
        except Exception:
            return float("inf")

    return min(items, key=_delta)


async def cancel_event(token: str, calendar_id: str, summary_hint: str, near_time: Optional[str] = None) -> str:
    try:
        event = await _find_event(token, calendar_id, summary_hint, near_time)
        if not event:
            return f"Could not find an event matching '{summary_hint}' to cancel."
        status, data = await request_json(
            "DELETE", f"{_CAL_BASE}/calendars/{calendar_id}/events/{event['id']}",
            headers=_auth_headers(token),
        )
        if status < 300:
            return f"Cancelled: '{event.get('summary', summary_hint)}'."
        return f"Could not cancel the event: {_api_error_message(data)}"
    except ToolHTTPError as exc:
        return f"Calendar is unreachable right now: {exc}"
    except Exception as exc:
        logger.error(f"[Calendar] cancel_event error: {exc}")
        return f"Could not cancel the event due to an unexpected error: {exc}"


async def reschedule_event(
    token: str,
    calendar_id: str,
    summary_hint: str,
    new_start_time: str,
    duration_mins: int = 30,
    old_start_time_hint: Optional[str] = None,
) -> str:
    try:
        event = await _find_event(token, calendar_id, summary_hint, old_start_time_hint)
        if not event:
            return f"Could not find an event matching '{summary_hint}' to reschedule."
        start_utc = _to_utc(new_start_time)
        end_utc = start_utc + datetime.timedelta(minutes=duration_mins)
        payload = {
            "start": {"dateTime": _iso_z(start_utc), "timeZone": "UTC"},
            "end": {"dateTime": _iso_z(end_utc), "timeZone": "UTC"},
        }
        status, data = await request_json(
            "PATCH", f"{_CAL_BASE}/calendars/{calendar_id}/events/{event['id']}",
            headers=_auth_headers(token), json_body=payload,
        )
        if status < 300:
            return f"Rescheduled '{event.get('summary', summary_hint)}' to {new_start_time}."
        return f"Could not reschedule the event: {_api_error_message(data)}"
    except ToolHTTPError as exc:
        return f"Calendar is unreachable right now: {exc}"
    except Exception as exc:
        logger.error(f"[Calendar] reschedule_event error: {exc}")
        return f"Could not reschedule the event due to an unexpected error: {exc}"


# ---------------------------------------------------------------------------
# Tool builder — wires the above into named FunctionTools for one
# CALENDAR entry from the dashboard.
# ---------------------------------------------------------------------------
def build_calendar_tools(t_cfg: dict, name: str, desc: str) -> list:
    cfg = t_cfg.get("config") or {}
    calendar_id = cfg.get("calendarId") or "primary"
    token = t_cfg.get("apiKey", "")

    tools = []

    async def _schedule(
        summary: Annotated[
            str, Field(description="Brief title of the meeting, e.g. 'Appointment: Manish with Dr. Vikas'")
        ],
        start_time: Annotated[
            str, Field(description="ISO 8601 start datetime with UTC offset, e.g. '2026-06-03T14:30:00+05:30'")
        ],
        duration_mins: Annotated[int, Field(description="Duration in minutes. Defaults to 30.")] = 30,
        description: Annotated[str, Field(description="Optional longer note about the meeting.")] = "",
        attendee_email: Annotated[
            Optional[str], Field(description="Optional attendee email address to invite.")
        ] = None,
    ) -> str:
        """Book a new event on the calendar. Call the matching
        check_availability tool first unless the user has explicitly
        confirmed the time is free."""
        logger.info(f"[CALENDAR] {name}_schedule_event summary={summary} start={start_time}")
        result = await schedule_event(token, calendar_id, summary, start_time, duration_mins, description, attendee_email)
        logger.info(f"[CALENDAR] result={result}")
        return result

    _schedule.__name__ = f"{name}_schedule_event"
    tools.append(function_tool(_schedule, name=f"{name}_schedule_event", description=f"{desc} Books a new event."))

    async def _check(
        start_time: Annotated[str, Field(description="ISO 8601 start of the window to check, with UTC offset.")],
        end_time: Annotated[str, Field(description="ISO 8601 end of the window to check, with UTC offset.")],
    ) -> str:
        """Check whether the calendar has any conflicting events in a time
        window. Call this BEFORE booking whenever the requested time has
        not already been confirmed as free."""
        logger.info(f"[CALENDAR] {name}_check_availability {start_time} - {end_time}")
        return await check_availability(token, calendar_id, start_time, end_time)

    _check.__name__ = f"{name}_check_availability"
    tools.append(function_tool(
        _check, name=f"{name}_check_availability",
        description="Check for scheduling conflicts in a time window before booking.",
    ))

    async def _list(
        time_min: Annotated[str, Field(description="ISO 8601 start of the range to list events in.")],
        time_max: Annotated[str, Field(description="ISO 8601 end of the range to list events in.")],
        max_results: Annotated[int, Field(description="Maximum number of events to return. Defaults to 10.")] = 10,
    ) -> str:
        """List existing events within a date/time range, e.g. to answer
        'what's on my calendar tomorrow'."""
        logger.info(f"[CALENDAR] {name}_list_events {time_min} - {time_max}")
        return await list_events(token, calendar_id, time_min, time_max, max_results)

    _list.__name__ = f"{name}_list_events"
    tools.append(function_tool(
        _list, name=f"{name}_list_events",
        description="List existing events within a date/time range.",
    ))

    async def _cancel(
        summary_hint: Annotated[
            str, Field(description="Title or description of the event to cancel, as the caller referred to it.")
        ],
        near_time: Annotated[
            Optional[str], Field(description="Approximate ISO 8601 time of the event, if known, to disambiguate.")
        ] = None,
    ) -> str:
        """Cancel/delete an existing event, matched by its title and
        approximate time — no raw event ID is needed."""
        logger.info(f"[CALENDAR] {name}_cancel_event summary_hint={summary_hint}")
        return await cancel_event(token, calendar_id, summary_hint, near_time)

    _cancel.__name__ = f"{name}_cancel_event"
    tools.append(function_tool(
        _cancel, name=f"{name}_cancel_event",
        description="Cancel an existing event, found by title/description and approximate time.",
    ))

    async def _reschedule(
        summary_hint: Annotated[str, Field(description="Title of the existing event to move.")],
        new_start_time: Annotated[str, Field(description="New ISO 8601 start time, with UTC offset.")],
        duration_mins: Annotated[int, Field(description="Duration in minutes. Defaults to 30.")] = 30,
        old_start_time_hint: Annotated[
            Optional[str], Field(description="Approximate old ISO 8601 start time, if known, to disambiguate.")
        ] = None,
    ) -> str:
        """Move an existing event to a new time."""
        logger.info(f"[CALENDAR] {name}_reschedule_event summary_hint={summary_hint} new={new_start_time}")
        return await reschedule_event(token, calendar_id, summary_hint, new_start_time, duration_mins, old_start_time_hint)

    _reschedule.__name__ = f"{name}_reschedule_event"
    tools.append(function_tool(
        _reschedule, name=f"{name}_reschedule_event",
        description="Reschedule (move) an existing event to a new time.",
    ))

    return tools