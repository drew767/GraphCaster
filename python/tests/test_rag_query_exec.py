# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from unittest.mock import patch

from graph_caster.rag_query_exec import execute_rag_query


class FakeHttpResponse:
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


def test_execute_rag_query_empty_url() -> None:
    def emit(*_a: object, **_k: object) -> None:
        pass

    ok, out = execute_rag_query(
        node_id="n1",
        graph_id="g1",
        data={"url": "", "query": "q"},
        ctx={},
        emit=emit,
    )
    assert ok is False
    assert out["ragResult"]["error"] == "rag_query_empty_url"


def test_execute_rag_query_empty_query() -> None:
    def emit(*_a: object, **_k: object) -> None:
        pass

    ok, out = execute_rag_query(
        node_id="n1",
        graph_id="g1",
        data={"url": "https://example.test/rag", "query": "   "},
        ctx={},
        emit=emit,
    )
    assert ok is False
    assert out["ragResult"]["error"] == "rag_query_empty_query"


def test_execute_rag_query_post_default_json_success() -> None:
    def emit(*_a: object, **_k: object) -> None:
        pass

    ctx: dict = {}
    body = json.dumps({"hits": [{"id": "1"}]}).encode("utf-8")
    fake = FakeHttpResponse(200, body)

    with patch("graph_caster.http_request_exec.urllib.request.urlopen", return_value=fake):
        ok, out = execute_rag_query(
            node_id="n1",
            graph_id="g1",
            data={"url": "https://example.test/search", "query": "hello", "topK": 3},
            ctx=ctx,
            emit=emit,
        )

    assert ok is True
    assert out["ragResult"]["success"] is True
    assert out["ragResult"]["query"] == "hello"
    assert out["ragResult"]["topK"] == 3
    assert ctx["last_result"]["json"] == {"hits": [{"id": "1"}]}
