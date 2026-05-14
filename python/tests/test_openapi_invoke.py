# Copyright GraphCaster. All Rights Reserved.

"""Tests for invoke_openapi_tool — URL composition, auth injection, error handling."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from graph_caster.tools.openapi_import import (
    AuthSpec,
    OpenAPIToolSpec,
    invoke_openapi_tool,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_spec(
    *,
    method: str = "GET",
    path: str = "/pets",
    base_url: str = "https://api.example.com",
    parameters: list[dict] | None = None,
    request_body: dict | None = None,
    auth: AuthSpec | None = None,
) -> OpenAPIToolSpec:
    return OpenAPIToolSpec(
        name="testOp",
        summary="Test operation",
        description="Test",
        method=method,
        path=path,
        base_url=base_url,
        parameters=parameters or [],
        request_body=request_body,
        response_schema=None,
        auth=auth or AuthSpec(kind="none"),
        raw_operation={},
    )


def _make_mock_transport(status: int, body: dict | str, content_type: str = "application/json"):
    """Return an httpx.MockTransport that always returns the given status+body."""
    if isinstance(body, dict):
        body_bytes = json.dumps(body).encode("utf-8")
    else:
        body_bytes = body.encode("utf-8") if isinstance(body, str) else body

    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code=status,
            content=body_bytes,
            headers={"Content-Type": content_type},
        )

    return httpx.MockTransport(_handler)


class _FakeSecretsResolver:
    def __init__(self, mapping: dict[str, str]) -> None:
        self._mapping = mapping

    def as_mapping(self) -> dict[str, str]:
        return dict(self._mapping)


# Helper to run async functions from sync tests
def _run(coro):
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# URL composition
# ---------------------------------------------------------------------------


def test_invoke_simple_get_url_composed() -> None:
    spec = _make_spec(
        method="GET",
        path="/pets",
        base_url="https://api.example.com",
        parameters=[{"name": "limit", "in": "query", "required": False}],
    )
    captured: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        captured.append(req)
        return httpx.Response(200, content=b"[]", headers={"Content-Type": "application/json"})

    transport = httpx.MockTransport(handler)
    result = _run(invoke_openapi_tool(
        spec, {"limit": "10"}, secrets_resolver=None, transport=transport
    ))
    assert result["status"] == 200
    assert len(captured) == 1
    assert "limit=10" in str(captured[0].url)


def test_invoke_path_params_interpolated() -> None:
    spec = _make_spec(
        method="GET",
        path="/pets/{petId}",
        parameters=[{"name": "petId", "in": "path", "required": True}],
    )
    captured: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        captured.append(req)
        return httpx.Response(200, content=b"{}", headers={"Content-Type": "application/json"})

    transport = httpx.MockTransport(handler)
    result = _run(invoke_openapi_tool(
        spec, {"petId": "42"}, secrets_resolver=None, transport=transport
    ))
    assert result["status"] == 200
    url_str = str(captured[0].url)
    assert "/pets/42" in url_str
    # petId must NOT appear in query string
    assert "petId" not in url_str.split("?")[-1] if "?" in url_str else True


def test_invoke_post_body_serialized() -> None:
    spec = _make_spec(
        method="POST",
        path="/pets",
        request_body={
            "required": True,
            "content_type": "application/json",
            "schema": {"type": "object"},
        },
    )
    captured: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        captured.append(req)
        return httpx.Response(201, content=b"{}", headers={"Content-Type": "application/json"})

    transport = httpx.MockTransport(handler)
    result = _run(invoke_openapi_tool(
        spec,
        {"body": {"name": "Fido", "tag": "dog"}},
        secrets_resolver=None,
        transport=transport,
    ))
    assert result["status"] == 201
    req = captured[0]
    sent = json.loads(req.content)
    assert sent["name"] == "Fido"
    assert "application/json" in req.headers.get("content-type", "")


def test_invoke_returns_parsed_json_body() -> None:
    spec = _make_spec()
    transport = _make_mock_transport(200, {"pets": [{"id": 1, "name": "Fido"}]})
    result = _run(invoke_openapi_tool(spec, {}, secrets_resolver=None, transport=transport))
    assert result["body"]["pets"][0]["name"] == "Fido"


def test_invoke_returns_text_body_for_non_json() -> None:
    spec = _make_spec()
    transport = _make_mock_transport(200, "hello world", content_type="text/plain")
    result = _run(invoke_openapi_tool(spec, {}, secrets_resolver=None, transport=transport))
    assert result["body"] == "hello world"


# ---------------------------------------------------------------------------
# Auth injection
# ---------------------------------------------------------------------------


def test_auth_bearer_injected_from_secrets() -> None:
    spec = _make_spec(
        auth=AuthSpec(kind="bearer", location="header", name="Authorization", env_var="MY_TOKEN")
    )
    captured: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        captured.append(req)
        return httpx.Response(200, content=b"{}", headers={"Content-Type": "application/json"})

    transport = httpx.MockTransport(handler)
    resolver = _FakeSecretsResolver({"MY_TOKEN": "secret-token-abc"})
    _run(invoke_openapi_tool(spec, {}, secrets_resolver=resolver, transport=transport))
    assert captured[0].headers.get("authorization") == "Bearer secret-token-abc"


def test_auth_api_key_header_injected() -> None:
    spec = _make_spec(
        auth=AuthSpec(kind="api_key", location="header", name="X-API-Key", env_var="API_KEY_VAR")
    )
    captured: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        captured.append(req)
        return httpx.Response(200, content=b"{}", headers={"Content-Type": "application/json"})

    transport = httpx.MockTransport(handler)
    resolver = _FakeSecretsResolver({"API_KEY_VAR": "my-api-key"})
    _run(invoke_openapi_tool(spec, {}, secrets_resolver=resolver, transport=transport))
    assert captured[0].headers.get("x-api-key") == "my-api-key"


def test_auth_api_key_query_injected() -> None:
    spec = _make_spec(
        auth=AuthSpec(kind="api_key", location="query", name="api_key", env_var="API_KEY_VAR")
    )
    captured: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        captured.append(req)
        return httpx.Response(200, content=b"{}", headers={"Content-Type": "application/json"})

    transport = httpx.MockTransport(handler)
    resolver = _FakeSecretsResolver({"API_KEY_VAR": "qkey123"})
    _run(invoke_openapi_tool(spec, {}, secrets_resolver=resolver, transport=transport))
    assert "api_key=qkey123" in str(captured[0].url)


def test_auth_basic_header_injected() -> None:
    import base64

    spec = _make_spec(
        auth=AuthSpec(kind="basic", location="header", name="Authorization", env_var="BASIC_CREDS")
    )
    captured: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        captured.append(req)
        return httpx.Response(200, content=b"{}", headers={"Content-Type": "application/json"})

    transport = httpx.MockTransport(handler)
    resolver = _FakeSecretsResolver({"BASIC_CREDS": "user:password"})
    _run(invoke_openapi_tool(spec, {}, secrets_resolver=resolver, transport=transport))
    expected = "Basic " + base64.b64encode(b"user:password").decode()
    assert captured[0].headers.get("authorization") == expected


# ---------------------------------------------------------------------------
# Validation — missing required params
# ---------------------------------------------------------------------------


def test_missing_required_param_raises_value_error() -> None:
    spec = _make_spec(
        method="GET",
        path="/pets/{petId}",
        parameters=[{"name": "petId", "in": "path", "required": True}],
    )
    with pytest.raises(ValueError, match="petId"):
        _run(invoke_openapi_tool(spec, {}, secrets_resolver=None))


def test_missing_required_body_raises_value_error() -> None:
    spec = _make_spec(
        method="POST",
        path="/pets",
        request_body={"required": True, "content_type": "application/json", "schema": {}},
    )
    # "body" key is missing from arguments and no schema properties to pull from
    with pytest.raises(ValueError, match="body"):
        _run(invoke_openapi_tool(spec, {}, secrets_resolver=None))


# ---------------------------------------------------------------------------
# 4xx response handling
# ---------------------------------------------------------------------------


def test_4xx_returned_by_default() -> None:
    spec = _make_spec()
    transport = _make_mock_transport(404, {"error": "not found"})
    result = _run(invoke_openapi_tool(spec, {}, secrets_resolver=None, transport=transport))
    assert result["status"] == 404
    assert result["body"]["error"] == "not found"


def test_4xx_raised_when_configured() -> None:
    spec = _make_spec()
    transport = _make_mock_transport(403, {"error": "forbidden"})
    with pytest.raises(ValueError, match="403"):
        _run(invoke_openapi_tool(
            spec, {}, secrets_resolver=None, transport=transport, raise_on_4xx=True
        ))


# ---------------------------------------------------------------------------
# Response headers returned
# ---------------------------------------------------------------------------


def test_response_headers_returned() -> None:
    spec = _make_spec()

    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=b"{}",
            headers={"Content-Type": "application/json", "X-Custom": "hello"},
        )

    transport = httpx.MockTransport(handler)
    result = _run(invoke_openapi_tool(spec, {}, secrets_resolver=None, transport=transport))
    headers_lower = {k.lower(): v for k, v in result["headers"].items()}
    assert "x-custom" in headers_lower
    assert headers_lower["x-custom"] == "hello"
