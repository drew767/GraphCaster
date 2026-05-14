# Copyright GraphCaster. All Rights Reserved.

"""Tests for the `loop` node (F46)."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from graph_caster.models import GraphDocument, Node
from graph_caster.nodes.loop import (
    _build_loop_context,
    _collect_body_node_ids,
    _eval_break_condition,
    _store_output,
    execute_loop_node,
)
from graph_caster.runner import GraphRunner


def _make_node(node_id: str, node_type: str = "loop", data: dict | None = None, parent_id: str | None = None) -> Node:
    return Node(
        id=node_id,
        type=node_type,
        position={"x": 0.0, "y": 0.0},
        data=data or {},
        parentId=parent_id,
    )


def _make_doc(nodes: list[dict], edges: list[dict] | None = None) -> GraphDocument:
    return GraphDocument.from_dict(
        {
            "schemaVersion": 14,
            "meta": {
                "schemaVersion": 14,
                "graphId": "test-loop-graph-0000",
                "title": "test",
            },
            "nodes": nodes,
            "edges": edges or [],
        }
    )


class TestBuildLoopContext:
    def test_injects_loop_vars(self) -> None:
        ctx: dict[str, Any] = {"existing": True}
        child = _build_loop_context(ctx, {"counter": 5}, 2)
        assert child["$loop"] == {"iter": 2, "state": {"counter": 5}}
        assert child["last_result"] == {"counter": 5}
        assert child["existing"] is True

    def test_does_not_mutate_original_ctx(self) -> None:
        ctx: dict[str, Any] = {}
        _build_loop_context(ctx, "state", 0)
        assert "$loop" not in ctx


class TestEvalBreakCondition:
    def test_none_condition_never_breaks(self) -> None:
        assert _eval_break_condition(None, {}, 0, {}) is False

    def test_bool_true_breaks(self) -> None:
        assert _eval_break_condition(True, {}, 0, {}) is True

    def test_bool_false_does_not_break(self) -> None:
        assert _eval_break_condition(False, {}, 0, {}) is False

    def test_string_true_breaks(self) -> None:
        assert _eval_break_condition("true", {}, 0, {}) is True

    def test_string_false_does_not_break(self) -> None:
        assert _eval_break_condition("false", {}, 0, {}) is False

    def test_empty_string_does_not_break(self) -> None:
        assert _eval_break_condition("", {}, 0, {}) is False

    def test_json_logic_condition(self) -> None:
        ctx: dict[str, Any] = {"$loop": {"iter": 4, "state": {"n": 5}}}
        result = _eval_break_condition('{"==": [{"var": "$loop.iter"}, 4]}', {"n": 5}, 4, ctx)
        assert result is True

    def test_exception_returns_false(self) -> None:
        result = _eval_break_condition(object(), {}, 0, {})
        assert result is False


class TestCollectBodyNodeIds:
    def test_returns_nodes_with_matching_parent_id(self) -> None:
        doc = _make_doc(
            [
                {"id": "loop1", "type": "loop", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "body1", "type": "task", "parentId": "loop1", "position": {"x": 100, "y": 0}, "data": {}},
                {"id": "other", "type": "task", "position": {"x": 200, "y": 0}, "data": {}},
            ]
        )
        runner = MagicMock()
        runner._doc = doc
        ids = _collect_body_node_ids(runner, "loop1")
        assert ids == ["body1"]


class TestStoreOutput:
    def test_stores_state_and_meta(self) -> None:
        node = _make_node("loop1")
        ctx: dict[str, Any] = {}
        runner = MagicMock()
        _store_output(runner, node, ctx, {"counter": 5}, 5, False)
        out = ctx["node_outputs"]["loop1"]
        assert out["state"] == {"counter": 5}
        assert out["iterationsCompleted"] == 5
        assert out["wasBroken"] is False
        assert ctx["last_result"] == {"counter": 5}

    def test_was_broken_flag(self) -> None:
        node = _make_node("loop1")
        ctx: dict[str, Any] = {}
        runner = MagicMock()
        _store_output(runner, node, ctx, "done", 3, True)
        assert ctx["node_outputs"]["loop1"]["wasBroken"] is True


class TestExecuteLoopNode:
    def test_max_iterations_cap_with_no_body(self) -> None:
        doc = _make_doc(
            [{"id": "loop1", "type": "loop", "position": {"x": 0, "y": 0}, "data": {"maxIterations": 3}}]
        )
        runner = MagicMock()
        runner._doc = doc
        runner._node_by_id = {n.id: n for n in doc.nodes}
        node = runner._node_by_id["loop1"]
        ctx: dict[str, Any] = {}
        execute_loop_node(runner, node, ctx)
        assert ctx["node_outputs"]["loop1"]["iterationsCompleted"] == 3
        assert ctx["node_outputs"]["loop1"]["wasBroken"] is False

    def test_break_condition_terminates_early(self) -> None:
        doc = _make_doc(
            [
                {
                    "id": "loop1",
                    "type": "loop",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "maxIterations": 100,
                        "breakCondition": "true",
                    },
                }
            ]
        )
        runner = MagicMock()
        runner._doc = doc
        runner._node_by_id = {n.id: n for n in doc.nodes}
        node = runner._node_by_id["loop1"]
        ctx: dict[str, Any] = {}
        execute_loop_node(runner, node, ctx)
        assert ctx["node_outputs"]["loop1"]["iterationsCompleted"] == 1
        assert ctx["node_outputs"]["loop1"]["wasBroken"] is True

    def test_initial_state_passed_through(self) -> None:
        doc = _make_doc(
            [
                {
                    "id": "loop1",
                    "type": "loop",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "initialState": {"value": 42},
                        "maxIterations": 2,
                    },
                }
            ]
        )
        runner = MagicMock()
        runner._doc = doc
        runner._node_by_id = {n.id: n for n in doc.nodes}
        node = runner._node_by_id["loop1"]
        ctx: dict[str, Any] = {}
        execute_loop_node(runner, node, ctx)
        out = ctx["node_outputs"]["loop1"]
        assert out["iterationsCompleted"] == 2

    def test_runner_integration_loop_node(self, tmp_path: Path) -> None:
        """End-to-end: loop node with maxIterations runs to success."""
        doc = _make_doc(
            [
                {"id": "start1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "loop1",
                    "type": "loop",
                    "position": {"x": 100, "y": 0},
                    "data": {"maxIterations": 3},
                },
                {"id": "exit1", "type": "exit", "position": {"x": 200, "y": 0}, "data": {}},
            ],
            edges=[
                {"id": "e1", "source": "start1", "sourceHandle": "out_default", "target": "loop1", "targetHandle": "in_default", "condition": None},
                {"id": "e2", "source": "loop1", "sourceHandle": "out_default", "target": "exit1", "targetHandle": "in_default", "condition": None},
            ],
        )
        from graph_caster.host_context import RunHostContext

        events: list[dict] = []
        GraphRunner(
            doc,
            sink=lambda e: events.append(e),
            host=RunHostContext(artifacts_base=tmp_path),
        ).run()
        run_finished = [e for e in events if e.get("type") == "run_finished"]
        assert run_finished, f"Expected run_finished, got: {events}"
        assert run_finished[0].get("status") == "success"

    def test_loop_example_fixture_schema_valid(self) -> None:
        """The loop-example.json fixture must be valid against the schema."""
        import json

        root = Path(__file__).resolve().parents[2]
        fixture_path = root / "schemas" / "test-fixtures" / "loop-example.json"
        raw = json.loads(fixture_path.read_text(encoding="utf-8"))
        doc = GraphDocument.from_dict(raw)
        assert any(n.type == "loop" for n in doc.nodes)

    def test_cancelled_run_exits_early(self) -> None:
        doc = _make_doc(
            [{"id": "loop1", "type": "loop", "position": {"x": 0, "y": 0}, "data": {"maxIterations": 1000}}]
        )
        runner = MagicMock()
        runner._doc = doc
        runner._node_by_id = {n.id: n for n in doc.nodes}
        node = runner._node_by_id["loop1"]
        ctx: dict[str, Any] = {"_run_cancelled": True}
        execute_loop_node(runner, node, ctx)
        assert ctx["node_outputs"]["loop1"]["iterationsCompleted"] == 0
