# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner

_REPO_ROOT = Path(__file__).resolve().parents[2]
_EXAMPLE = _REPO_ROOT / "schemas" / "graph-document.example.json"


def test_example_graph_event_type_order_unchanged() -> None:
    raw = json.loads(_EXAMPLE.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    types: list[str] = []
    GraphRunner(doc, sink=lambda e: types.append(e["type"]), host=RunHostContext()).run()
    assert types == [
        "run_started",
        "node_enter",
        "node_execute",
        "node_exit",
        "edge_traverse",
        "node_enter",
        "node_execute",
        "node_exit",
        "edge_traverse",
        "node_enter",
        "node_execute",
        "node_exit",
        "run_success",
        "run_finished",
    ]
