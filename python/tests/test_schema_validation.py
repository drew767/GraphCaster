# Copyright GraphCaster. All Rights Reserved.

"""Tests for graph document schema (triggers and required fields)."""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = GRAPH_CASTER_ROOT / "schemas" / "graph-document.schema.json"


@pytest.fixture
def schema() -> dict:
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def validate_document(doc: dict, schema: dict) -> None:
    jsonschema.validate(instance=doc, schema=schema)


def _edge(eid: str, src: str, tgt: str) -> dict:
    return {
        "id": eid,
        "source": src,
        "target": tgt,
        "sourceHandle": "out_default",
        "targetHandle": "in_default",
        "condition": None,
    }


def test_trigger_webhook_type_documented_in_schema(schema: dict) -> None:
    node_def = schema.get("$defs", {}).get("node", {})
    type_prop = node_def.get("properties", {}).get("type", {})
    description = type_prop.get("description", "")
    assert "trigger_webhook" in description


def test_trigger_schedule_type_documented_in_schema(schema: dict) -> None:
    node_def = schema.get("$defs", {}).get("node", {})
    type_prop = node_def.get("properties", {}).get("type", {})
    description = type_prop.get("description", "")
    assert "trigger_schedule" in description


def test_schema_includes_trigger_data_defs(schema: dict) -> None:
    defs = schema.get("$defs", {})
    assert "triggerWebhookData" in defs
    assert "triggerScheduleData" in defs


def test_trigger_webhook_document_validates(schema: dict) -> None:
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    doc = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid, "title": "tw"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {
                "id": "trigger-1",
                "type": "trigger_webhook",
                "position": {"x": 0, "y": 0},
                "data": {"path": "/webhook/test", "method": "POST"},
            },
            {"id": "exit-1", "type": "exit", "position": {"x": 200, "y": 0}, "data": {}},
        ],
        "edges": [_edge("e1", "trigger-1", "exit-1")],
    }
    validate_document(doc, schema)


def test_trigger_schedule_document_validates(schema: dict) -> None:
    gid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    doc = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid, "title": "ts"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {
                "id": "trigger-1",
                "type": "trigger_schedule",
                "position": {"x": 0, "y": 0},
                "data": {"cron": "0 * * * *"},
            },
            {"id": "exit-1", "type": "exit", "position": {"x": 200, "y": 0}, "data": {}},
        ],
        "edges": [_edge("e1", "trigger-1", "exit-1")],
    }
    validate_document(doc, schema)


def test_invalid_document_missing_schema_version_fails(schema: dict) -> None:
    doc = {"nodes": [], "edges": []}
    with pytest.raises(jsonschema.ValidationError):
        validate_document(doc, schema)
