# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import socket
from unittest.mock import patch as _mock_patch

import httpx
import pytest

from graph_caster.nodes.api_call import execute_api_call, redact_api_call_data_for_execute


_PUBLIC_IP_ADDRINFO = [
    (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("93.184.216.34", 0))
]


@pytest.fixture(autouse=True)
def _stub_dns_to_public_ip():
    """Existing tests use the ``.test`` TLD which is unresolvable. Pin DNS to
    a public IP so the SSRF perimeter accepts the host."""
    with _mock_patch.object(socket, "getaddrinfo", return_value=_PUBLIC_IP_ADDRINFO):
        yield


def _make_ctx() -> dict:
    return {"node_outputs": {}}


def _emit_capture() -> tuple[list, object]:
    events: list[tuple[str, dict]] = []

    def emit(name: str, **kwargs: object) -> None:
        events.append((name, dict(kwargs)))

    return events, emit


def _mock_transport(status: int, body: bytes | dict, content_type: str = "application/json") -> httpx.MockTransport:
    if isinstance(body, dict):
        body_bytes = json.dumps(body).encode("utf-8")
    else:
        body_bytes = body

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            status_code=status,
            content=body_bytes,
            headers={"Content-Type": content_type},
        )

    return httpx.MockTransport(handler)


def test_get_success_status_and_body_parsed() -> None:
    events, emit = _emit_capture()
    ctx = _make_ctx()
    transport = _mock_transport(200, {"items": [1, 2, 3]})

    ok, patch = execute_api_call(
        node_id="n1",
        graph_id="g1",
        data={"url": "https://api.example.test/items", "method": "GET"},
        ctx=ctx,
        emit=emit,
        transport=transport,
    )

    assert ok is True
    ar = patch["apiCallResult"]
    assert ar["status"] == 200
    assert ar["body"] == {"items": [1, 2, 3]}
    assert ar["elapsed_ms"] >= 0
    names = [e[0] for e in events]
    assert "process_complete" in names
    ev = next(e for e in events if e[0] == "process_complete")
    assert ev[1]["success"] is True


def test_post_json_body_accepted() -> None:
    received_bodies: list[bytes] = []

    def handler(request: httpx.Request) -> httpx.Response:
        received_bodies.append(request.content)
        return httpx.Response(201, content=b'{"created":true}', headers={"Content-Type": "application/json"})

    events, emit = _emit_capture()
    ctx = _make_ctx()
    transport = httpx.MockTransport(handler)

    ok, patch = execute_api_call(
        node_id="n2",
        graph_id="g1",
        data={
            "url": "https://api.example.test/create",
            "method": "POST",
            "body": {"name": "test"},
            "bodyKind": "json",
        },
        ctx=ctx,
        emit=emit,
        transport=transport,
    )

    assert ok is True
    assert json.loads(received_bodies[0]) == {"name": "test"}
    assert patch["apiCallResult"]["status"] == 201


def test_retry_on_5xx_three_retries() -> None:
    call_count = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal call_count
        call_count += 1
        if call_count < 4:
            return httpx.Response(503, content=b"unavailable")
        return httpx.Response(200, content=b'{"ok":true}', headers={"Content-Type": "application/json"})

    events, emit = _emit_capture()
    ctx = _make_ctx()
    transport = httpx.MockTransport(handler)

    ok, patch = execute_api_call(
        node_id="n3",
        graph_id="g1",
        data={
            "url": "https://api.example.test/flaky",
            "method": "GET",
            "retries": 3,
            "retryBackoffSec": 0.0,
        },
        ctx=ctx,
        emit=emit,
        transport=transport,
    )

    assert ok is True
    assert call_count == 4
    retry_events = [e for e in events if e[0] == "api_call_retry"]
    assert len(retry_events) == 3


def test_secret_in_header_masked_in_redact() -> None:
    data = {
        "url": "https://api.example.test/",
        "headers": {
            "Authorization": "Bearer {{ secret.MY_TOKEN }}",
            "X-Other": "plain value",
        },
    }
    redacted = redact_api_call_data_for_execute(data)
    assert redacted["headers"]["Authorization"] == "[redacted]"
    assert redacted["headers"]["X-Other"] == "plain value"


def test_expect_status_200_real_201_error_branch() -> None:
    events, emit = _emit_capture()
    ctx = _make_ctx()
    transport = _mock_transport(201, {"created": True})

    ok, patch = execute_api_call(
        node_id="n4",
        graph_id="g1",
        data={
            "url": "https://api.example.test/item",
            "method": "POST",
            "expectStatus": [200],
        },
        ctx=ctx,
        emit=emit,
        transport=transport,
    )

    assert ok is False
    ar = patch["apiCallResult"]
    assert ar["success"] is False
    assert ar["status"] == 201
    assert "error" in ar
    pr = patch["processResult"]
    assert pr["success"] is False


def test_timeout_emits_error_event() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    events, emit = _emit_capture()
    ctx = _make_ctx()
    transport = httpx.MockTransport(handler)

    ok, patch = execute_api_call(
        node_id="n5",
        graph_id="g1",
        data={
            "url": "https://api.example.test/slow",
            "timeoutSec": 1.0,
        },
        ctx=ctx,
        emit=emit,
        transport=transport,
    )

    assert ok is False
    pr = patch["processResult"]
    assert pr["timedOut"] is True
    names = [e[0] for e in events]
    assert "process_complete" in names
    ev = next(e for e in events if e[0] == "process_complete")
    assert ev[1]["success"] is False
    assert ev[1]["timedOut"] is True


def test_secret_in_header_resolved_and_sent() -> None:
    captured_headers: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured_headers.update(dict(request.headers))
        return httpx.Response(200, content=b'{}', headers={"Content-Type": "application/json"})

    events, emit = _emit_capture()
    ctx = _make_ctx()
    transport = httpx.MockTransport(handler)

    ok, patch = execute_api_call(
        node_id="n6",
        graph_id="g1",
        data={
            "url": "https://api.example.test/secure",
            "headers": {"Authorization": "Bearer {{ secret.MY_TOKEN }}"},
        },
        ctx=ctx,
        emit=emit,
        workspace_secrets={"MY_TOKEN": "super-secret-abc"},
        transport=transport,
    )

    assert ok is True
    assert "super-secret-abc" in captured_headers.get("authorization", "")


def test_missing_url_returns_failure() -> None:
    events, emit = _emit_capture()
    ctx = _make_ctx()

    ok, patch = execute_api_call(
        node_id="n7",
        graph_id="g1",
        data={"url": ""},
        ctx=ctx,
        emit=emit,
    )

    assert ok is False
    assert patch["apiCallResult"]["error"] == "missing_url"
