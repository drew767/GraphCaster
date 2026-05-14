# Copyright GraphCaster. All Rights Reserved.

"""Tests for the `iteration` node (F46)."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from graph_caster.models import GraphDocument, Node
from graph_caster.nodes.iteration import (
    _collect_body_node_ids,
    _resolve_items,
    _store_output,
    execute_iteration_node,
)
from graph_caster.runner import GraphRunner


def _make_node(node_id: str, node_type: str = "iteration", data: dict | None = None, parent_id: str | None = None) -> Node:
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
                "graphId": "test-iter-graph-0000",
                "title": "test",
            },
            "nodes": nodes,
            "edges": edges or [],
        }
    )


class TestResolveItems:
    def test_inline_items_from_data(self) -> None:
        node = _make_node("iter1", data={"items": [10, 20, 30]})
        ctx: dict[str, Any] = {}
        items = _resolve_items(node, ctx, "items", {"items": [10, 20, 30]})
        assert items == [10, 20, 30]

    def test_upstream_output_key(self) -> None:
        node = _make_node("iter1", data={})
        ctx: dict[str, Any] = {
            "node_outputs": {
                "prev": {"items": [1, 2, 3]},
            }
        }
        items = _resolve_items(node, ctx, "items", {})
        assert items == [1, 2, 3]

    def test_empty_when_nothing_found(self) -> None:
        node = _make_node("iter1", data={})
        ctx: dict[str, Any] = {}
        items = _resolve_items(node, ctx, "items", {})
        assert items == []

    def test_nested_data_key_in_upstream(self) -> None:
        node = _make_node("iter1", data={})
        ctx: dict[str, Any] = {
            "node_outputs": {
                "prev": {"data": {"items": ["a", "b"]}},
            }
        }
        items = _resolve_items(node, ctx, "items", {})
        assert items == ["a", "b"]


class TestCollectBodyNodeIds:
    def test_no_body_nodes(self) -> None:
        doc = _make_doc(
            [
                {"id": "start1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "iter1", "type": "iteration", "position": {"x": 100, "y": 0}, "data": {}},
            ]
        )
        runner = MagicMock()
        runner._doc = doc
        ids = _collect_body_node_ids(runner, "iter1")
        assert ids == []

    def test_body_nodes_via_parent_id(self) -> None:
        doc = _make_doc(
            [
                {"id": "start1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "iter1", "type": "iteration", "position": {"x": 100, "y": 0}, "data": {}},
                {"id": "body1", "type": "task", "parentId": "iter1", "position": {"x": 200, "y": 0}, "data": {}},
                {"id": "body2", "type": "task", "parentId": "iter1", "position": {"x": 300, "y": 0}, "data": {}},
                {"id": "other", "type": "task", "parentId": "other_node", "position": {"x": 400, "y": 0}, "data": {}},
            ]
        )
        runner = MagicMock()
        runner._doc = doc
        ids = _collect_body_node_ids(runner, "iter1")
        assert "body1" in ids
        assert "body2" in ids
        assert "other" not in ids
        assert len(ids) == 2


class TestStoreOutput:
    def test_stores_results_and_last_result(self) -> None:
        node = _make_node("iter1")
        ctx: dict[str, Any] = {}
        runner = MagicMock()
        results = [{"index": 0, "item": 1}, {"index": 1, "item": 2}]
        _store_output(runner, node, ctx, results)
        assert ctx["node_outputs"]["iter1"]["results"] == results
        assert ctx["last_result"] == results

    def test_merges_with_existing_output(self) -> None:
        node = _make_node("iter1")
        ctx: dict[str, Any] = {
            "node_outputs": {"iter1": {"nodeType": "iteration", "data": {}}}
        }
        runner = MagicMock()
        _store_output(runner, node, ctx, [1, 2])
        assert ctx["node_outputs"]["iter1"]["results"] == [1, 2]
        assert ctx["node_outputs"]["iter1"]["nodeType"] == "iteration"


class TestExecuteIterationNode:
    def test_no_body_nodes_produces_index_item_pairs(self) -> None:
        doc = _make_doc(
            [
                {"id": "start1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "iter1", "type": "iteration", "position": {"x": 100, "y": 0}, "data": {"items": [10, 20, 30]}},
                {"id": "exit1", "type": "exit", "position": {"x": 200, "y": 0}, "data": {}},
            ],
            edges=[
                {"id": "e1", "source": "start1", "target": "iter1", "condition": None},
                {"id": "e2", "source": "iter1", "target": "exit1", "condition": None},
            ],
        )
        runner = MagicMock()
        runner._doc = doc
        runner._node_by_id = {n.id: n for n in doc.nodes}
        node = runner._node_by_id["iter1"]
        ctx: dict[str, Any] = {"node_outputs": {"iter1": {"nodeType": "iteration", "data": {"items": [10, 20, 30]}}}}
        execute_iteration_node(runner, node, ctx)
        results = ctx["node_outputs"]["iter1"]["results"]
        assert len(results) == 3
        assert results[0] == {"index": 0, "item": 10}
        assert results[1] == {"index": 1, "item": 20}
        assert results[2] == {"index": 2, "item": 30}

    def test_empty_items_produces_empty_results(self) -> None:
        doc = _make_doc(
            [{"id": "iter1", "type": "iteration", "position": {"x": 0, "y": 0}, "data": {"items": []}}]
        )
        runner = MagicMock()
        runner._doc = doc
        runner._node_by_id = {n.id: n for n in doc.nodes}
        node = runner._node_by_id["iter1"]
        ctx: dict[str, Any] = {}
        execute_iteration_node(runner, node, ctx)
        assert ctx["node_outputs"]["iter1"]["results"] == []
        assert ctx["last_result"] == []

    def test_runner_integration_iteration_node(self, tmp_path: Path) -> None:
        """End-to-end: iteration node with no body nodes runs to success."""
        doc = _make_doc(
            [
                {"id": "start1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "iter1",
                    "type": "iteration",
                    "position": {"x": 100, "y": 0},
                    "data": {"items": [1, 2, 3]},
                },
                {"id": "exit1", "type": "exit", "position": {"x": 200, "y": 0}, "data": {}},
            ],
            edges=[
                {"id": "e1", "source": "start1", "sourceHandle": "out_default", "target": "iter1", "targetHandle": "in_default", "condition": None},
                {"id": "e2", "source": "iter1", "sourceHandle": "out_default", "target": "exit1", "targetHandle": "in_default", "condition": None},
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

    def test_iter_context_vars_injected(self) -> None:
        """$iter.item and $iter.index must be in child ctx when iterating."""
        from graph_caster.nodes.iteration import _build_iter_context

        ctx: dict[str, Any] = {"foo": "bar"}
        child = _build_iter_context(ctx, "hello", 3)
        assert child["$iter"] == {"item": "hello", "index": 3}
        assert child["item"] == "hello"
        assert child["foo"] == "bar"

    def test_iteration_example_fixture_schema_valid(self) -> None:
        """The iteration-example.json fixture must be valid against the schema."""
        import json

        root = Path(__file__).resolve().parents[2]
        fixture_path = root / "schemas" / "test-fixtures" / "iteration-example.json"
        raw = json.loads(fixture_path.read_text(encoding="utf-8"))
        doc = GraphDocument.from_dict(raw)
        assert any(n.type == "iteration" for n in doc.nodes)
