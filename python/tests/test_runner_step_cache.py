# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import sys
from pathlib import Path

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.node_output_cache import StepCachePolicy
from graph_caster.runner import GraphRunner
from graph_caster.workspace import clear_graph_index_cache


def _linear_task_doc(gid: str, tmp: Path, *, cmd_suffix: str = "print(1)") -> GraphDocument:
    return GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "step-cache-linear"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "t1",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "command": [sys.executable, "-c", cmd_suffix],
                        "cwd": str(tmp),
                        "stepCache": True,
                    },
                },
                {"id": "x1", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "s1",
                    "sourceHandle": "out_default",
                    "target": "t1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e2",
                    "source": "t1",
                    "sourceHandle": "out_default",
                    "target": "x1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )


def test_second_run_uses_node_cache_hit_skips_process_spawn(tmp_path: Path) -> None:
    gid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    doc = _linear_task_doc(gid, tmp_path)
    pol = StepCachePolicy(enabled=True, dirty_nodes=frozenset())
    host = RunHostContext(artifacts_base=tmp_path)
    ev1: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev1.append(e), host=host, step_cache=pol).run()
    sp1 = sum(1 for e in ev1 if e.get("type") == "process_spawn" and e.get("nodeId") == "t1")
    assert sp1 == 1
    assert not any(e.get("type") == "node_cache_hit" for e in ev1)

    ev2: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev2.append(e), host=host, step_cache=pol).run()
    sp2 = sum(1 for e in ev2 if e.get("type") == "process_spawn" and e.get("nodeId") == "t1")
    assert sp2 == 0
    hits = [e for e in ev2 if e.get("type") == "node_cache_hit"]
    assert len(hits) == 1
    assert hits[0].get("nodeId") == "t1"
    assert hits[0].get("keyPrefix")
    assert hits[0]["type"] == "node_cache_hit"


def test_task_data_change_invalidates_cache(tmp_path: Path) -> None:
    gid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    doc_a = _linear_task_doc(gid, tmp_path, cmd_suffix="print('A')")
    pol = StepCachePolicy(enabled=True, dirty_nodes=frozenset())
    host = RunHostContext(artifacts_base=tmp_path)
    GraphRunner(doc_a, sink=lambda _: None, host=host, step_cache=pol).run()

    doc_b = _linear_task_doc(gid, tmp_path, cmd_suffix="print('B')")
    ev: list[dict] = []
    GraphRunner(doc_b, sink=lambda e: ev.append(e), host=host, step_cache=pol).run()
    assert any(e.get("type") == "node_cache_miss" for e in ev)
    assert not any(e.get("type") == "node_cache_hit" for e in ev)
    assert sum(1 for e in ev if e.get("type") == "process_spawn" and e.get("nodeId") == "t1") == 1


def test_step_cache_dirty_skips_hit(tmp_path: Path) -> None:
    gid = "ffffffff-ffff-4fff-8fff-ffffffffffff"
    doc = _linear_task_doc(gid, tmp_path)
    host = RunHostContext(artifacts_base=tmp_path)
    GraphRunner(
        doc,
        sink=lambda _: None,
        host=host,
        step_cache=StepCachePolicy(enabled=True, dirty_nodes=frozenset()),
    ).run()

    ev: list[dict] = []
    GraphRunner(
        doc,
        sink=lambda e: ev.append(e),
        host=host,
        step_cache=StepCachePolicy(enabled=True, dirty_nodes=frozenset({"t1"})),
    ).run()
    miss = [e for e in ev if e.get("type") == "node_cache_miss"]
    assert any(m.get("reason") == "dirty" for m in miss)
    assert not any(e.get("type") == "node_cache_hit" for e in ev)
    assert sum(1 for e in ev if e.get("type") == "process_spawn" and e.get("nodeId") == "t1") == 1


def test_step_cache_disabled_always_spawns(tmp_path: Path) -> None:
    gid = "10101010-1010-4101-8101-101010101010"
    doc = _linear_task_doc(gid, tmp_path)
    host = RunHostContext(artifacts_base=tmp_path)
    for _ in range(2):
        ev: list[dict] = []
        GraphRunner(doc, sink=lambda e: ev.append(e), host=host, step_cache=None).run()
        assert sum(1 for e in ev if e.get("type") == "process_spawn" and e.get("nodeId") == "t1") == 1
        assert not any(e.get("type") in ("node_cache_hit", "node_cache_miss") for e in ev)


def _nested_child_with_stepcache_task(gid: str, tmp: Path) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid, "title": "nested-stepcache"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "cs", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "nt",
                "type": "task",
                "position": {"x": 0, "y": 0},
                "data": {
                    "command": [sys.executable, "-c", "print(1)"],
                    "cwd": str(tmp),
                    "stepCache": True,
                },
            },
            {"id": "ce", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "c1",
                "source": "cs",
                "sourceHandle": "out_default",
                "target": "nt",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "c2",
                "source": "nt",
                "sourceHandle": "out_default",
                "target": "ce",
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }


def _parent_with_graph_ref(parent_id: str, child_id: str) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": parent_id, "title": "parent-stepcache"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "ps", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "pref",
                "type": "graph_ref",
                "position": {"x": 0, "y": 0},
                "data": {"targetGraphId": child_id},
            },
            {"id": "pe", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "p1",
                "source": "ps",
                "sourceHandle": "out_default",
                "target": "pref",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "p2",
                "source": "pref",
                "sourceHandle": "out_default",
                "target": "pe",
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }


def test_step_cache_dirty_parent_graph_ref_forces_nested_miss(tmp_path: Path) -> None:
    clear_graph_index_cache()
    child_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    parent_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    (tmp_path / "child.json").write_text(
        json.dumps(_nested_child_with_stepcache_task(child_id, tmp_path)),
        encoding="utf-8",
    )
    (tmp_path / "parent.json").write_text(
        json.dumps(_parent_with_graph_ref(parent_id, child_id)),
        encoding="utf-8",
    )

    root_doc = GraphDocument.from_dict(_parent_with_graph_ref(parent_id, child_id))
    host = RunHostContext(graphs_root=tmp_path, artifacts_base=tmp_path)
    pol_clean = StepCachePolicy(enabled=True, dirty_nodes=frozenset())
    ev1: list[dict] = []
    GraphRunner(root_doc, sink=lambda e: ev1.append(e), host=host, step_cache=pol_clean).run()
    sp1 = sum(
        1
        for e in ev1
        if e.get("type") == "process_spawn" and e.get("nodeId") == "nt" and e.get("graphId") == child_id
    )
    assert sp1 == 1

    ev2: list[dict] = []
    GraphRunner(
        root_doc,
        sink=lambda e: ev2.append(e),
        host=host,
        step_cache=StepCachePolicy(enabled=True, dirty_nodes=frozenset({"pref"})),
    ).run()
    miss_nt = [
        e
        for e in ev2
        if e.get("type") == "node_cache_miss" and e.get("nodeId") == "nt" and e.get("graphId") == child_id
    ]
    assert any(m.get("reason") == "dirty" for m in miss_nt)
    assert not any(e.get("type") == "node_cache_hit" for e in ev2)
    sp2 = sum(
        1
        for e in ev2
        if e.get("type") == "process_spawn" and e.get("nodeId") == "nt" and e.get("graphId") == child_id
    )
    assert sp2 == 1


def test_without_step_cache_flag_on_node_no_cache_events(tmp_path: Path) -> None:
    gid = "20202020-2020-4202-8202-202020202020"
    d = _linear_task_doc(gid, tmp_path)
    t1 = next(n for n in d.nodes if n.id == "t1")
    t1.data.pop("stepCache", None)
    pol = StepCachePolicy(enabled=True, dirty_nodes=frozenset())
    host = RunHostContext(artifacts_base=tmp_path)
    ev: list[dict] = []
    GraphRunner(d, sink=lambda e: ev.append(e), host=host, step_cache=pol).run()
    assert not any(e.get("type") in ("node_cache_hit", "node_cache_miss") for e in ev)
