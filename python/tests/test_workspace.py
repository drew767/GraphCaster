# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

import pytest

from graph_caster.workspace import (
    WorkspaceIndexError,
    clear_graph_index_cache,
    resolve_graph_path,
    scan_graphs_directory,
)


def _minimal_graph(graph_id: str, *, start: str = "s", task: str | None = None, exit_id: str = "x") -> dict:
    nodes = [{"id": start, "type": "start", "position": {"x": 0, "y": 0}, "data": {}}]
    edges: list[dict] = []
    cur = start
    if task is not None:
        nodes.append({"id": task, "type": "task", "position": {"x": 0, "y": 0}, "data": {}})
        edges.append(
            {
                "id": "e0",
                "source": cur,
                "sourceHandle": "out_default",
                "target": task,
                "targetHandle": "in_default",
                "condition": None,
            }
        )
        cur = task
    nodes.append({"id": exit_id, "type": "exit", "position": {"x": 0, "y": 0}, "data": {}})
    edges.append(
        {
            "id": "e1",
            "source": cur,
            "sourceHandle": "out_default",
            "target": exit_id,
            "targetHandle": "in_default",
            "condition": None,
        }
    )
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": "t"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": nodes,
        "edges": edges,
    }


def test_scan_maps_graph_id_to_path(tmp_path: Path) -> None:
    clear_graph_index_cache()
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    p = tmp_path / "a.json"
    p.write_text(json.dumps(_minimal_graph(gid)), encoding="utf-8")
    idx = scan_graphs_directory(tmp_path)
    assert idx[gid] == p


def test_scan_duplicate_graph_id_raises(tmp_path: Path) -> None:
    clear_graph_index_cache()
    gid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    (tmp_path / "one.json").write_text(json.dumps(_minimal_graph(gid)), encoding="utf-8")
    (tmp_path / "two.json").write_text(json.dumps(_minimal_graph(gid)), encoding="utf-8")
    with pytest.raises(WorkspaceIndexError, match="duplicate graphId"):
        scan_graphs_directory(tmp_path)


def test_resolve_graph_path_refreshes_when_directory_changes(tmp_path: Path) -> None:
    clear_graph_index_cache()
    g1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    (tmp_path / "first.json").write_text(json.dumps(_minimal_graph(g1)), encoding="utf-8")
    assert resolve_graph_path(tmp_path, g1) == tmp_path / "first.json"
    g2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    (tmp_path / "second.json").write_text(json.dumps(_minimal_graph(g2)), encoding="utf-8")
    assert resolve_graph_path(tmp_path, g2) == tmp_path / "second.json"
    clear_graph_index_cache()
    assert resolve_graph_path(tmp_path, g2) == tmp_path / "second.json"


def test_resolve_graph_path_refreshes_after_in_place_file_edit(tmp_path: Path) -> None:
    clear_graph_index_cache()
    g1 = "11111111-1111-4111-8111-111111111111"
    g2 = "22222222-2222-4222-8222-222222222222"
    path = tmp_path / "only.json"
    path.write_text(json.dumps(_minimal_graph(g1)), encoding="utf-8")
    assert resolve_graph_path(tmp_path, g1) == path
    assert resolve_graph_path(tmp_path, g2) is None
    path.write_text(json.dumps(_minimal_graph(g2)), encoding="utf-8")
    assert resolve_graph_path(tmp_path, g1) is None
    assert resolve_graph_path(tmp_path, g2) == path
