# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

import pytest

from graph_caster.models import Edge, GraphDocument, Node
from graph_caster.validate import (
    GraphStructureError,
    find_unreachable_out_error_sources,
    validate_graph_structure,
)

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]


def _load_example() -> GraphDocument:
    p = GRAPH_CASTER_ROOT / "schemas" / "graph-document.example.json"
    return GraphDocument.from_dict(json.loads(p.read_text(encoding="utf-8")))


def test_validate_example_ok() -> None:
    doc = _load_example()
    assert validate_graph_structure(doc) == "start1"


def test_validate_rejects_two_starts() -> None:
    doc = _load_example()
    doc.nodes.append(Node(id="start2", type="start", position={"x": 0, "y": 0}, data={}))
    with pytest.raises(GraphStructureError, match="exactly one"):
        validate_graph_structure(doc)


def test_validate_rejects_incoming_edge_to_start() -> None:
    doc = _load_example()
    doc.edges.append(
        Edge(
            id="bad",
            source="t1",
            source_handle="out_default",
            target="start1",
            target_handle="in_default",
            condition=None,
        )
    )
    with pytest.raises(GraphStructureError, match="incoming"):
        validate_graph_structure(doc)


def test_validate_rejects_missing_graph_id() -> None:
    raw = json.loads((GRAPH_CASTER_ROOT / "schemas" / "graph-document.example.json").read_text(encoding="utf-8"))
    raw["meta"] = {"schemaVersion": 1}
    doc = GraphDocument.from_dict(raw)
    with pytest.raises(GraphStructureError, match="graphId"):
        validate_graph_structure(doc)


def test_find_unreachable_out_error_sources_flags_start_and_task_without_command() -> None:
    gid = "ffffffff-ffff-4fff-8fff-ffffffffffff"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "t"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "t0", "type": "task", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "bad1",
                    "source": "s1",
                    "sourceHandle": "out_error",
                    "target": "t0",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "bad2",
                    "source": "t0",
                    "sourceHandle": "out_error",
                    "target": "s1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )
    ids = find_unreachable_out_error_sources(doc)
    assert set(ids) == {"s1", "t0"}
