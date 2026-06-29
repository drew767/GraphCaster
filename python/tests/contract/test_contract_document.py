# Copyright GraphCaster. All Rights Reserved.

"""Contract tests for graph_caster.contract.document.

These tests pin the pydantic-mirror to the JSON Schema and to the legacy
dataclass models so neither side can drift silently.
"""

from __future__ import annotations

import json
from pathlib import Path

from graph_caster.contract import SCHEMA_PATH, SCHEMA_VERSION
from graph_caster.contract.document import Document, Edge, Meta, Node, Viewport
from graph_caster.models import GraphDocument

REPO_ROOT = Path(__file__).resolve().parents[3]
EXAMPLE_PATH = REPO_ROOT / "schemas" / "graph-document.example.json"


def _load_example() -> dict:
    with EXAMPLE_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def test_meta_constants_pinned():
    assert SCHEMA_VERSION == "v1.20"
    assert SCHEMA_PATH == "schemas/graph-document.schema.json"


def test_pydantic_models_allow_extra():
    # Forward-compat guarantee: every contract model accepts unknown fields.
    for model_cls in (Document, Node, Edge, Meta, Viewport):
        assert model_cls.model_config.get("extra") == "allow", (
            f"{model_cls.__name__} must keep extra=allow for forward-compat"
        )


def test_example_roundtrip_through_contract():
    raw = _load_example()
    doc = Document.model_validate(raw)

    assert doc.schemaVersion == 1
    assert doc.meta is not None
    assert doc.meta.graphId == "a1b2c3d4-e5f6-4789-a012-3456789abcde"
    assert doc.meta.title == "Example start → task → exit"
    assert len(doc.nodes) == 3
    assert len(doc.edges) == 2

    node_ids = [n.id for n in doc.nodes]
    assert node_ids == ["start1", "t1", "exit1"]

    edge_ids = [e.id for e in doc.edges]
    assert edge_ids == ["e1", "e2"]
    # camelCase handles preserved verbatim from the schema example.
    assert doc.edges[0].sourceHandle == "out_default"
    assert doc.edges[0].targetHandle == "in_default"


def test_example_parity_with_legacy_models():
    raw = _load_example()
    legacy = GraphDocument.from_dict(raw)
    contract = Document.model_validate(raw)

    # Same node count / ids / types.
    assert [n.id for n in legacy.nodes] == [n.id for n in contract.nodes]
    assert [n.type for n in legacy.nodes] == [n.type for n in contract.nodes]

    # Same edge count / ids / endpoints. Handles are compared via the
    # legacy fallback (sourceHandle/source_handle either key).
    assert [e.id for e in legacy.edges] == [e.id for e in contract.edges]
    assert [e.source for e in legacy.edges] == [e.source for e in contract.edges]
    assert [e.target for e in legacy.edges] == [e.target for e in contract.edges]

    legacy_source_handles = [e.source_handle for e in legacy.edges]
    contract_source_handles = [
        (e.sourceHandle or e.source_handle or "out_default") for e in contract.edges
    ]
    assert legacy_source_handles == contract_source_handles


def test_unknown_top_level_field_preserved():
    raw = {
        "schemaVersion": 1,
        "nodes": [],
        "edges": [],
        "futureField": {"hello": "world"},
    }
    doc = Document.model_validate(raw)
    dumped = doc.model_dump(exclude_none=True)
    assert dumped.get("futureField") == {"hello": "world"}


def test_unknown_node_field_preserved():
    raw = {
        "schemaVersion": 1,
        "nodes": [
            {
                "id": "n1",
                "type": "task",
                "position": {"x": 0, "y": 0},
                "data": {},
                "experimentalFlag": True,
            }
        ],
        "edges": [],
    }
    doc = Document.model_validate(raw)
    dumped = doc.nodes[0].model_dump(exclude_none=True)
    assert dumped.get("experimentalFlag") is True
