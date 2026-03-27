# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

from graph_caster.document_revision import graph_document_revision
from graph_caster.models import GraphDocument

_ROOT = Path(__file__).resolve().parents[2]
_FIXTURE = _ROOT / "schemas" / "test-fixtures" / "handle-ok.json"


def test_graph_document_revision_stable_under_node_reorder() -> None:
    raw = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    a = GraphDocument.from_dict(raw)
    raw2 = deepcopy(raw)
    nodes = raw2["nodes"]
    raw2["nodes"] = list(reversed(nodes))
    b = GraphDocument.from_dict(raw2)
    assert graph_document_revision(a) == graph_document_revision(b)


def test_graph_document_revision_changes_when_task_data_changes() -> None:
    raw = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    a = GraphDocument.from_dict(raw)
    raw2 = deepcopy(raw)
    for n in raw2["nodes"]:
        if n["id"] == "t1":
            n["data"] = {"command": "whoami"}
            break
    b = GraphDocument.from_dict(raw2)
    assert graph_document_revision(a) != graph_document_revision(b)
