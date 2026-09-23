"""
agent/tools/registry.py

Single entry point that turns the `tools` list from the dispatch
metadata blob into a list of livekit FunctionTool objects.

Adding a new native integration means: write a `build_x_tools(t_cfg,
name, desc) -> list[FunctionTool]` function in its own module under
agent/tools/, then register it in `_BUILDERS` below. Nothing else in
the agent needs to change.
"""

import logging
import os
from typing import Any, Dict, List

from livekit.agents import llm

from .google_calendar import build_calendar_tools
from .google_sheets import build_sheets_tools
from .rag import build_rag_tool
from .webhook import build_webhook_tool

logger = logging.getLogger("agent-tools.registry")

_DEFAULT_DESCRIPTIONS = {
    "CALENDAR": "Schedule meetings, appointments, or events on Google Calendar.",
    "SHEETS": "Log data, leads, or notes into a Google Sheets spreadsheet.",
}

# Tool types that expand into MULTIPLE named FunctionTools (return a list).
# Anything not listed here falls through to the generic webhook builder
# (which returns a single tool).
_MULTI_TOOL_BUILDERS = {
    "CALENDAR": build_calendar_tools,
    "SHEETS": build_sheets_tools,
}


def _default_desc(tool_type: str, name: str) -> str:
    return _DEFAULT_DESCRIPTIONS.get(tool_type, f"Execute action: {name}")


def build_tools(config: Dict[str, Any]) -> List[llm.FunctionTool]:
    """
    Converts the `tools` list from the dispatch metadata into a list of
    livekit FunctionTool objects, then appends the RAG search tool if an
    agent_id is present.

    Each tool is built inside its own try/except: a single misconfigured
    tool (bad/null config, missing field, unreachable integration, etc.)
    must never take down the whole job — that would crash the entrypoint
    before the agent ever joins the room, which from the caller's side
    looks like "stuck at connecting" forever with no diagnostic. We'd
    rather run the call with N-1 tools and log the failure loudly.
    """
    tools_cfg: List[Dict[str, Any]] = config.get("tools", [])
    agent_tools: List[llm.FunctionTool] = []

    for t_cfg in tools_cfg:
        if not isinstance(t_cfg, dict):
            logger.warning(f"[Tools] Skipping non-dict tool config: {t_cfg}")
            continue

        raw_name = t_cfg.get("name") or "unknown_tool"
        try:
            raw_type = t_cfg.get("tool_type") or t_cfg.get("type") or "WEBHOOK"
            tool_type = str(raw_type).upper()
            name = str(raw_name).lower().replace(" ", "_")
            desc = (t_cfg.get("description") or "").strip() or _default_desc(tool_type, name)

            builder = _MULTI_TOOL_BUILDERS.get(tool_type)
            if builder is not None:
                built = builder(t_cfg, name, desc)
                agent_tools.extend(built)
                logger.info(f"[Tools] {tool_type} '{name}' expanded into {len(built)} tool(s)")
            else:
                agent_tools.append(build_webhook_tool(t_cfg, name, desc))
        except Exception as exc:
            logger.error(f"[Tools] Failed to build tool '{raw_name}' (config={t_cfg}): {exc}")

    agent_id = config.get("id") or config.get("agentId")
    if agent_id:
        try:
            rag_tool = build_rag_tool(
                agent_id=agent_id,
                backend_url=os.getenv("INTERNAL_BACKEND_URL", "http://localhost:8000"),
            )
            agent_tools.append(rag_tool)
            logger.info(f"[Tools] registered rag_system tool for agent_id={agent_id}")
        except Exception as exc:
            logger.error(f"[Tools] Failed to build rag_system tool: {exc}")

    logger.info(f"[Tools] total registered: {len(agent_tools)}")
    return agent_tools