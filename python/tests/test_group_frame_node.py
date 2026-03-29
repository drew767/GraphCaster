# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from typing import Any

from graph_caster.models import GraphDocument, Edge, Node, is_editor_frame_node_type
from graph_caster.runner import GraphRunner
from graph_caster.validate import find_unreachable_non_comment_nodes, find_unreachable_non_frame_nodes


def test_find_unreachable_non_comment_alias_matches_non_frame() -> None:
    gid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    raw: dict[str, Any] = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid},
        "nodes": [
            {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "t1", "type": "task", "position": {"x": 0, "y": 0}, "data": {"command": "true"}},
        ],
        "edges": [],
    }
    doc = GraphDocument.from_dict(raw)
    assert find_unreachable_non_comment_nodes(doc, "s1") == find_unreachable_non_frame_nodes(doc, "s1")


def test_is_editor_frame_node_type() -> None:
    assert is_editor_frame_node_type("comment")
    assert is_editor_frame_node_type("group")
    assert not is_editor_frame_node_type("task")


def test_find_unreachable_ignores_group_frames() -> None:
    gid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    raw: dict[str, Any] = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid},
        "nodes": [
            {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "g1", "type": "group", "position": {"x": 0, "y": 0}, "data": {"title": "G"}},
            {"id": "t1", "type": "task", "position": {"x": 10, "y": 10}, "data": {"command": "true"}},
            {"id": "e1", "type": "exit", "position": {"x": 100, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e_s_t",
                "source": "s1",
                "target": "t1",
                "sourceHandle": "out_default",
                "targetHandle": "in_default",
            },
            {
                "id": "e_t_e",
                "source": "t1",
                "target": "e1",
                "sourceHandle": "out_default",
                "targetHandle": "in_default",
            },
        ],
    }
    doc = GraphDocument.from_dict(raw)
    assert find_unreachable_non_frame_nodes(doc, "s1") == []


def test_runner_skips_group_frames_along_chain() -> None:
    """Same as comment: group nodes may appear in edge chains without blocking run."""
    gid = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    nodes: list[Node] = [
        Node(id="start1", type="start", position={"x": 0, "y": 0}, data={}),
    ]
    edges: list[Edge] = []
    prev = "start1"
    for i in range(2):
        nid = f"g{i}"
        nodes.append(Node(id=nid, type="group", position={"x": 0, "y": 0}, data={}))
        edges.append(
            Edge(
                id=f"e_{prev}_{nid}",
                source=prev,
                target=nid,
                source_handle="out_default",
                target_handle="in_default",
                condition=None,
            )
        )
        prev = nid
    nodes.append(Node(id="exit1", type="exit", position={"x": 0, "y": 0}, data={}))
    edges.append(
        Edge(
            id=f"e_{prev}_exit1",
            source=prev,
            target="exit1",
            source_handle="out_default",
            target_handle="in_default",
            condition=None,
        )
    )
    doc = GraphDocument(
        schema_version=1,
        graph_id=gid,
        title=None,
        author=None,
        viewport={"x": 0, "y": 0, "zoom": 1},
        nodes=nodes,
        edges=edges,
    )
    events: list[dict[str, Any]] = []
    runner = GraphRunner(doc, sink=lambda e: events.append(e))
    runner.run(context={"last_result": True})
    finished = [e for e in events if e.get("type") == "run_finished"]
    assert len(finished) == 1
    assert finished[0].get("status") == "success"
