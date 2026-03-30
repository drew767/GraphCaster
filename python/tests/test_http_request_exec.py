# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from unittest.mock import patch

from graph_caster.http_request_exec import execute_http_request


class FakeHttpResponse:
    """Minimal stand-in for the object returned by ``urlopen`` (context manager + read)."""

    def __init__(self, status: int, body: bytes, headers: dict[str, str] | None = None) -> None:
        self.status = status
        self.headers = headers or {"Content-Type": "application/json"}
        self._body = body

    def read(self, n: int = -1) -> bytes:
        if n < 0:
            return self._body
        return self._body[:n]

    def __enter__(self) -> FakeHttpResponse:
        return self

    def __exit__(self, *args: object) -> None:
        return None


def test_execute_http_request_get_success_sets_last_result_and_process_complete() -> None:
    emitted: list[tuple[str, dict]] = []

    def emit(name: str, **kwargs: object) -> None:
        emitted.append((name, kwargs))

    ctx: dict = {}
    body = json.dumps({"ok": True}).encode("utf-8")
    fake = FakeHttpResponse(200, body)

    with patch("graph_caster.http_request_exec.urllib.request.urlopen", return_value=fake):
        ok, out = execute_http_request(
            node_id="n1",
            graph_id="g1",
            data={"url": "https://example.test/api", "method": "GET"},
            ctx=ctx,
            emit=lambda *a, **k: emit(*a, **k),
        )

    assert ok is True
    assert out["processResult"]["success"] is True
    assert out["httpResult"]["statusCode"] == 200
    assert ctx["last_result"]["ok"] is True
    assert ctx["last_result"]["json"] == {"ok": True}
    names = [x[0] for x in emitted]
    assert "process_complete" in names


def test_execute_http_request_missing_url_is_not_success() -> None:
    emitted: list[tuple[str, dict]] = []

    def emit(name: str, **kwargs: object) -> None:
        emitted.append((name, kwargs))

    ctx: dict = {}
    ok, out = execute_http_request(
        node_id="n1",
        graph_id="g1",
        data={"url": ""},
        ctx=ctx,
        emit=lambda *a, **k: emit(*a, **k),
    )
    assert ok is False
    assert out["processResult"]["success"] is False
    assert any(n == "process_complete" for n, _ in emitted)
