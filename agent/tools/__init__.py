"""
agent/tools/ — the agent's tool system.

Public API used by factory.py:

    from tools import build_tools, build_tools_section

    tools = build_tools(config)                        # list[FunctionTool]
    section = build_tools_section(config, tools)        # str, appended to instructions

Layout:
    http_client.py      - shared HTTP helper (retries/backoff) used by every tool
    registry.py          - dispatches each configured tool to the right builder
    google_calendar.py   - Calendar: schedule / check availability / list / cancel / reschedule
    google_sheets.py     - Sheets: append / read / find / update
    webhook.py            - generic HTTP tool, structured parameters or legacy single-query
    rag.py                - knowledge base search tool
    instructions.py       - builds the tool-usage section of the system prompt

To add a new native integration (e.g. Gmail, Slack, a CRM):
    1. Create agent/tools/your_service.py with a `build_your_service_tools(t_cfg, name, desc) -> list`
       function, following the pattern in google_calendar.py / google_sheets.py.
    2. Register it in registry.py's `_MULTI_TOOL_BUILDERS` dict under its tool_type string.
    3. (Optional) Add a section to instructions.py's `build_tools_section` so the LLM gets
       explicit usage guidance for it.
"""

from .instructions import build_tools_section
from .registry import build_tools

__all__ = ["build_tools", "build_tools_section"]