# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]


def test_runner_linear_emits_ordered_events() -> None:
    example_path = GRAPH_CASTER_ROOT / "schemas" / "graph-document.example.json"
    raw = json.loads(example_path.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run_from("n1", context={"last_result": True})
    types = [e["type"] for e in events]
    assert types[:4] == ["node_enter", "node_execute", "node_exit", "edge_traverse"]
    assert any(e["type"] == "run_end" for e in events)
