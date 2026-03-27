# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]


def test_example_document_matches_schema() -> None:
    schema_path = GRAPH_CASTER_ROOT / "schemas" / "graph-document.schema.json"
    example_path = GRAPH_CASTER_ROOT / "schemas" / "graph-document.example.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    instance = json.loads(example_path.read_text(encoding="utf-8"))
    jsonschema.validate(instance=instance, schema=schema)


def test_schema_rejects_edge_with_missing_target() -> None:
    schema_path = GRAPH_CASTER_ROOT / "schemas" / "graph-document.schema.json"
    example_path = GRAPH_CASTER_ROOT / "schemas" / "graph-document.example.json"
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    doc = json.loads(example_path.read_text(encoding="utf-8"))
    bad = json.loads(json.dumps(doc))
    bad["edges"] = [{"id": "x", "source": "start1"}]
    with pytest.raises(jsonschema.ValidationError):
        jsonschema.validate(instance=bad, schema=schema)
