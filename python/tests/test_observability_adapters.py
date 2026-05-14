# Copyright GraphCaster. All Rights Reserved.

"""Tests for F54 observability adapters (Langfuse, LangSmith, Arize Phoenix)."""

from __future__ import annotations

import asyncio
import base64
import json
import os
from typing import Any
from unittest.mock import patch

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def run_async(coro):
    """Run coroutine in a fresh event loop (avoids loop-reuse issues across tests)."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


class _CapturedRequest:
    def __init__(self, method: str, url: str, body: bytes, headers: dict[str, str]) -> None:
        self.method = method
        self.url = url
        self.body = body
        self.headers = headers

    @property
    def json(self) -> Any:
        return json.loads(self.body)


def _make_transport(captured: list[_CapturedRequest], status: int = 200):
    """Return an httpx transport that records requests without hitting the network."""
    import httpx

    class _MockTransport(httpx.AsyncBaseTransport):
        async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
            body = await request.aread()
            captured.append(
                _CapturedRequest(
                    method=request.method,
                    url=str(request.url),
                    body=body,
                    headers=dict(request.headers),
                )
            )
            return httpx.Response(status, text="{}")

    return _MockTransport()


# ---------------------------------------------------------------------------
# Registry / get_adapter
# ---------------------------------------------------------------------------


class TestGetAdapter:
    def test_returns_none_when_env_unset(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("GC_TRACE_BACKEND", None)
            from graph_caster.observability.adapters.registry import get_adapter
            assert get_adapter() is None

    def test_returns_langfuse_adapter(self):
        with patch.dict(os.environ, {"GC_TRACE_BACKEND": "langfuse"}):
            from graph_caster.observability.adapters.registry import get_adapter
            from graph_caster.observability.adapters.langfuse import LangfuseAdapter
            assert isinstance(get_adapter(), LangfuseAdapter)

    def test_returns_langsmith_adapter(self):
        with patch.dict(os.environ, {"GC_TRACE_BACKEND": "langsmith"}):
            from graph_caster.observability.adapters.registry import get_adapter
            from graph_caster.observability.adapters.langsmith import LangSmithAdapter
            assert isinstance(get_adapter(), LangSmithAdapter)

    def test_returns_phoenix_adapter(self):
        with patch.dict(os.environ, {"GC_TRACE_BACKEND": "phoenix"}):
            from graph_caster.observability.adapters.registry import get_adapter
            from graph_caster.observability.adapters.phoenix import ArizePhoenixAdapter
            assert isinstance(get_adapter(), ArizePhoenixAdapter)

    def test_returns_none_for_unknown_backend(self):
        with patch.dict(os.environ, {"GC_TRACE_BACKEND": "sentry"}):
            from graph_caster.observability.adapters.registry import get_adapter
            assert get_adapter() is None

    def test_case_insensitive(self):
        with patch.dict(os.environ, {"GC_TRACE_BACKEND": "LangFuse"}):
            from graph_caster.observability.adapters.registry import get_adapter
            from graph_caster.observability.adapters.langfuse import LangfuseAdapter
            assert isinstance(get_adapter(), LangfuseAdapter)


# ---------------------------------------------------------------------------
# LangfuseAdapter
# ---------------------------------------------------------------------------


class TestLangfuseAdapter:
    def _make_adapter(self):
        from graph_caster.observability.adapters.langfuse import LangfuseAdapter
        return LangfuseAdapter(
            host="http://langfuse-test.local",
            public_key="pk-test",
            secret_key="sk-test",
        )

    def test_lifecycle_batches_and_flushes(self):
        captured: list[_CapturedRequest] = []
        adapter = self._make_adapter()
        transport = _make_transport(captured)

        adapter.on_run_started("run1", "graph1", {"user": "alice"})
        adapter.on_node_started("run1", "node1", "llm", {"prompt": "hi"})
        adapter.on_node_finished("run1", "node1", {"text": "hello"}, None, {"tokens": 10})

        async def do_flush():
            await adapter.flush(_transport=transport)

        run_async(do_flush())

        assert len(captured) == 1, f"expected 1 request, got {len(captured)}"
        body = captured[0].json
        assert "batch" in body
        batch = body["batch"]
        trace_creates = [e for e in batch if e["type"] == "trace-create"]
        assert any(e["body"]["id"] == "run1" for e in trace_creates)
        gen_creates = [e for e in batch if e["type"] == "generation-create"]
        assert any(e["body"]["id"] == "node1" for e in gen_creates)

    def test_auth_header_is_basic(self):
        captured: list[_CapturedRequest] = []
        adapter = self._make_adapter()
        transport = _make_transport(captured)
        adapter.on_run_started("run1", "g1", {})

        async def send():
            await adapter._send_batch(adapter._batch.copy(), _transport=transport)

        run_async(send())

        assert len(captured) == 1
        auth = captured[0].headers.get("authorization", "")
        assert auth.startswith("Basic ")
        decoded = base64.b64decode(auth[6:]).decode()
        assert decoded == "pk-test:sk-test"

    def test_batch_url_is_ingestion_endpoint(self):
        captured: list[_CapturedRequest] = []
        adapter = self._make_adapter()
        transport = _make_transport(captured)
        adapter.on_run_started("run1", "g1", {})

        async def send():
            await adapter._send_batch(adapter._batch.copy(), _transport=transport)

        run_async(send())
        assert "/api/public/ingestion" in captured[0].url

    def test_non_llm_node_creates_span(self):
        adapter = self._make_adapter()
        adapter.on_node_started("run1", "node2", "http_request", {"url": "http://api"})
        span_events = [e for e in adapter._batch if e["type"] == "span-create"]
        assert any(e["body"]["id"] == "node2" for e in span_events)

    def test_llm_node_creates_generation(self):
        adapter = self._make_adapter()
        for node_type in ("llm", "llm_agent", "agent", "gcCursorAgent"):
            adapter._batch.clear()
            adapter.on_node_started("run1", "nx", node_type, {})
            gen_events = [e for e in adapter._batch if e["type"] == "generation-create"]
            assert gen_events, f"expected generation-create for node_type={node_type}"

    def test_node_error_sets_level_error(self):
        adapter = self._make_adapter()
        adapter.on_node_started("run1", "node3", "http_request", {})
        adapter.on_node_finished("run1", "node3", {}, {"message": "timeout"}, None)
        updates = [e for e in adapter._batch if "update" in e.get("type", "")]
        assert any(e["body"].get("level") == "ERROR" for e in updates)

    def test_http_error_does_not_crash(self):
        """HTTP 500 must be swallowed; adapter must not raise."""
        captured: list[_CapturedRequest] = []
        adapter = self._make_adapter()
        transport = _make_transport(captured, status=500)
        adapter.on_run_started("run1", "g1", {})

        async def send():
            await adapter._send_batch(adapter._batch.copy(), _transport=transport)

        run_async(send())  # must not raise

    def test_flush_is_idempotent(self):
        captured: list[_CapturedRequest] = []
        adapter = self._make_adapter()
        transport = _make_transport(captured)

        async def do():
            await adapter.flush(_transport=transport)
            await adapter.flush(_transport=transport)

        run_async(do())
        assert len(captured) == 0  # nothing buffered → nothing sent

    def test_flush_clears_batch(self):
        captured: list[_CapturedRequest] = []
        adapter = self._make_adapter()
        transport = _make_transport(captured)
        adapter.on_run_started("r1", "g1", {})
        assert len(adapter._batch) == 1

        async def do():
            await adapter.flush(_transport=transport)

        run_async(do())
        assert len(adapter._batch) == 0


# ---------------------------------------------------------------------------
# LangSmithAdapter
# ---------------------------------------------------------------------------


class TestLangSmithAdapter:
    def _make_adapter(self):
        from graph_caster.observability.adapters.langsmith import LangSmithAdapter
        return LangSmithAdapter(
            endpoint="http://langsmith-test.local",
            api_key="ls-key",
        )

    def test_lifecycle_post_then_patch(self):
        captured: list[_CapturedRequest] = []
        transport = _make_transport(captured)
        adapter = self._make_adapter()

        adapter.on_run_started("run1", "graph1", {})
        adapter.on_node_started("run1", "node1", "llm", {"prompt": "hello"})
        adapter.on_node_finished("run1", "node1", {"text": "world"}, None, None)
        adapter.on_run_finished("run1", "success", {})

        async def flush():
            items = list(adapter._pending)
            adapter._pending.clear()
            for item in items:
                await adapter._send_run(item, _transport=transport)

        run_async(flush())

        methods = [r.method for r in captured]
        assert "POST" in methods
        assert "PATCH" in methods

    def test_api_key_header(self):
        captured: list[_CapturedRequest] = []
        transport = _make_transport(captured)
        adapter = self._make_adapter()
        adapter.on_run_started("run1", "g1", {})

        async def flush():
            items = list(adapter._pending)
            adapter._pending.clear()
            for item in items:
                await adapter._send_run(item, _transport=transport)

        run_async(flush())
        assert len(captured) == 1
        assert captured[0].headers.get("x-api-key") == "ls-key"

    def test_run_started_posts_to_runs_endpoint(self):
        captured: list[_CapturedRequest] = []
        transport = _make_transport(captured)
        adapter = self._make_adapter()
        adapter.on_run_started("run1", "g1", {})

        async def flush():
            items = list(adapter._pending)
            adapter._pending.clear()
            for item in items:
                await adapter._send_run(item, _transport=transport)

        run_async(flush())
        assert "/runs" in captured[0].url
        assert captured[0].method == "POST"

    def test_node_error_included_in_patch(self):
        from graph_caster.observability.adapters.langsmith import LangSmithAdapter
        adapter = LangSmithAdapter(endpoint="http://ls.local", api_key="k")
        adapter.on_node_finished("run1", "n1", {}, {"message": "boom"}, None)
        patch_item = adapter._pending[0]
        assert patch_item.get("error") == "boom"

    def test_http_error_does_not_crash(self):
        captured: list[_CapturedRequest] = []
        transport = _make_transport(captured, status=503)
        adapter = self._make_adapter()
        adapter.on_run_started("run1", "g1", {})

        async def flush():
            items = list(adapter._pending)
            adapter._pending.clear()
            for item in items:
                await adapter._send_run(item, _transport=transport)

        run_async(flush())  # must not raise

    def test_flush_idempotent(self):
        adapter = self._make_adapter()

        async def do():
            await adapter.flush()
            await adapter.flush()

        run_async(do())  # no crash, no pending items


# ---------------------------------------------------------------------------
# ArizePhoenixAdapter
# ---------------------------------------------------------------------------


class TestArizePhoenixAdapter:
    def test_is_noop_adapter(self):
        from graph_caster.observability.adapters.phoenix import ArizePhoenixAdapter
        adapter = ArizePhoenixAdapter()
        adapter.on_run_started("r", "g", {})
        adapter.on_node_started("r", "n", "llm", {})
        adapter.on_node_finished("r", "n", {}, None, None)
        adapter.on_run_finished("r", "success", {})
        run_async(adapter.flush())

    def test_sets_otel_endpoint_from_env(self):
        env_copy = dict(os.environ)
        env_copy.pop("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", None)
        env_copy["PHOENIX_COLLECTOR_ENDPOINT"] = "http://ph:6006/v1/traces"
        with patch.dict(os.environ, env_copy, clear=True):
            from graph_caster.observability.adapters import phoenix as ph_mod
            import importlib
            importlib.reload(ph_mod)
            ph_mod.ArizePhoenixAdapter(collector_endpoint="http://ph:6006/v1/traces")
            assert os.environ.get("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT") == "http://ph:6006/v1/traces"

    def test_flush_is_idempotent(self):
        from graph_caster.observability.adapters.phoenix import ArizePhoenixAdapter
        adapter = ArizePhoenixAdapter()

        async def do():
            await adapter.flush()
            await adapter.flush()

        run_async(do())


# ---------------------------------------------------------------------------
# TraceAdapterSink — wiring
# ---------------------------------------------------------------------------


class _RecordingAdapter:
    """Simple in-memory adapter that records calls (no network)."""

    name = "recording"

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def on_run_started(self, run_id, graph_id, metadata):
        self.calls.append(("run_started", run_id, graph_id))

    def on_node_started(self, run_id, node_id, node_type, inputs):
        self.calls.append(("node_started", run_id, node_id, node_type))

    def on_node_finished(self, run_id, node_id, outputs, error, usage):
        self.calls.append(("node_finished", run_id, node_id, bool(error)))

    def on_run_finished(self, run_id, status, summary):
        self.calls.append(("run_finished", run_id, status))

    async def flush(self):
        self.calls.append(("flush",))


class _FailingAdapter(_RecordingAdapter):
    """Adapter that raises on every non-flush call."""

    def on_run_started(self, run_id, graph_id, metadata):
        raise RuntimeError("adapter crash")

    def on_node_started(self, run_id, node_id, node_type, inputs):
        raise RuntimeError("adapter crash")

    def on_node_finished(self, run_id, node_id, outputs, error, usage):
        raise RuntimeError("adapter crash")

    def on_run_finished(self, run_id, status, summary):
        raise RuntimeError("adapter crash")


def _make_sink(adapter=None):
    from graph_caster.run_event_sink import CallableRunEventSink
    from graph_caster.observability.adapters.sink import TraceAdapterSink

    received: list[dict] = []
    inner = CallableRunEventSink(received.append)
    if adapter is None:
        adapter = _RecordingAdapter()
    return TraceAdapterSink(inner, adapter), received, adapter


class TestTraceAdapterSink:
    def test_run_lifecycle_dispatched_in_order(self):
        sink, received, adapter = _make_sink()
        sink.emit({"type": "run_started", "runId": "r1", "rootGraphId": "g1"})
        sink.emit({"type": "node_execute", "runId": "r1", "nodeId": "n1", "nodeType": "llm", "data": {}})
        sink.emit({"type": "node_exit", "runId": "r1", "nodeId": "n1", "nodeType": "llm"})
        sink.emit({"type": "run_finished", "runId": "r1", "status": "success"})

        assert len(received) == 4
        types = [c[0] for c in adapter.calls]
        assert types == ["run_started", "node_started", "node_finished", "run_finished"]

    def test_error_event_closes_node_span(self):
        sink, _, adapter = _make_sink()
        sink.emit({"type": "run_started", "runId": "r1", "rootGraphId": "g1"})
        sink.emit({"type": "node_execute", "runId": "r1", "nodeId": "n1", "nodeType": "llm", "data": {}})
        sink.emit({"type": "error", "runId": "r1", "nodeId": "n1", "message": "timeout"})

        node_finished = [c for c in adapter.calls if c[0] == "node_finished"]
        assert len(node_finished) == 1
        assert node_finished[0][3] is True  # has_error flag

    def test_inner_sink_unharmed_when_adapter_crashes(self):
        """The primary inner sink must always receive events regardless of adapter failures."""
        sink, received, _ = _make_sink(adapter=_FailingAdapter())
        sink.emit({"type": "run_started", "runId": "r1", "rootGraphId": "g1"})
        sink.emit({"type": "run_finished", "runId": "r1", "status": "success"})
        assert len(received) == 2

    def test_unknown_event_types_ignored_by_adapter(self):
        sink, received, adapter = _make_sink()
        sink.emit({"type": "ping", "runId": "r1"})
        sink.emit({"type": "branch_taken", "runId": "r1"})
        assert len(received) == 2
        assert adapter.calls == []

    def test_node_execute_without_matching_run_started_still_works(self):
        sink, _, adapter = _make_sink()
        sink.emit({"type": "node_execute", "runId": "r1", "nodeId": "n1", "nodeType": "http_request", "data": {}})
        node_started = [c for c in adapter.calls if c[0] == "node_started"]
        assert len(node_started) == 1

    def test_build_trace_wrapped_sink_returns_plain_sink_when_no_backend(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("GC_TRACE_BACKEND", None)
            from graph_caster.run_event_sink import build_trace_wrapped_sink, NullRunEventSink
            result = build_trace_wrapped_sink(None)
            assert isinstance(result, NullRunEventSink)

    def test_build_trace_wrapped_sink_wraps_with_adapter_when_backend_set(self):
        with patch.dict(os.environ, {
            "GC_TRACE_BACKEND": "langfuse",
            "LANGFUSE_HOST": "http://x",
            "LANGFUSE_PUBLIC_KEY": "p",
            "LANGFUSE_SECRET_KEY": "s",
        }):
            from graph_caster.run_event_sink import build_trace_wrapped_sink
            from graph_caster.observability.adapters.sink import TraceAdapterSink
            result = build_trace_wrapped_sink(None)
            assert isinstance(result, TraceAdapterSink)

    def test_multiple_nodes_tracked_independently(self):
        sink, _, adapter = _make_sink()
        sink.emit({"type": "run_started", "runId": "r1", "rootGraphId": "g1"})
        sink.emit({"type": "node_execute", "runId": "r1", "nodeId": "n1", "nodeType": "llm", "data": {}})
        sink.emit({"type": "node_execute", "runId": "r1", "nodeId": "n2", "nodeType": "http_request", "data": {}})
        sink.emit({"type": "node_exit", "runId": "r1", "nodeId": "n1", "nodeType": "llm"})
        sink.emit({"type": "node_exit", "runId": "r1", "nodeId": "n2", "nodeType": "http_request"})
        sink.emit({"type": "run_finished", "runId": "r1", "status": "success"})

        started = [c for c in adapter.calls if c[0] == "node_started"]
        finished = [c for c in adapter.calls if c[0] == "node_finished"]
        assert len(started) == 2
        assert len(finished) == 2
