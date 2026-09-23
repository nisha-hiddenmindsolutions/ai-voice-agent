"""
agent/tools/instructions.py

Builds the tool-usage portion of the agent's system prompt, tailored to
exactly which tools are actually registered for this call.

Written to work across both strong (GPT-4o / Claude / Gemini) and fast,
weaker models (Llama-3 via Groq/Cerebras) since the LLM provider is
user-selected and can change per agent: every rule below is explicit and
concrete rather than relying on the model to infer intent, because
weaker/faster models otherwise either skip tools entirely or call them
speculatively on small talk.
"""

from typing import Any, Dict, List

from livekit.agents import llm

_CALENDAR_SUFFIXES = (
    "_schedule_event", "_check_availability", "_list_events",
    "_cancel_event", "_reschedule_event",
)
_SHEETS_SUFFIXES = ("_append_row", "_read_rows", "_find_row", "_update_row")


def _tool_name(t: llm.FunctionTool) -> str:
    return t.info.name if hasattr(t, "info") else getattr(t, "name", "unknown")


def build_tools_section(config: Dict[str, Any], tools: List[llm.FunctionTool]) -> str:
    if not tools:
        return ""

    names = [_tool_name(t) for t in tools]
    has_rag = "rag_system" in names
    calendar_names = [n for n in names if any(n.endswith(suf) for suf in _CALENDAR_SUFFIXES)]
    sheets_names = [n for n in names if any(n.endswith(suf) for suf in _SHEETS_SUFFIXES)]
    other_names = [n for n in names if n not in calendar_names and n not in sheets_names and n != "rag_system"]

    parts = ["\n\n--- TOOL USE ---"]
    parts.append(
        "You can take real actions using the tools listed below. Follow these rules exactly:\n"
        "1. NEVER say you will do something (book, log, look up, cancel) without actually calling the matching "
        "tool in the same turn — talking about an action is not the same as taking it.\n"
        "2. NEVER call a tool in response to silence, a greeting, or small talk — only when the user's request "
        "actually needs it.\n"
        "3. Recognize intent even if the user speaks a different language than the tool names — still call the "
        "correctly named (English) tool.\n"
        "4. If a tool call fails or returns an error, read the error, explain the problem to the user in plain "
        "language, and either retry once with corrected input or offer an alternative. Never repeat the exact "
        "same failing call more than twice.\n"
        "5. NEVER say a tool's internal name (e.g. 'rag_system', 'calendar_schedule_event') out loud to the user.\n"
        "6. Only call the tools that are actually listed below — never invent a tool name."
    )

    if has_rag:
        parts.append(
            "\nKNOWLEDGE BASE:\n"
            "- Call `rag_system` before answering ANY factual question about services, products, pricing, or "
            "policy — do not answer from memory first.\n"
            "- Base your answer only on what `rag_system` returns. If it returns nothing useful, say you don't "
            "have that information and offer to have someone follow up.\n"
            "- Skip `rag_system` only for pure greetings/acknowledgments."
        )

    if calendar_names:
        parts.append(
            "\nCALENDAR:\n"
            f"- Available calendar tools: {', '.join(calendar_names)}.\n"
            "- Always compute exact dates/times from the CURRENT DATE AND TIME given above — never guess a year "
            "or assume what 'today' is.\n"
            "- All calendar times must be ISO 8601 with a UTC offset, e.g. '2026-05-18T14:30:00+05:30'.\n"
            "- Before booking a time the user has not explicitly reconfirmed as available, call the "
            "`_check_availability` tool first; only call `_schedule_event` once you know the slot is free (or the "
            "user insists anyway).\n"
            "- To cancel or move a meeting, pass the event's title and approximate time exactly as the caller "
            "described it — you do not need a raw event ID.\n"
            "- After a tool call succeeds, confirm the final booked/cancelled/rescheduled time back to the user "
            "in natural speech."
        )

    if sheets_names:
        parts.append(
            "\nSPREADSHEET:\n"
            f"- Available spreadsheet tools: {', '.join(sheets_names)}.\n"
            "- Use `_append_row` to log new information (leads, orders, notes) as a new row.\n"
            "- Use `_find_row` before `_update_row` when modifying an existing entry, so you know the correct "
            "row number.\n"
            "- Use `_read_rows` only when the user is actually asking to hear back existing data — do not read "
            "the whole sheet speculatively."
        )

    if other_names:
        parts.append(
            "\nOTHER TOOLS:\n"
            f"- Available tools: {', '.join(other_names)}.\n"
            "- Call these when the user's request matches what the tool's description says it does. Pass the "
            "real values the user gave you, not placeholders."
        )

    return "\n".join(parts)