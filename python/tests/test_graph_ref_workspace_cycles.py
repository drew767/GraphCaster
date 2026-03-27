# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

from graph_caster.graph_ref_workspace import (
    build_workspace_graph_ref_adjacency,
    find_workspace_graph_ref_cycle,
)


def _doc(gid: str, target: str | None) -> dict:
    if target is None:
        nodes = [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ]
        edges = [
            {
                "id": "e0",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
            },
        ]
    else:
        nodes = [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "r",
                "type": "graph_ref",
                "position": {"x": 0, "y": 0},
                "data": {"targetGraphId": target},
            },
            {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ]
        edges = [
            {
                "id": "e0",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "r",
                "targetHandle": "in_default",
            },
            {
                "id": "e1",
                "source": "r",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
            },
        ]
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid},
        "nodes": nodes,
        "edges": edges,
    }


def _write(tmp: Path, name: str, doc: dict) -> None:
    (tmp / name).write_text(json.dumps(doc, indent=2), encoding="utf-8")


def test_no_graph_ref_no_cycle(tmp_path: Path) -> None:
    ga = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    _write(tmp_path, "a.json", _doc(ga, None))
    adj = build_workspace_graph_ref_adjacency(tmp_path)
    assert adj[ga] == []
    assert find_workspace_graph_ref_cycle(adj) is None


def test_linear_chain_no_cycle(tmp_path: Path) -> None:
    ga = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    gb = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    gc = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    _write(tmp_path, "a.json", _doc(ga, gb))
    _write(tmp_path, "b.json", _doc(gb, gc))
    _write(tmp_path, "c.json", _doc(gc, None))
    adj = build_workspace_graph_ref_adjacency(tmp_path)
    assert find_workspace_graph_ref_cycle(adj) is None


def test_three_cycle_abc(tmp_path: Path) -> None:
    ga = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    gb = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    gc = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    _write(tmp_path, "a.json", _doc(ga, gb))
    _write(tmp_path, "b.json", _doc(gb, gc))
    _write(tmp_path, "c.json", _doc(gc, ga))
    adj = build_workspace_graph_ref_adjacency(tmp_path)
    cyc = find_workspace_graph_ref_cycle(adj)
    assert cyc is not None
    assert set(cyc) == {ga, gb, gc}
    assert len(cyc) == 3


def test_self_loop(tmp_path: Path) -> None:
    ga = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    _write(tmp_path, "a.json", _doc(ga, ga))
    adj = build_workspace_graph_ref_adjacency(tmp_path)
    cyc = find_workspace_graph_ref_cycle(adj)
    assert cyc == [ga]


def test_duplicate_ref_edges_deduped_in_adjacency(tmp_path: Path) -> None:
    ga = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    gb = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    doc = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": ga},
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "r1",
                "type": "graph_ref",
                "position": {"x": 0, "y": 0},
                "data": {"targetGraphId": gb},
            },
            {
                "id": "r2",
                "type": "graph_ref",
                "position": {"x": 0, "y": 0},
                "data": {"graphId": gb},
            },
            {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e0",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "r1",
                "targetHandle": "in_default",
            },
            {
                "id": "e1",
                "source": "r1",
                "sourceHandle": "out_default",
                "target": "r2",
                "targetHandle": "in_default",
            },
            {
                "id": "e2",
                "source": "r2",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
            },
        ],
    }
    _write(tmp_path, "a.json", doc)
    _write(tmp_path, "b.json", _doc(gb, None))
    adj = build_workspace_graph_ref_adjacency(tmp_path)
    assert adj[ga] == [gb]
    assert find_workspace_graph_ref_cycle(adj) is None
