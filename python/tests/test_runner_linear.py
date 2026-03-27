# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]


def test_runner_reaches_exit_with_run_success() -> None:
    example_path = GRAPH_CASTER_ROOT / "schemas" / "graph-document.example.json"
    raw = json.loads(example_path.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    types = [e["type"] for e in events]
    assert "run_success" in types
    assert events[-1]["type"] == "run_success"
    assert events[-1].get("nodeId") == "exit1"
