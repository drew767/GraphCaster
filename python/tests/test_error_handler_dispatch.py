# Copyright GraphCaster. All Rights Reserved.

"""Tests for ErrorHandlerDispatcher — broker run-finish hook integration (F72)."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest


def _write_graph(directory: Path, graph_id: str, nodes: list[dict]) -> None:
    doc = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": graph_id},
        "nodes": [
            {"id": "start-1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            *nodes,
            {"id": "exit-1", "type": "exit", "position": {"x": 0, "y": 200}, "data": {}},
        ],
        "edges": [],
    }
    (directory / f"{graph_id}.json").write_text(json.dumps(doc), encoding="utf-8")


def _trigger_node(
    node_id: str = "t1",
    sources: list[str] | None = None,
    trigger_on: list[str] | None = None,
) -> dict:
    return {
        "id": node_id,
        "type": "trigger_error",
        "position": {"x": 0, "y": 100},
        "data": {
            "sourceGraphIds": sources if sources is not None else ["*"],
            "triggerOn": trigger_on if trigger_on is not None else ["failed"],
        },
    }


def _run_finished_event(
    run_id: str = "run-1",
    graph_id: str = "broken-graph",
    status: str = "failed",
    error: dict | None = None,
    started_at: str = "2026-05-12T10:00:00Z",
    finished_at: str = "2026-05-12T10:01:00Z",
) -> dict:
    ev: dict = {
        "type": "run_finished",
        "runId": run_id,
        "rootGraphId": graph_id,
        "status": status,
        "startedAt": started_at,
        "finishedAt": finished_at,
    }
    if error is not None:
        ev["error"] = error
    return ev


class TestErrorHandlerDispatcher:
    def test_failed_run_triggers_handler(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerDispatcher, ErrorHandlerRegistry

        _write_graph(tmp_path, "broken-graph", [])
        _write_graph(
            tmp_path,
            "handler-graph",
            [_trigger_node(sources=["broken-graph"], trigger_on=["failed"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()

        start_mock = MagicMock()
        dispatcher = ErrorHandlerDispatcher(reg, start_run_fn=start_mock)
        dispatcher.on_run_finished(_run_finished_event(status="failed"))

        start_mock.assert_called_once()
        called_graph_id, called_ctx = start_mock.call_args[0]
        assert called_graph_id == "handler-graph"
        assert called_ctx["source_graph_id"] == "broken-graph"
        assert called_ctx["source_run_id"] == "run-1"
        assert called_ctx["source_status"] == "failed"

    def test_cancelled_run_triggers_cancelled_handler(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerDispatcher, ErrorHandlerRegistry

        _write_graph(
            tmp_path,
            "cancel-handler",
            [_trigger_node(sources=["*"], trigger_on=["cancelled"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()

        start_mock = MagicMock()
        dispatcher = ErrorHandlerDispatcher(reg, start_run_fn=start_mock)
        dispatcher.on_run_finished(_run_finished_event(graph_id="any-graph", status="cancelled"))

        start_mock.assert_called_once()
        _, ctx = start_mock.call_args[0]
        assert ctx["source_status"] == "cancelled"

    def test_cancelled_handler_does_not_fire_on_failed(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerDispatcher, ErrorHandlerRegistry

        _write_graph(
            tmp_path,
            "cancel-only-handler",
            [_trigger_node(sources=["*"], trigger_on=["cancelled"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()

        start_mock = MagicMock()
        dispatcher = ErrorHandlerDispatcher(reg, start_run_fn=start_mock)
        dispatcher.on_run_finished(_run_finished_event(status="failed"))

        start_mock.assert_not_called()

    def test_success_run_does_not_trigger_handlers(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerDispatcher, ErrorHandlerRegistry

        _write_graph(
            tmp_path,
            "handler",
            [_trigger_node(sources=["*"], trigger_on=["failed"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()

        start_mock = MagicMock()
        dispatcher = ErrorHandlerDispatcher(reg, start_run_fn=start_mock)
        dispatcher.on_run_finished(_run_finished_event(status="success"))

        start_mock.assert_not_called()

    def test_non_matching_source_graph_does_not_trigger(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerDispatcher, ErrorHandlerRegistry

        _write_graph(
            tmp_path,
            "specific-handler",
            [_trigger_node(sources=["specific-source"], trigger_on=["failed"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()

        start_mock = MagicMock()
        dispatcher = ErrorHandlerDispatcher(reg, start_run_fn=start_mock)
        dispatcher.on_run_finished(_run_finished_event(graph_id="other-source", status="failed"))

        start_mock.assert_not_called()

    def test_error_context_is_passed_through(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerDispatcher, ErrorHandlerRegistry

        _write_graph(
            tmp_path,
            "handler",
            [_trigger_node(sources=["*"], trigger_on=["failed"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()

        start_mock = MagicMock()
        dispatcher = ErrorHandlerDispatcher(reg, start_run_fn=start_mock)
        error_detail = {"message": "Something broke", "node_id": "task-99", "stack": "..."}
        dispatcher.on_run_finished(
            _run_finished_event(status="failed", error=error_detail)
        )

        _, ctx = start_mock.call_args[0]
        assert ctx["error"]["message"] == "Something broke"
        assert ctx["error"]["node_id"] == "task-99"

    def test_start_run_fn_exception_does_not_propagate(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerDispatcher, ErrorHandlerRegistry

        _write_graph(
            tmp_path,
            "handler",
            [_trigger_node(sources=["*"], trigger_on=["failed"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()

        def bad_start(graph_id: str, ctx: dict) -> None:
            raise RuntimeError("explode")

        dispatcher = ErrorHandlerDispatcher(reg, start_run_fn=bad_start)
        # Must not raise
        dispatcher.on_run_finished(_run_finished_event(status="failed"))

    def test_no_root_graph_id_skips_dispatch(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerDispatcher, ErrorHandlerRegistry

        _write_graph(tmp_path, "handler", [_trigger_node(sources=["*"])])
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()

        start_mock = MagicMock()
        dispatcher = ErrorHandlerDispatcher(reg, start_run_fn=start_mock)
        event = {
            "type": "run_finished",
            "runId": "run-x",
            "status": "failed",
        }
        dispatcher.on_run_finished(event)
        start_mock.assert_not_called()

    def test_wildcard_triggers_for_any_graph(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerDispatcher, ErrorHandlerRegistry

        _write_graph(tmp_path, "wildcard-handler", [_trigger_node(sources=["*"])])
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()

        start_mock = MagicMock()
        dispatcher = ErrorHandlerDispatcher(reg, start_run_fn=start_mock)
        dispatcher.on_run_finished(_run_finished_event(graph_id="graph-alpha", status="failed"))
        dispatcher.on_run_finished(_run_finished_event(graph_id="graph-beta", status="failed"))

        assert start_mock.call_count == 2


class TestBrokerRegistryHook:
    def test_broker_registry_has_set_run_finished_hook(self) -> None:
        from graph_caster.run_broker.registry import RunBrokerRegistry

        reg = RunBrokerRegistry()
        assert callable(reg.set_run_finished_hook)

    def test_hook_is_called_on_run_finished_line(self) -> None:
        from graph_caster.run_broker.registry import RunBrokerRegistry

        reg = RunBrokerRegistry()
        calls: list[dict] = []
        reg.set_run_finished_hook(calls.append)

        finished_line = json.dumps({
            "type": "run_finished",
            "runId": "r1",
            "rootGraphId": "g1",
            "status": "failed",
        })
        reg._maybe_dispatch_run_finished_hook(finished_line)
        assert len(calls) == 1
        assert calls[0]["type"] == "run_finished"
        assert calls[0]["status"] == "failed"

    def test_hook_not_called_for_non_run_finished(self) -> None:
        from graph_caster.run_broker.registry import RunBrokerRegistry

        reg = RunBrokerRegistry()
        calls: list[dict] = []
        reg.set_run_finished_hook(calls.append)

        reg._maybe_dispatch_run_finished_hook(
            json.dumps({"type": "run_started", "runId": "r1"})
        )
        reg._maybe_dispatch_run_finished_hook("not json at all")
        reg._maybe_dispatch_run_finished_hook("")
        assert calls == []

    def test_hook_exception_does_not_propagate(self) -> None:
        from graph_caster.run_broker.registry import RunBrokerRegistry

        reg = RunBrokerRegistry()

        def bad_hook(event: dict) -> None:
            raise RuntimeError("hook failed")

        reg.set_run_finished_hook(bad_hook)
        finished_line = json.dumps({"type": "run_finished", "runId": "r1", "status": "failed"})
        reg._maybe_dispatch_run_finished_hook(finished_line)
