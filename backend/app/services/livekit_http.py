import json

import httpx


def parse_livekit_json_response(resp: httpx.Response, operation: str) -> dict:
    body = resp.text.strip()
    if resp.status_code not in (200, 201):
        detail = body or "<empty response>"
        raise RuntimeError(f"{operation} failed [{resp.status_code}]: {detail}")

    if not body:
        return {}

    # LiveKit Twirp endpoints sometimes return a plain "OK" for empty protobuf messages.
    if body.upper() == "OK":
        return {}

    try:
        return resp.json()
    except json.JSONDecodeError as exc:
        snippet = body[:500]
        raise RuntimeError(
            f"{operation} returned a non-JSON response [{resp.status_code}]: {snippet}"
        ) from exc
