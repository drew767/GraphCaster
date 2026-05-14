# Copyright GraphCaster. All Rights Reserved.

"""Tests for ErrorHandlerRegistry (F72 — trigger_error node type)."""

from __future__ import annotations

import json
import asyncio
from pathlib import Path

import pytest


def _write_graph(directory: Path, graph_id: str, nodes: list[dict], **meta_extra) -> Path:
    """Write a minimal graph JSON file and return its path."""
    doc = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": graph_id, **meta_extra},
        "nodes": [
            {"id": "start-1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            *nodes,
            {"id": "exit-1", "type": "exit", "position": {"x": 0, "y": 200}, "data": {}},
        ],
        "edges": [],
    }
    path = directory / f"{graph_id}.json"
    path.write_text(json.dumps(doc), encoding="utf-8")
    return path


def _trigger_error_node(
    node_id: str = "trigger-1",
    source_graph_ids: list[str] | None = None,
    trigger_on: list[str] | None = None,
) -> dict:
    return {
        "id": node_id,
        "type": "trigger_error",
        "position": {"x": 0, "y": 100},
        "data": {
            "sourceGraphIds": source_graph_ids if source_graph_ids is not None else ["*"],
            "triggerOn": trigger_on if trigger_on is not None else ["failed"],
        },
    }


class TestErrorHandlerRegistryReload:
    def test_reload_sync_finds_handler(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerRegistry

        _write_graph(tmp_path, "broken-graph", [])
        _write_graph(
            tmp_path,
            "my-error-handler",
            [_trigger_error_node(source_graph_ids=["broken-graph"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()

        handlers = reg.find_handlers_for("broken-graph", "failed")
        assert len(handlers) == 1
        assert handlers[0].graph_id == "my-error-handler"
        assert "broken-graph" in handlers[0].sources
        assert "failed" in handlers[0].triggers

    def test_reload_sync_empty_dir(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerRegistry

        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()
        assert reg.find_handlers_for("any", "failed") == []

    def test_reload_sync_ignores_graphs_without_trigger_error(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerRegistry

        _write_graph(tmp_path, "ordinary-graph", [])
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()
        assert reg.find_handlers_for("ordinary-graph", "failed") == []

    def test_reload_async(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerRegistry

        _write_graph(
            tmp_path,
            "handler-graph",
            [_trigger_error_node(source_graph_ids=["src"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        asyncio.run(reg.reload())

        handlers = reg.find_handlers_for("src", "failed")
        assert len(handlers) == 1

    def test_reload_skips_invalid_json(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerRegistry

        bad = tmp_path / "bad.json"
        bad.write_text("{not valid json", encoding="utf-8")
        _write_graph(
            tmp_path,
            "good-handler",
            [_trigger_error_node(source_graph_ids=["src"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()
        # Should still find the good handler
        assert len(reg.find_handlers_for("src", "failed")) == 1


class TestFindHandlersFor:
    def test_specific_source_matches(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerRegistry

        _write_graph(
            tmp_path,
            "handler",
            [_trigger_error_node(source_graph_ids=["broken"], trigger_on=["failed"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()
        assert len(reg.find_handlers_for("broken", "failed")) == 1

    def test_specific_source_does_not_match_other(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerRegistry

        _write_graph(
            tmp_path,
            "handler",
            [_trigger_error_node(source_graph_ids=["broken"], trigger_on=["failed"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()
        assert reg.find_handlers_for("other-graph", "failed") == []

    def test_wildcard_matches_any_graph(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerRegistry

        _write_graph(
            tmp_path,
            "catch-all-handler",
            [_trigger_error_node(source_graph_ids=["*"], trigger_on=["failed"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()

        assert len(reg.find_handlers_for("graph-alpha", "failed")) == 1
        assert len(reg.find_handlers_for("graph-beta", "failed")) == 1
        assert len(reg.find_handlers_for("anything", "failed")) == 1

    def test_trigger_on_cancelled_only(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerRegistry

        _write_graph(
            tmp_path,
            "cancel-handler",
            [_trigger_error_node(source_graph_ids=["*"], trigger_on=["cancelled"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()

        assert len(reg.find_handlers_for("any", "cancelled")) == 1
        assert reg.find_handlers_for("any", "failed") == []
        assert reg.find_handlers_for("any", "timeout") == []

    def test_unknown_reason_returns_empty(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerRegistry

        _write_graph(
            tmp_path,
            "handler",
            [_trigger_error_node(source_graph_ids=["*"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()
        assert reg.find_handlers_for("any", "success") == []
        assert reg.find_handlers_for("any", "running") == []

    def test_multiple_trigger_statuses(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerRegistry

        _write_graph(
            tmp_path,
            "handler",
            [_trigger_error_node(source_graph_ids=["src"], trigger_on=["failed", "cancelled", "timeout"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()

        assert len(reg.find_handlers_for("src", "failed")) == 1
        assert len(reg.find_handlers_for("src", "cancelled")) == 1
        assert len(reg.find_handlers_for("src", "timeout")) == 1

    def test_multiple_handlers_for_same_source(self, tmp_path: Path) -> None:
        from graph_caster.error_handlers import ErrorHandlerRegistry

        _write_graph(
            tmp_path,
            "handler-a",
            [_trigger_error_node("t1", source_graph_ids=["broken"])],
        )
        _write_graph(
            tmp_path,
            "handler-b",
            [_trigger_error_node("t2", source_graph_ids=["broken"])],
        )
        reg = ErrorHandlerRegistry(tmp_path)
        reg.reload_sync()

        handlers = reg.find_handlers_for("broken", "failed")
        assert len(handlers) == 2
        graph_ids = {h.graph_id for h in handlers}
        assert "handler-a" in graph_ids
        assert "handler-b" in graph_ids
