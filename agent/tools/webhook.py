"""
agent/tools/webhook.py

Generic HTTP tool for connecting any external API / n8n workflow / REST
endpoint. This is the "advanced" version of the old webhook tool:

Before: every custom tool got exactly ONE argument — a free-text
`query: str` — no matter what the underlying API actually expected. The
LLM had to cram structured data ("book John for 2pm Tuesday, table for
4") into one string and hope the receiving webhook could parse it back
out.

Now: if the tool is configured with a `parameters` schema (a list of
named, typed fields — see `_json_schema_from_params`), the LLM is given
a real structured tool signature (proper types, required fields, enums)
built from a raw JSON schema, and calls it exactly like any native tool.
Tools created before this existed (no `parameters` in their config) keep
working unchanged via the legacy single `query` argument.

Example `config.parameters` for a "book_table" webhook tool:
    [
      {"name": "party_size", "type": "integer", "description": "Number of guests", "required": true},
      {"name": "time", "type": "string", "description": "Requested time, ISO 8601", "required": true},
      {"name": "notes", "type": "string", "description": "Special requests", "required": false}
    ]
"""

import json as _json
import logging
import urllib.parse as urlparse
from typing import Annotated, Any

from pydantic import Field

from livekit.agents import function_tool

from .http_client import ToolHTTPError, request_json

logger = logging.getLogger("agent-tools.webhook")

_TYPE_MAP = {
    "string": "string", "str": "string", "text": "string",
    "integer": "integer", "int": "integer",
    "number": "number", "float": "number",
    "boolean": "boolean", "bool": "boolean",
    "array": "array", "list": "array",
    "object": "object",
}


def _json_schema_from_params(params: list) -> dict:
    properties: dict[str, Any] = {}
    required: list[str] = []
    for p in params:
        if not isinstance(p, dict):
            continue
        pname = str(p.get("name") or "").strip()
        if not pname:
            continue
        prop: dict[str, Any] = {
            "type": _TYPE_MAP.get(str(p.get("type", "string")).lower(), "string"),
            "description": p.get("description") or f"The {pname} parameter.",
        }
        if p.get("enum"):
            prop["enum"] = p["enum"]
        if prop["type"] == "array":
            prop["items"] = {"type": _TYPE_MAP.get(str(p.get("items_type", "string")).lower(), "string")}
        properties[pname] = prop
        if p.get("required"):
            required.append(pname)
    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


def _build_headers(t_cfg: dict) -> dict:
    headers = dict(t_cfg.get("headers") or {})
    api_key = t_cfg.get("apiKey")
    if api_key and isinstance(api_key, str):
        if api_key.startswith("Bearer ") or len(api_key) > 40:
            headers.setdefault("Authorization", api_key if api_key.startswith("Bearer ") else f"Bearer {api_key}")
        else:
            headers.setdefault("X-API-Key", api_key)
    return headers


def _fill_template(template: str, args: dict) -> Any:
    tmpl = template
    for k, v in args.items():
        tmpl = tmpl.replace(f"{{{{{k}}}}}", str(v))
    try:
        return _json.loads(tmpl)
    except Exception:
        return tmpl


async def _execute_structured(t_cfg: dict, args: dict) -> str:
    url = t_cfg.get("url") or ""
    if not url:
        return "Failed: this tool has no URL configured."
    method = (t_cfg.get("method") or "POST").upper()
    static_config = {k: v for k, v in (t_cfg.get("config") or {}).items() if k != "parameters"}

    body_template = t_cfg.get("body_template")
    if body_template:
        payload = _fill_template(body_template, {**static_config, **args})
    else:
        payload = {**static_config, **args}

    headers = _build_headers(t_cfg)
    query_params = {**static_config, **args} if method == "GET" else None

    try:
        status, data = await request_json(
            method, url,
            headers=headers,
            json_body=payload if method != "GET" else None,
            params=query_params,
            timeout=10.0,
            retries=2,
        )
        if status >= 400:
            return f"The tool returned an error (status {status}): {str(data)[:300]}"
        return str(data)[:1500]
    except ToolHTTPError as exc:
        return f"This tool is unreachable right now: {exc}"
    except Exception as exc:
        logger.error(f"[Webhook] {url} unexpected error: {exc}")
        return f"This tool failed unexpectedly: {exc}"


async def _execute_legacy(t_cfg: dict, query: str) -> str:
    """Preserves the exact behavior of the original single-`query` webhook
    tool, for any tool saved before structured `parameters` existed."""
    url = t_cfg.get("url") or ""
    if not url:
        return "Failed: this tool has no URL configured."
    method = (t_cfg.get("method") or "POST").upper()
    config = {k: v for k, v in (t_cfg.get("config") or {}).items() if k != "parameters"}

    payload: Any = {"query": query, **config}
    body_template = t_cfg.get("body_template")
    if body_template:
        try:
            tmpl = body_template.replace("{{query}}", query).replace("{{input}}", query)
            for k, v in config.items():
                tmpl = tmpl.replace(f"{{{{{k}}}}}", str(v))
            payload = _json.loads(tmpl)
        except Exception as exc:
            logger.warning(f"Body template parse failed for {url}: {exc}")

    headers = _build_headers(t_cfg)

    url_parts = list(urlparse.urlparse(url))
    qp = dict(urlparse.parse_qsl(url_parts[4]))
    if method == "GET" and not qp.get("q") and not qp.get("query"):
        qp["q"] = query
    url_parts[4] = urlparse.urlencode(qp)
    final_url = urlparse.urlunparse(url_parts)

    try:
        status, data = await request_json(
            method, final_url,
            headers=headers,
            json_body=payload if method != "GET" else None,
            timeout=8.0,
            retries=2,
        )
        if status >= 400:
            return f"The tool returned an error (status {status})."
        return str(data)[:1000]
    except ToolHTTPError as exc:
        return f"This tool is unreachable right now: {exc}"
    except Exception as exc:
        logger.error(f"[Webhook] {final_url} unexpected error: {exc}")
        return f"This tool failed unexpectedly: {exc}"


def build_webhook_tool(t_cfg: dict, name: str, desc: str):
    """
    Builds a webhook FunctionTool. Uses a real structured argument schema
    when the tool config defines `parameters`; otherwise falls back to the
    legacy single free-text `query` argument.
    """
    cfg = t_cfg.get("config") or {}
    params = cfg.get("parameters")

    if isinstance(params, list) and params:
        schema = _json_schema_from_params(params)

        async def _fn(raw_arguments: dict) -> str:
            logger.info(f"[WEBHOOK] tool={name} args={raw_arguments}")
            result = await _execute_structured(t_cfg, raw_arguments or {})
            logger.info(f"[WEBHOOK] result={result[:200]}")
            return result

        return function_tool(
            _fn,
            raw_schema={"name": name, "description": desc, "parameters": schema},
        )

    async def _legacy_fn(
        query: Annotated[str, Field(description="The search query or action command to send.")],
    ) -> str:
        """Send a query or command to an external service."""
        logger.info(f"[WEBHOOK] tool={name} query={query}")
        result = await _execute_legacy(t_cfg, query)
        logger.info(f"[WEBHOOK] result={result[:200]}")
        return result

    _legacy_fn.__name__ = name
    return function_tool(_legacy_fn, name=name, description=desc)