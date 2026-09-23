"""
agent/tools/google_sheets.py

Google Sheets capabilities exposed to the LLM. A single SHEETS tool
configured in the dashboard now expands into FOUR distinct function tools
instead of "append only":

    {name}_append_row   - log a new row (leads, orders, notes)
    {name}_read_rows     - read back existing data
    {name}_find_row       - locate a row by matching a value in a column
    {name}_update_row     - overwrite a row (typically after find_row)
"""

import logging
import re
import urllib.parse as urlparse
from typing import Annotated, Any, List, Optional, Union

from pydantic import Field

from livekit.agents import function_tool

from .http_client import ToolHTTPError, request_json

logger = logging.getLogger("agent-tools.sheets")

_SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets"


def _auth_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _api_error_message(data: Any) -> str:
    if isinstance(data, dict):
        return data.get("error", {}).get("message", str(data))
    return str(data)[:300]


def _flatten(values: Any) -> List[str]:
    flat: List[str] = []
    if isinstance(values, dict):
        flat = [str(v).strip() for v in values.values()]
    elif isinstance(values, list):
        for item in values:
            if isinstance(item, dict):
                flat.extend(str(v).strip() for v in item.values())
            elif isinstance(item, list):
                flat.extend(str(v).strip() for v in item)
            else:
                flat.append(str(item).strip())
    elif values is not None:
        flat = [str(values).strip()]
    return flat


def _column_letter(n: int) -> str:
    """1 -> A, 26 -> Z, 27 -> AA ..."""
    letters = ""
    while n > 0:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    return letters or "A"


# ---------------------------------------------------------------------------
# Core operations
# ---------------------------------------------------------------------------
async def append_row(token: str, spreadsheet_id: str, range_name: str, values: Any) -> str:
    try:
        flat = _flatten(values)
        if not flat:
            return "Failed: no data values provided."
        encoded_range = urlparse.quote(range_name)
        status, data = await request_json(
            "POST", f"{_SHEETS_BASE}/{spreadsheet_id}/values/{encoded_range}:append",
            headers=_auth_headers(token),
            params={"valueInputOption": "RAW"},
            json_body={"values": [flat]},
        )
        if status < 300:
            return "Logged to spreadsheet successfully."
        return f"Could not log to the spreadsheet: {_api_error_message(data)}"
    except ToolHTTPError as exc:
        return f"Spreadsheet is unreachable right now: {exc}"
    except Exception as exc:
        logger.error(f"[Sheets] append_row error: {exc}")
        return f"Could not log to the spreadsheet due to an unexpected error: {exc}"


async def read_rows(token: str, spreadsheet_id: str, range_name: str, max_rows: int = 20) -> str:
    try:
        encoded_range = urlparse.quote(range_name)
        status, data = await request_json(
            "GET", f"{_SHEETS_BASE}/{spreadsheet_id}/values/{encoded_range}",
            headers=_auth_headers(token),
        )
        if status >= 300:
            return f"Could not read the spreadsheet: {_api_error_message(data)}"
        rows = data.get("values", []) if isinstance(data, dict) else []
        if not rows:
            return f"No data found in range {range_name}."
        lines = [", ".join(str(c) for c in row) for row in rows[:max_rows]]
        return "\n".join(f"Row {i + 1}: {line}" for i, line in enumerate(lines))
    except ToolHTTPError as exc:
        return f"Spreadsheet is unreachable right now: {exc}"
    except Exception as exc:
        logger.error(f"[Sheets] read_rows error: {exc}")
        return f"Could not read the spreadsheet due to an unexpected error: {exc}"


def _normalize_for_match(value: str) -> str:
    """Collapse whitespace/punctuation and lowercase, so 'Cloud Nova',
    'cloudnova', and 'cloud-nova' all normalize the same way. Voice STT
    output frequently drops, merges, or mis-spaces words relative to how
    a name is actually stored in a spreadsheet."""
    value = str(value).strip().lower()
    return re.sub(r"[^a-z0-9]", "", value)


def _similarity(a: str, b: str) -> float:
    """Lightweight similarity ratio (no extra deps) using difflib."""
    import difflib
    return difflib.SequenceMatcher(None, a, b).ratio()


async def find_row(
    token: str, spreadsheet_id: str, range_name: str, search_value: str, search_column_index: int = 0
) -> str:
    try:
        encoded_range = urlparse.quote(range_name)
        status, data = await request_json(
            "GET", f"{_SHEETS_BASE}/{spreadsheet_id}/values/{encoded_range}",
            headers=_auth_headers(token),
        )
        if status >= 300:
            return f"Could not search the spreadsheet: {_api_error_message(data)}"
        rows = data.get("values", []) if isinstance(data, dict) else []
        needle_raw = str(search_value).strip().lower()
        needle_norm = _normalize_for_match(search_value)

        exact_matches = []
        fuzzy_matches = []  # (score, idx, row)

        for idx, row in enumerate(rows):
            if search_column_index >= len(row):
                continue
            cell_raw = str(row[search_column_index]).strip().lower()
            cell_norm = _normalize_for_match(row[search_column_index])

            if cell_raw == needle_raw or cell_norm == needle_norm:
                exact_matches.append((idx, row))
                continue
            if needle_norm and (needle_norm in cell_norm or cell_norm in needle_norm):
                fuzzy_matches.append((0.95, idx, row))
                continue
            score = _similarity(needle_norm, cell_norm)
            if score >= 0.75:
                fuzzy_matches.append((score, idx, row))

        if exact_matches:
            idx, row = exact_matches[0]
            return f"Found at row {idx + 1}: {', '.join(str(c) for c in row)}"

        if fuzzy_matches:
            fuzzy_matches.sort(key=lambda m: m[0], reverse=True)
            score, idx, row = fuzzy_matches[0]
            return (
                f"Found a close match at row {idx + 1}: {', '.join(str(c) for c in row)} "
                f"(matched '{search_value}' approximately — confirm this is correct before updating)."
            )

        return f"No row found matching '{search_value}'."
    except ToolHTTPError as exc:
        return f"Spreadsheet is unreachable right now: {exc}"
    except Exception as exc:
        logger.error(f"[Sheets] find_row error: {exc}")
        return f"Could not search the spreadsheet due to an unexpected error: {exc}"


async def update_row(token: str, spreadsheet_id: str, sheet_tab: str, row_number: int, values: Any) -> str:
    try:
        flat = _flatten(values)
        if not flat:
            return "Failed: no data values provided."
        end_col_letter = _column_letter(len(flat))
        prefix = f"{sheet_tab}!" if sheet_tab else ""
        range_name = f"{prefix}A{row_number}:{end_col_letter}{row_number}"
        encoded_range = urlparse.quote(range_name)
        status, data = await request_json(
            "PUT", f"{_SHEETS_BASE}/{spreadsheet_id}/values/{encoded_range}",
            headers=_auth_headers(token),
            params={"valueInputOption": "RAW"},
            json_body={"values": [flat]},
        )
        if status < 300:
            return f"Row {row_number} updated successfully."
        return f"Could not update row {row_number}: {_api_error_message(data)}"
    except ToolHTTPError as exc:
        return f"Spreadsheet is unreachable right now: {exc}"
    except Exception as exc:
        logger.error(f"[Sheets] update_row error: {exc}")
        return f"Could not update the spreadsheet due to an unexpected error: {exc}"


# ---------------------------------------------------------------------------
# Tool builder — wires the above into named FunctionTools for one
# SHEETS entry from the dashboard.
# ---------------------------------------------------------------------------
def build_sheets_tools(t_cfg: dict, name: str, desc: str) -> list:
    cfg = t_cfg.get("config") or {}
    raw_id = (cfg.get("spreadsheetId") or "").strip()
    match = re.search(r"/spreadsheets/d/([a-zA-Z0-9\-_]+)", raw_id)
    sheet_id = match.group(1) if match else raw_id
    # IMPORTANT: "A1" is a single-CELL reference in Sheets A1-notation, not
    # "the whole tab" — a GET against values/A1 returns only that one cell,
    # which silently broke read_rows/find_row (append_row happened to still
    # work because the :append endpoint finds the real table regardless of
    # the range passed to it). Default to an unbounded range instead so an
    # unconfigured tool actually reads the whole first tab, matching what
    # the dashboard copy promises ("Leave blank to auto-use the first tab").
    # A sheet-less range like "A1:ZZ" targets the first visible tab.
    sheet_range = (cfg.get("range") or "").strip() or "A1:ZZ"
    sheet_tab = sheet_range.split("!")[0] if "!" in sheet_range else ""
    token = t_cfg.get("apiKey", "")

    tools = []

    async def _append(
        # Accept both array and plain-string payloads — smaller/faster
        # LLMs occasionally emit a bare string instead of a JSON array;
        # a schema that only allows `array | null` causes a hard
        # validation error and kills the whole turn.
        data_row: Annotated[
            Union[List[str], str, None],
            Field(description="Values to append as a row, e.g. ['John Doe', 'john@example.com', 'Interested']"),
        ] = None,
        **kwargs: Any,
    ) -> str:
        """Append a new row of data (e.g. a lead or log entry) to the spreadsheet."""
        logger.info(f"[SHEETS] {name}_append_row data_row={data_row} kwargs={kwargs}")
        values: List[Any] = []
        if isinstance(data_row, list):
            values.extend(data_row)
        elif isinstance(data_row, str) and data_row.strip():
            values.append(data_row.strip())
        if kwargs:
            values.extend(kwargs.values())
        if not sheet_id:
            return "Failed: this Sheets tool has no spreadsheet configured."
        result = await append_row(token, sheet_id, sheet_range, values)
        logger.info(f"[SHEETS] result={result}")
        return result

    _append.__name__ = f"{name}_append_row"
    tools.append(function_tool(_append, name=f"{name}_append_row", description=f"{desc} Appends a new row."))

    async def _read(
        max_rows: Annotated[int, Field(description="Maximum number of rows to read back. Defaults to 20.")] = 20,
    ) -> str:
        """Read back existing rows from the connected spreadsheet, e.g. to
        answer questions about logged data."""
        if not sheet_id:
            return "Failed: this Sheets tool has no spreadsheet configured."
        return await read_rows(token, sheet_id, sheet_range, max_rows)

    _read.__name__ = f"{name}_read_rows"
    tools.append(function_tool(
        _read, name=f"{name}_read_rows",
        description="Read back existing rows from the connected spreadsheet.",
    ))

    async def _find(
        search_value: Annotated[str, Field(description="The value to search for, e.g. a name or phone number.")],
        search_column_index: Annotated[
            int, Field(description="0-based column index to search in. Defaults to 0 (first column).")
        ] = 0,
    ) -> str:
        """Find a specific row by matching a value in a column — use this
        before update_row so you know the correct row number."""
        if not sheet_id:
            return "Failed: this Sheets tool has no spreadsheet configured."
        return await find_row(token, sheet_id, sheet_range, search_value, search_column_index)

    _find.__name__ = f"{name}_find_row"
    tools.append(function_tool(
        _find, name=f"{name}_find_row",
        description="Search for a row by matching a value in a specific column.",
    ))

    async def _update(
        row_number: Annotated[
            int, Field(description="The 1-based row number to overwrite, typically from a prior find_row result.")
        ],
        data_row: Annotated[Union[List[str], str], Field(description="The full new set of values for that row.")],
    ) -> str:
        """Overwrite an existing row's values, e.g. to update a lead's status."""
        if not sheet_id:
            return "Failed: this Sheets tool has no spreadsheet configured."
        return await update_row(token, sheet_id, sheet_tab, row_number, data_row)

    _update.__name__ = f"{name}_update_row"
    tools.append(function_tool(
        _update, name=f"{name}_update_row",
        description="Overwrite an existing row's values by row number.",
    ))

    return tools