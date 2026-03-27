# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

from graph_caster.artifacts import create_root_run_artifact_dir
from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner
from graph_caster.workspace import clear_graph_index_cache

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]


def test_create_root_run_artifact_dir_layout(tmp_path: Path) -> None:
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    d = create_root_run_artifact_dir(tmp_path, gid)
    assert d.is_dir()
    assert d.parent == tmp_path / "runs" / gid
    assert d.name.count("_") >= 1


def test_run_root_ready_emitted_and_dir_exists(tmp_path: Path) -> None:
    example_path = GRAPH_CASTER_ROOT / "schemas" / "graph-document.example.json"
    raw = json.loads(example_path.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    gid = doc.graph_id
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e), host=RunHostContext(artifacts_base=tmp_path)).run(
        context={"last_result": True}
    )
    ready = [e for e in events if e["type"] == "run_root_ready"]
    assert len(ready) == 1
    assert ready[0]["rootGraphId"] == gid
    path = Path(ready[0]["rootRunArtifactDir"])
    assert path.is_dir()
    assert path.parent.parent == tmp_path / "runs"
    assert path.parent.name == gid


def test_nested_graph_ref_shares_root_run_artifact_dir(tmp_path: Path) -> None:
    clear_graph_index_cache()
    graphs = tmp_path / "graphs"
    arts = tmp_path / "ws"
    graphs.mkdir()
    child_id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    parent_id = "ffffffff-ffff-4fff-8fff-ffffffffffff"

    def chain(graph_id: str, start: str, mid: str, end: str, *, mid_type: str, mid_data: dict) -> dict:
        return {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": graph_id, "title": graph_id[:8]},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": start, "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": mid, "type": mid_type, "position": {"x": 0, "y": 0}, "data": mid_data},
                {"id": end, "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "k1",
                    "source": start,
                    "sourceHandle": "out_default",
                    "target": mid,
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "k2",
                    "source": mid,
                    "sourceHandle": "out_default",
                    "target": end,
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }

    (graphs / "child.json").write_text(
        json.dumps(chain(child_id, "cs", "ct", "ce", mid_type="task", mid_data={"t": 1})),
        encoding="utf-8",
    )
    parent = chain(
        parent_id,
        "ps",
        "pref",
        "pe",
        mid_type="graph_ref",
        mid_data={"targetGraphId": child_id},
    )
    (graphs / "parent.json").write_text(json.dumps(parent), encoding="utf-8")
    root_doc = GraphDocument.from_dict(parent)
    events: list[dict] = []
    GraphRunner(
        root_doc,
        sink=lambda e: events.append(e),
        host=RunHostContext(graphs_root=graphs, artifacts_base=arts),
    ).run(context={"last_result": True})
    assert sum(1 for e in events if e["type"] == "run_root_ready") == 1
    nested = next(e for e in events if e["type"] == "nested_graph_enter")
    root_ready = next(e for e in events if e["type"] == "run_root_ready")
    assert nested.get("rootRunArtifactDir") == root_ready["rootRunArtifactDir"]
    assert Path(root_ready["rootRunArtifactDir"]).is_dir()
