# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from pathlib import Path

import pytest

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner


def test_run_host_context_resolves_paths(tmp_path: Path) -> None:
    sub = tmp_path / "graphs"
    sub.mkdir()
    host = RunHostContext(graphs_root=sub)
    assert host.graphs_root is not None
    assert host.graphs_root == sub.resolve()
    assert host.artifacts_base is None


def _minimal_linear_doc(graph_id: str) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": "x"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
                "condition": None,
            }
        ],
    }


def test_legacy_artifacts_base_in_context_ignored_without_host(tmp_path: Path) -> None:
    gid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    doc = GraphDocument.from_dict(_minimal_linear_doc(gid))
    ctx: dict[str, object] = {"last_result": True, "artifacts_base": tmp_path}
    events: list = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context=ctx)
    assert "artifacts_base" not in ctx
    assert "graphs_root" not in ctx
    assert not any(e.get("type") == "run_root_ready" for e in events)


def test_graph_runner_rejects_host_and_graphs_root_together(tmp_path: Path) -> None:
    gid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    doc = GraphDocument.from_dict(_minimal_linear_doc(gid))
    with pytest.raises(ValueError, match="pass only one of host= or graphs_root="):
        GraphRunner(
            doc,
            host=RunHostContext(artifacts_base=tmp_path),
            graphs_root=tmp_path,
        )


def test_linear_run_with_host_artifacts_base_emits_run_root_ready(tmp_path: Path) -> None:
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    doc = GraphDocument.from_dict(_minimal_linear_doc(gid))
    events: list = []
    GraphRunner(
        doc,
        sink=lambda e: events.append(e),
        host=RunHostContext(artifacts_base=tmp_path),
    ).run(context={"last_result": True})
    ready = [e for e in events if e.get("type") == "run_root_ready"]
    assert len(ready) == 1
    rrd = Path(ready[0]["rootRunArtifactDir"])
    assert rrd.is_dir()
    assert rrd.resolve().is_relative_to(tmp_path.resolve())
