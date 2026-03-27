# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import pytest

from graph_caster.models import GraphDocument


def test_node_without_type_is_unknown() -> None:
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
            "nodes": [{"id": "n1", "position": {"x": 0, "y": 0}, "data": {}}],
            "edges": [],
        }
    )
    assert doc.nodes[0].type == "unknown"


def test_edge_condition_bool_normalizes() -> None:
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [{"id": "e", "source": "s", "target": "x", "condition": False}],
        }
    )
    assert doc.edges[0].condition == "false"


def test_edge_condition_non_scalar_becomes_none() -> None:
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc"},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [{"id": "e", "source": "s", "target": "x", "condition": {"nested": True}}],
        }
    )
    assert doc.edges[0].condition is None


def test_node_missing_id_raises() -> None:
    with pytest.raises(ValueError, match="nodes\\[0\\]"):
        GraphDocument.from_dict(
            {
                "schemaVersion": 1,
                "meta": {"schemaVersion": 1, "graphId": "dddddddd-dddd-4ddd-8ddd-dddddddddddd"},
                "nodes": [{"position": {"x": 0, "y": 0}, "data": {}}],
                "edges": [],
            }
        )


def test_edge_missing_target_raises() -> None:
    with pytest.raises(ValueError, match="edges\\[0\\]"):
        GraphDocument.from_dict(
            {
                "schemaVersion": 1,
                "meta": {"schemaVersion": 1, "graphId": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"},
                "nodes": [
                    {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                    {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
                ],
                "edges": [{"id": "e", "source": "s"}],
            }
        )


def test_nodes_must_be_array() -> None:
    with pytest.raises(ValueError, match="'nodes' must be an array"):
        GraphDocument.from_dict(
            {
                "schemaVersion": 1,
                "meta": {"schemaVersion": 1, "graphId": "ffffffff-ffff-4fff-8fff-ffffffffffff"},
                "nodes": {},
                "edges": [],
            }
        )


def test_root_must_be_object() -> None:
    with pytest.raises(ValueError, match="root must be"):
        GraphDocument.from_dict([])  # type: ignore[arg-type]


def test_meta_must_be_object_if_present() -> None:
    with pytest.raises(ValueError, match="'meta'"):
        GraphDocument.from_dict(
            {
                "schemaVersion": 1,
                "meta": "broken",
                "nodes": [],
                "edges": [],
            }
        )


def test_node_data_must_be_object() -> None:
    with pytest.raises(ValueError, match="nodes\\[0\\].data"):
        GraphDocument.from_dict(
            {
                "schemaVersion": 1,
                "meta": {"schemaVersion": 1, "graphId": "99999999-9999-4999-8999-999999999999"},
                "nodes": [{"id": "x", "type": "task", "position": {"x": 0, "y": 0}, "data": []}],
                "edges": [],
            }
        )


def test_viewport_must_be_object() -> None:
    with pytest.raises(ValueError, match="'viewport'"):
        GraphDocument.from_dict(
            {
                "schemaVersion": 1,
                "meta": {"schemaVersion": 1, "graphId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
                "viewport": [],
                "nodes": [],
                "edges": [],
            }
        )


def test_schema_version_must_be_integer() -> None:
    with pytest.raises(ValueError, match="schemaVersion"):
        GraphDocument.from_dict(
            {
                "meta": {"schemaVersion": "not-a-number", "graphId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"},
                "nodes": [],
                "edges": [],
            }
        )


def test_schema_version_zero_preserved_not_replaced_by_default() -> None:
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 0,
            "meta": {"graphId": "10101010-1010-4101-8101-101010101010"},
            "nodes": [],
            "edges": [],
        }
    )
    assert doc.schema_version == 0


def test_schema_version_zero_in_meta_preserved() -> None:
    doc = GraphDocument.from_dict(
        {
            "meta": {"schemaVersion": 0, "graphId": "20202020-2020-4202-8202-202020202020"},
            "nodes": [],
            "edges": [],
        }
    )
    assert doc.schema_version == 0


def test_missing_nodes_and_edges_default_empty() -> None:
    doc = GraphDocument.from_dict(
        {
            "meta": {"schemaVersion": 1, "graphId": "30303030-3030-4303-8303-303030303030"},
        }
    )
    assert doc.nodes == []
    assert doc.edges == []


def test_node_type_number_coerced_to_string() -> None:
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": "40404040-4040-4404-8404-404040404040"},
            "nodes": [{"id": "n1", "type": 42, "position": {"x": 0, "y": 0}, "data": {}}],
            "edges": [],
        }
    )
    assert doc.nodes[0].type == "42"


def test_graph_id_numeric_zero_is_preserved_not_default() -> None:
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": 0},
            "nodes": [],
            "edges": [],
        }
    )
    assert doc.graph_id == "0"


def test_edge_empty_source_handle_falls_back_to_snake_then_default() -> None:
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": "50505050-5050-4505-8505-505050505050"},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "t", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "s",
                    "target": "t",
                    "sourceHandle": "",
                    "source_handle": "alt_out",
                },
            ],
        }
    )
    assert doc.edges[0].source_handle == "alt_out"


def test_edge_both_handles_empty_becomes_default() -> None:
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": "60606060-6060-4606-8606-606060606060"},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "t", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "s",
                    "target": "t",
                    "sourceHandle": "",
                    "targetHandle": "   ",
                },
            ],
        }
    )
    assert doc.edges[0].source_handle == "out_default"
    assert doc.edges[0].target_handle == "in_default"


def test_edge_handle_nan_and_inf_skipped_to_default() -> None:
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": "80808080-8080-4808-8808-808080808080"},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "t", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "s",
                    "target": "t",
                    "sourceHandle": float("nan"),
                    "targetHandle": float("inf"),
                },
            ],
        }
    )
    assert doc.edges[0].source_handle == "out_default"
    assert doc.edges[0].target_handle == "in_default"


def test_meta_author_and_title_coerced_with_str() -> None:
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {
                "schemaVersion": 1,
                "graphId": "70707070-7070-4707-8707-707070707070",
                "author": 99,
                "title": False,
            },
            "nodes": [],
            "edges": [],
        }
    )
    assert doc.author == "99"
    assert doc.title == "False"
