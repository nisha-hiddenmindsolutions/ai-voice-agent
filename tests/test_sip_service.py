import pytest
import httpx
import importlib.util
from pathlib import Path

MODULE_PATH = (
    Path(__file__).resolve().parents[1]
    / "backend"
    / "app"
    / "services"
    / "livekit_http.py"
)
spec = importlib.util.spec_from_file_location("livekit_http", MODULE_PATH)
livekit_http = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(livekit_http)
parse_livekit_json_response = livekit_http.parse_livekit_json_response


def test_normalize_e164_strips_spaces():
    module_path = (
        Path(__file__).resolve().parents[1]
        / "backend"
        / "app"
        / "services"
        / "sip_service.py"
    )
    spec = importlib.util.spec_from_file_location("sip_service", module_path)
    sip_service_mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(sip_service_mod)
    assert sip_service_mod.normalize_e164("+91 8290406024") == "+918290406024"


def test_parse_livekit_response_allows_blank_success_body():
    resp = httpx.Response(200, text="   ")

    assert parse_livekit_json_response(resp, "Agent dispatch") == {}


def test_parse_livekit_response_allows_plain_ok_success_body():
    resp = httpx.Response(200, text="OK")

    assert parse_livekit_json_response(resp, "Agent dispatch") == {}


def test_parse_livekit_response_rejects_non_json_success_body():
    resp = httpx.Response(200, text="<html>temporarily unavailable</html>")

    with pytest.raises(RuntimeError) as exc_info:
        parse_livekit_json_response(resp, "SIP participant creation")

    assert "non-JSON response" in str(exc_info.value)
    assert "temporarily unavailable" in str(exc_info.value)


def test_parse_livekit_response_reports_empty_error_body():
    resp = httpx.Response(502, text="")

    with pytest.raises(RuntimeError) as exc_info:
        parse_livekit_json_response(resp, "SIP participant creation")

    assert "SIP participant creation failed [502]: <empty response>" == str(
        exc_info.value
    )
