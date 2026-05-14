# Copyright GraphCaster. All Rights Reserved.

"""Tests for ai_builder.validator (F91)."""

from __future__ import annotations

import pytest

from graph_caster.ai_builder.validator import validate_graph


def _minimal_valid() -> dict:
    return {
        "schemaVersion": 1,
        "nodes": [
            {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "x1", "type": "exit", "position": {"x": 100, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "s1",
                "target": "x1",
                "sourceHandle": "out_default",
                "targetHandle": "in_default",
            }
        ],
    }


class TestValidateGraphStartExit:
    def test_valid_graph_returns_no_errors(self) -> None:
        errs = validate_graph(_minimal_valid())
        assert errs == [], f"Expected no errors, got: {errs}"

    def test_missing_start_returns_error(self) -> None:
        g = _minimal_valid()
        g["nodes"] = [n for n in g["nodes"] if n["type"] != "start"]
        g["edges"] = []
        errs = validate_graph(g)
        assert any("start" in e for e in errs), f"Expected start-node error, got: {errs}"

    def test_missing_exit_returns_error(self) -> None:
        g = _minimal_valid()
        g["nodes"] = [n for n in g["nodes"] if n["type"] != "exit"]
        g["edges"] = []
        errs = validate_graph(g)
        assert any("exit" in e for e in errs), f"Expected exit-node error, got: {errs}"

    def test_two_start_nodes_returns_error(self) -> None:
        g = _minimal_valid()
        g["nodes"].append({"id": "s2", "type": "start", "position": {"x": 50, "y": 0}, "data": {}})
        errs = validate_graph(g)
        assert any("start" in e and "2" in e for e in errs), f"Got: {errs}"


class TestValidateDuplicateNodeIds:
    def test_duplicate_node_ids_returns_error(self) -> None:
        g = _minimal_valid()
        g["nodes"].append({"id": "s1", "type": "task", "position": {"x": 200, "y": 0}, "data": {}})
        errs = validate_graph(g)
        assert any("duplicate" in e.lower() and "s1" in e for e in errs), f"Got: {errs}"

    def test_unique_ids_ok(self) -> None:
        g = _minimal_valid()
        errs = validate_graph(g)
        assert not any("duplicate" in e.lower() for e in errs)


class TestValidateEdgeReferences:
    def test_edge_referencing_nonexistent_source_returns_error(self) -> None:
        g = _minimal_valid()
        g["edges"].append(
            {"id": "e_bad", "source": "ghost_node", "target": "x1"}
        )
        errs = validate_graph(g)
        assert any("ghost_node" in e and "source" in e for e in errs), f"Got: {errs}"

    def test_edge_referencing_nonexistent_target_returns_error(self) -> None:
        g = _minimal_valid()
        g["edges"].append(
            {"id": "e_bad", "source": "s1", "target": "no_such_node"}
        )
        errs = validate_graph(g)
        assert any("no_such_node" in e and "target" in e for e in errs), f"Got: {errs}"

    def test_valid_edges_return_no_error(self) -> None:
        g = _minimal_valid()
        errs = validate_graph(g)
        assert not any("source" in e or "target" in e for e in errs)


class TestValidateCycles:
    def test_cycle_outside_loop_returns_error(self) -> None:
        """A→B→A cycle in a plain graph (not inside loop/iteration) is rejected."""
        g = {
            "schemaVersion": 1,
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "a", "type": "task", "position": {"x": 100, "y": 0}, "data": {}},
                {"id": "b", "type": "task", "position": {"x": 200, "y": 0}, "data": {}},
                {"id": "x1", "type": "exit", "position": {"x": 300, "y": 0}, "data": {}},
            ],
            "edges": [
                {"id": "e1", "source": "s1", "target": "a"},
                {"id": "e2", "source": "a", "target": "b"},
                {"id": "e3", "source": "b", "target": "a"},
                {"id": "e4", "source": "a", "target": "x1"},
            ],
        }
        errs = validate_graph(g)
        assert any("cycle" in e.lower() for e in errs), f"Expected cycle error, got: {errs}"

    def test_cycle_inside_loop_subgraph_is_allowed(self) -> None:
        """Edges between nodes that share a loop container parentId are allowed."""
        g = {
            "schemaVersion": 1,
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "lp", "type": "loop", "position": {"x": 100, "y": 0}, "data": {"maxIterations": 10}},
                {
                    "id": "body_a",
                    "type": "task",
                    "position": {"x": 150, "y": 0},
                    "data": {},
                    "parentId": "lp",
                },
                {
                    "id": "body_b",
                    "type": "task",
                    "position": {"x": 200, "y": 0},
                    "data": {},
                    "parentId": "lp",
                },
                {"id": "x1", "type": "exit", "position": {"x": 300, "y": 0}, "data": {}},
            ],
            "edges": [
                {"id": "e0", "source": "s1", "target": "lp"},
                {"id": "e1", "source": "body_a", "target": "body_b"},
                {"id": "e2", "source": "body_b", "target": "body_a"},
                {"id": "e3", "source": "lp", "target": "x1"},
            ],
        }
        errs = validate_graph(g)
        cycle_errors = [e for e in errs if "cycle" in e.lower()]
        assert cycle_errors == [], f"Should allow loop-internal cycles; got: {cycle_errors}"

    def test_simple_linear_graph_no_cycle(self) -> None:
        errs = validate_graph(_minimal_valid())
        assert not any("cycle" in e.lower() for e in errs)
