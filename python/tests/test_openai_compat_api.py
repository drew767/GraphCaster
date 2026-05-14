# Copyright GraphCaster. All Rights Reserved.

"""Tests for F88 — OpenAI-compatible API layer.

Uses the Starlette TestClient pattern matching test_api_v1.py.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient
from starlette.applications import Starlette

from graph_caster.run_broker.auth.api_key import APIKey, APIKeyAuthenticator
from graph_caster.run_broker.openai_compat import (
    _parse_model,
    _extract_user_query,
    _extract_content_from_outputs,
    make_openai_compat_routes,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class MockRunManager:
    """Minimal async run-manager stub."""

    def __init__(
        self,
        *,
        graph_ids: list[str] | None = None,
        run_content: str = "Hello from graph",
        raise_not_found: bool = False,
        raise_permission: bool = False,
        outputs: dict[str, Any] | None = None,
    ) -> None:
        self._graph_ids: set[str] = set(graph_ids or ["graph-alpha", "graph-beta"])
        self._run_content = run_content
        self._raise_not_found = raise_not_found
        self._raise_permission = raise_permission
        self._outputs = outputs
        self.calls: list[dict[str, Any]] = []

    async def start_run(
        self,
        graph_id: str,
        context: dict[str, Any] | None = None,
        trigger_context: dict[str, Any] | None = None,
    ) -> str:
        if self._raise_permission:
            raise PermissionError("Access denied")
        if self._raise_not_found or graph_id not in self._graph_ids:
            raise FileNotFoundError(f"Graph not found: {graph_id}")
        self.calls.append({"graph_id": graph_id, "context": context})
        return f"run-{graph_id}-001"

    async def wait_for_run(self, run_id: str, timeout: float = 300.0) -> dict[str, Any]:
        if self._outputs is not None:
            return {"status": "success", "outputs": self._outputs}
        return {
            "status": "success",
            "outputs": {"content": self._run_content},
        }

    async def get_run_status(self, run_id: str) -> dict[str, Any] | None:
        return {"run_id": run_id, "status": "success", "graph_id": "unknown"}

    async def cancel_run(self, run_id: str) -> dict[str, Any]:
        return {"cancelled": True}

    async def get_run_events_ndjson(self, run_id: str, max_bytes: int) -> tuple[str, bool] | None:
        return "", False


def _make_app(
    run_manager: MockRunManager,
    auth: APIKeyAuthenticator | None = None,
) -> Starlette:
    routes = make_openai_compat_routes(run_manager, auth=auth)
    return Starlette(routes=routes)


def _make_auth_with_scope(*scopes: str) -> tuple[APIKeyAuthenticator, str]:
    """Return (auth, header) for a key with given scopes."""
    auth = APIKeyAuthenticator()
    auth.register_key("gc_test", "secret123", "test-key", list(scopes))
    return auth, "Bearer gc_test:secret123"


# ---------------------------------------------------------------------------
# Unit-level helpers
# ---------------------------------------------------------------------------

class TestParseModel:
    def test_simple(self) -> None:
        gid, ver = _parse_model("gc-graph:my-graph")
        assert gid == "my-graph"
        assert ver is None

    def test_with_version(self) -> None:
        gid, ver = _parse_model("gc-graph:my-graph@v3")
        assert gid == "my-graph"
        assert ver == 3

    def test_bad_prefix(self) -> None:
        with pytest.raises(ValueError, match="gc-graph:"):
            _parse_model("gpt-4o")

    def test_bad_version(self) -> None:
        with pytest.raises(ValueError, match="integer"):
            _parse_model("gc-graph:g1@vabc")


class TestExtractUserQuery:
    def test_last_user_message(self) -> None:
        msgs = [
            {"role": "system", "content": "You are helpful."},
            {"role": "user", "content": "First question"},
            {"role": "assistant", "content": "Answer"},
            {"role": "user", "content": "Second question"},
        ]
        assert _extract_user_query(msgs) == "Second question"

    def test_no_user_message(self) -> None:
        msgs = [{"role": "system", "content": "sys"}]
        assert _extract_user_query(msgs) == ""

    def test_vision_content_list(self) -> None:
        msgs = [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]
        assert _extract_user_query(msgs) == "hi"


class TestExtractContent:
    def test_direct_content(self) -> None:
        assert _extract_content_from_outputs({"content": "hello"}) == "hello"

    def test_nested_content(self) -> None:
        assert _extract_content_from_outputs({"exit": {"content": "nested"}}) == "nested"

    def test_fallback_json(self) -> None:
        out = {"key": "value"}
        result = _extract_content_from_outputs(out)
        assert "key" in result

    def test_empty(self) -> None:
        assert _extract_content_from_outputs({}) == ""

    def test_non_dict(self) -> None:
        assert _extract_content_from_outputs("plain string") == "plain string"


# ---------------------------------------------------------------------------
# HTTP — chat/completions (non-streaming)
# ---------------------------------------------------------------------------

class TestChatCompletions:
    def test_basic_completion_returns_openai_shape(self) -> None:
        mgr = MockRunManager(run_content="Graph says hi")
        app = _make_app(mgr)
        with TestClient(app, raise_server_exceptions=True) as client:
            resp = client.post(
                "/api/v1/openai/chat/completions",
                json={
                    "model": "gc-graph:graph-alpha",
                    "messages": [{"role": "user", "content": "hello"}],
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["object"] == "chat.completion"
        assert body["id"].startswith("chatcmpl-")
        assert body["choices"][0]["message"]["role"] == "assistant"
        assert body["choices"][0]["message"]["content"] == "Graph says hi"
        assert body["choices"][0]["finish_reason"] == "stop"
        assert "usage" in body
        assert body["model"] == "gc-graph:graph-alpha"

    def test_missing_model_returns_400(self) -> None:
        mgr = MockRunManager()
        app = _make_app(mgr)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/openai/chat/completions",
                json={"messages": [{"role": "user", "content": "hi"}]},
            )
        assert resp.status_code == 400

    def test_invalid_model_prefix_returns_400(self) -> None:
        mgr = MockRunManager()
        app = _make_app(mgr)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/openai/chat/completions",
                json={"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]},
            )
        assert resp.status_code == 400

    def test_graph_not_found_returns_404(self) -> None:
        mgr = MockRunManager(graph_ids=["graph-alpha"])
        app = _make_app(mgr)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/openai/chat/completions",
                json={
                    "model": "gc-graph:no-such-graph",
                    "messages": [{"role": "user", "content": "hi"}],
                },
            )
        assert resp.status_code == 404

    def test_session_id_forwarded_to_context(self) -> None:
        mgr = MockRunManager()
        app = _make_app(mgr)
        with TestClient(app) as client:
            client.post(
                "/api/v1/openai/chat/completions",
                json={
                    "model": "gc-graph:graph-alpha",
                    "messages": [{"role": "user", "content": "hi"}],
                    "session_id": "sess-abc",
                },
            )
        assert mgr.calls[0]["context"]["session_id"] == "sess-abc"

    def test_metadata_forwarded_to_context(self) -> None:
        mgr = MockRunManager()
        app = _make_app(mgr)
        with TestClient(app) as client:
            client.post(
                "/api/v1/openai/chat/completions",
                json={
                    "model": "gc-graph:graph-alpha",
                    "messages": [{"role": "user", "content": "hi"}],
                    "metadata": {"user_id": "u1"},
                },
            )
        assert mgr.calls[0]["context"]["metadata"] == {"user_id": "u1"}

    def test_version_in_model_string(self) -> None:
        mgr = MockRunManager()
        app = _make_app(mgr)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/openai/chat/completions",
                json={
                    "model": "gc-graph:graph-alpha@v2",
                    "messages": [{"role": "user", "content": "hi"}],
                },
            )
        assert resp.status_code == 200
        assert mgr.calls[0]["context"]["graph_version"] == 2

    def test_invalid_json_body_returns_400(self) -> None:
        mgr = MockRunManager()
        app = _make_app(mgr)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/openai/chat/completions",
                content=b"not-json",
                headers={"content-type": "application/json"},
            )
        assert resp.status_code == 400


# ---------------------------------------------------------------------------
# HTTP — streaming
# ---------------------------------------------------------------------------

class TestChatCompletionsStreaming:
    def test_streaming_returns_sse_with_done_terminator(self) -> None:
        mgr = MockRunManager(run_content="Hello world")
        app = _make_app(mgr)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/openai/chat/completions",
                json={
                    "model": "gc-graph:graph-alpha",
                    "messages": [{"role": "user", "content": "hi"}],
                    "stream": True,
                },
            )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")
        raw = resp.text
        assert "data: [DONE]" in raw
        # Should have at least one chunk with content
        chunks = [
            line[len("data: "):].strip()
            for line in raw.splitlines()
            if line.startswith("data: ") and not line.strip() == "data: [DONE]"
        ]
        assert len(chunks) > 0
        parsed = json.loads(chunks[0])
        assert parsed["object"] == "chat.completion.chunk"
        assert parsed["id"].startswith("chatcmpl-")

    def test_streaming_has_role_delta_first(self) -> None:
        mgr = MockRunManager(run_content="hi")
        app = _make_app(mgr)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/openai/chat/completions",
                json={
                    "model": "gc-graph:graph-alpha",
                    "messages": [{"role": "user", "content": "hi"}],
                    "stream": True,
                },
            )
        raw = resp.text
        chunks = [
            line[len("data: "):].strip()
            for line in raw.splitlines()
            if line.startswith("data: ") and not line.strip() == "data: [DONE]"
        ]
        first = json.loads(chunks[0])
        assert first["choices"][0]["delta"].get("role") == "assistant"

    def test_streaming_last_chunk_has_stop_finish_reason(self) -> None:
        mgr = MockRunManager(run_content="hi")
        app = _make_app(mgr)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/openai/chat/completions",
                json={
                    "model": "gc-graph:graph-alpha",
                    "messages": [{"role": "user", "content": "hi"}],
                    "stream": True,
                },
            )
        raw = resp.text
        data_lines = [
            line[len("data: "):]
            for line in raw.splitlines()
            if line.startswith("data: ") and line.strip() != "data: [DONE]"
        ]
        last_chunk = json.loads(data_lines[-1])
        assert last_chunk["choices"][0]["finish_reason"] == "stop"


# ---------------------------------------------------------------------------
# HTTP — models listing
# ---------------------------------------------------------------------------

class TestModels:
    def test_get_models_returns_list_shape(self, tmp_path, monkeypatch) -> None:
        graphs_dir = tmp_path / "graphs"
        graphs_dir.mkdir()
        for gid in ("graph-x", "graph-y"):
            doc = {
                "schemaVersion": 1,
                "meta": {"graphId": gid, "schemaVersion": 1, "title": gid},
                "viewport": {"x": 0, "y": 0, "zoom": 1},
                "nodes": [],
                "edges": [],
            }
            (graphs_dir / f"{gid}.json").write_text(json.dumps(doc), encoding="utf-8")
        monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(graphs_dir))
        mgr = MockRunManager()
        app = _make_app(mgr)
        with TestClient(app) as client:
            resp = client.get("/api/v1/openai/models")
        assert resp.status_code == 200
        body = resp.json()
        assert body["object"] == "list"
        ids = [m["id"] for m in body["data"]]
        assert "gc-graph:graph-x" in ids
        assert "gc-graph:graph-y" in ids
        for m in body["data"]:
            assert m["owned_by"] == "graphcaster"
            assert m["object"] == "model"

    def test_get_models_empty_when_no_graphs_dir(self, monkeypatch) -> None:
        monkeypatch.delenv("GC_RUN_BROKER_GRAPHS_DIR", raising=False)
        mgr = MockRunManager()
        app = _make_app(mgr)
        with TestClient(app) as client:
            resp = client.get("/api/v1/openai/models")
        assert resp.status_code == 200
        assert resp.json()["data"] == []


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

class TestOpenAICompatAuth:
    def test_no_auth_required_when_auth_is_none(self) -> None:
        mgr = MockRunManager()
        app = _make_app(mgr, auth=None)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/openai/chat/completions",
                json={
                    "model": "gc-graph:graph-alpha",
                    "messages": [{"role": "user", "content": "hi"}],
                },
            )
        assert resp.status_code == 200

    def test_valid_key_with_openai_invoke_scope_passes(self) -> None:
        auth, header = _make_auth_with_scope("openai:invoke")
        mgr = MockRunManager()
        app = _make_app(mgr, auth=auth)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/openai/chat/completions",
                json={
                    "model": "gc-graph:graph-alpha",
                    "messages": [{"role": "user", "content": "hi"}],
                },
                headers={"Authorization": header},
            )
        assert resp.status_code == 200

    def test_missing_auth_header_returns_403(self) -> None:
        auth, _ = _make_auth_with_scope("openai:invoke")
        mgr = MockRunManager()
        app = _make_app(mgr, auth=auth)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/openai/chat/completions",
                json={
                    "model": "gc-graph:graph-alpha",
                    "messages": [{"role": "user", "content": "hi"}],
                },
            )
        assert resp.status_code == 403

    def test_wrong_scope_returns_403(self) -> None:
        auth, header = _make_auth_with_scope("run:execute")  # not openai:invoke
        mgr = MockRunManager()
        app = _make_app(mgr, auth=auth)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/openai/chat/completions",
                json={
                    "model": "gc-graph:graph-alpha",
                    "messages": [{"role": "user", "content": "hi"}],
                },
                headers={"Authorization": header},
            )
        assert resp.status_code == 403
        assert "openai:invoke" in resp.json()["error"]

    def test_wildcard_scope_passes(self) -> None:
        auth, header = _make_auth_with_scope("*")
        mgr = MockRunManager()
        app = _make_app(mgr, auth=auth)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/openai/chat/completions",
                json={
                    "model": "gc-graph:graph-alpha",
                    "messages": [{"role": "user", "content": "hi"}],
                },
                headers={"Authorization": header},
            )
        assert resp.status_code == 200

    def test_models_endpoint_also_requires_auth(self) -> None:
        auth, _ = _make_auth_with_scope("openai:invoke")
        mgr = MockRunManager()
        app = _make_app(mgr, auth=auth)
        with TestClient(app) as client:
            resp = client.get("/api/v1/openai/models")
        assert resp.status_code == 403

    def test_models_endpoint_passes_with_scope(self) -> None:
        auth, header = _make_auth_with_scope("openai:invoke")
        mgr = MockRunManager()
        app = _make_app(mgr, auth=auth)
        with TestClient(app, raise_server_exceptions=True) as client:
            resp = client.get(
                "/api/v1/openai/models",
                headers={"Authorization": header},
            )
        assert resp.status_code == 200
