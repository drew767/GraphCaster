# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

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


def _llm_agent_ok_script() -> str:
    return (
        "import json,sys\n"
        "j=json.loads(sys.stdin.readline())\n"
        "sys.stdout.write(json.dumps({'type':'agent_delegate_start'})+'\\n')\n"
        "sys.stdout.write(json.dumps({'type':'agent_finished','result':{'k':j.get('inputPayload',{}).get('v')}})+'\\n')\n"
        "sys.stdout.flush()\n"
    )


def _linear_llm_agent_step_cache_doc(
    gid: str,
    tmp: Path,
    *,
    input_v: int | None = None,
    step_cache: bool = True,
) -> GraphDocument:
    data: dict = {
        "title": "Agent",
        "command": [sys.executable, "-c", _llm_agent_ok_script()],
        "cwd": str(tmp),
        "timeoutSec": 30,
        "maxAgentSteps": 0,
    }
    if step_cache:
        data["stepCache"] = True
    if input_v is not None:
        data["inputPayload"] = {"v": input_v}
    return GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "llm step-cache"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "a1", "type": "llm_agent", "position": {"x": 0, "y": 0}, "data": data},
                {"id": "x1", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "s1",
                    "sourceHandle": "out_default",
                    "target": "a1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e2",
                    "source": "a1",
                    "sourceHandle": "out_default",
                    "target": "x1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )


def test_second_run_llm_agent_step_cache_hit_skips_spawn(tmp_path: Path) -> None:
    gid = "b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2"
    doc = _linear_llm_agent_step_cache_doc(gid, tmp_path, input_v=1)
    pol = StepCachePolicy(enabled=True, dirty_nodes=frozenset())
    host = RunHostContext(artifacts_base=tmp_path)
    ev1: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev1.append(e), host=host, step_cache=pol).run()
    sp1 = sum(1 for e in ev1 if e.get("type") == "process_spawn" and e.get("nodeId") == "a1")
    assert sp1 == 1
    assert not any(e.get("type") == "node_cache_hit" for e in ev1)

    ev2: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev2.append(e), host=host, step_cache=pol).run()
    sp2 = sum(1 for e in ev2 if e.get("type") == "process_spawn" and e.get("nodeId") == "a1")
    assert sp2 == 0
    hits = [e for e in ev2 if e.get("type") == "node_cache_hit"]
    assert len(hits) == 1
    assert hits[0].get("nodeId") == "a1"
    assert hits[0].get("keyPrefix")


def test_llm_agent_step_cache_input_payload_change_invalidates(tmp_path: Path) -> None:
    gid = "c2c2c2c2-c2c2-42c2-82c2-c2c2c2c2c2c2"
    doc_a = _linear_llm_agent_step_cache_doc(gid, tmp_path, input_v=1)
    pol = StepCachePolicy(enabled=True, dirty_nodes=frozenset())
    host = RunHostContext(artifacts_base=tmp_path)
    GraphRunner(doc_a, sink=lambda _: None, host=host, step_cache=pol).run()

    doc_b = _linear_llm_agent_step_cache_doc(gid, tmp_path, input_v=2)
    ev: list[dict] = []
    GraphRunner(doc_b, sink=lambda e: ev.append(e), host=host, step_cache=pol).run()
    assert any(e.get("type") == "node_cache_miss" for e in ev)
    assert not any(e.get("type") == "node_cache_hit" for e in ev)
    assert sum(1 for e in ev if e.get("type") == "process_spawn" and e.get("nodeId") == "a1") == 1


def test_llm_agent_step_cache_dirty_skips_hit(tmp_path: Path) -> None:
    gid = "d2d2d2d2-d2d2-42d2-82d2-d2d2d2d2d2d2"
    doc = _linear_llm_agent_step_cache_doc(gid, tmp_path, input_v=0)
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
        step_cache=StepCachePolicy(enabled=True, dirty_nodes=frozenset({"a1"})),
    ).run()
    miss = [e for e in ev if e.get("type") == "node_cache_miss"]
    assert any(m.get("reason") == "dirty" for m in miss)
    assert not any(e.get("type") == "node_cache_hit" for e in ev)
    assert sum(1 for e in ev if e.get("type") == "process_spawn" and e.get("nodeId") == "a1") == 1


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


def _minimal_child_graph(gid: str, *, bump: str = "a") -> dict:
    # graph_document_revision ignores meta.title; bump must change node/edge payload.
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid, "title": "nested"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "cs", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "ce", "type": "exit", "position": {"x": 0, "y": 0}, "data": {"bump": bump}},
        ],
        "edges": [
            {
                "id": "c1",
                "source": "cs",
                "sourceHandle": "out_default",
                "target": "ce",
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }


def _parent_graph_ref_then_task(parent_id: str, child_id: str, tmp: Path) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": parent_id, "title": "parent-graph-ref-task"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "ps", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "pref",
                "type": "graph_ref",
                "position": {"x": 0, "y": 0},
                "data": {"targetGraphId": child_id},
            },
            {
                "id": "pt",
                "type": "task",
                "position": {"x": 0, "y": 0},
                "data": {
                    "command": [sys.executable, "-c", "print(1)"],
                    "cwd": str(tmp),
                    "stepCache": True,
                },
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
                "target": "pt",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "p3",
                "source": "pt",
                "sourceHandle": "out_default",
                "target": "pe",
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }


def test_step_cache_child_file_change_invalidates_parent_downstream_task(tmp_path: Path) -> None:
    clear_graph_index_cache()
    child_id = "c0c0c0c0-c0c0-40c0-80c0-c0c0c0c0c0c0"
    parent_id = "d0d0d0d0-d0d0-40d0-80d0-d0d0d0d0d0d0"
    child_path = tmp_path / "child.json"
    child_path.write_text(json.dumps(_minimal_child_graph(child_id, bump="v1")), encoding="utf-8")
    (tmp_path / "parent.json").write_text(
        json.dumps(_parent_graph_ref_then_task(parent_id, child_id, tmp_path)),
        encoding="utf-8",
    )

    root_doc = GraphDocument.from_dict(_parent_graph_ref_then_task(parent_id, child_id, tmp_path))
    host = RunHostContext(graphs_root=tmp_path, artifacts_base=tmp_path)
    pol = StepCachePolicy(enabled=True, dirty_nodes=frozenset())

    ev1: list[dict] = []
    GraphRunner(root_doc, sink=lambda e: ev1.append(e), host=host, step_cache=pol).run()
    assert sum(1 for e in ev1 if e.get("type") == "process_spawn" and e.get("nodeId") == "pt") == 1
    assert any(e.get("type") == "node_cache_miss" and e.get("nodeId") == "pt" for e in ev1)
    assert not any(e.get("type") == "node_cache_hit" and e.get("nodeId") == "pt" for e in ev1)

    ev2: list[dict] = []
    GraphRunner(root_doc, sink=lambda e: ev2.append(e), host=host, step_cache=pol).run()
    assert sum(1 for e in ev2 if e.get("type") == "process_spawn" and e.get("nodeId") == "pt") == 0
    assert any(e.get("type") == "node_cache_hit" and e.get("nodeId") == "pt" for e in ev2)

    child_path.write_text(json.dumps(_minimal_child_graph(child_id, bump="v2")), encoding="utf-8")

    ev3: list[dict] = []
    GraphRunner(root_doc, sink=lambda e: ev3.append(e), host=host, step_cache=pol).run()
    assert sum(1 for e in ev3 if e.get("type") == "process_spawn" and e.get("nodeId") == "pt") == 1
    assert any(e.get("type") == "node_cache_miss" and e.get("nodeId") == "pt" for e in ev3)
    assert not any(e.get("type") == "node_cache_hit" and e.get("nodeId") == "pt" for e in ev3)


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


def test_step_cache_env_keys_invalidates_when_secrets_file_changes(tmp_path: Path) -> None:
    ws = tmp_path / "ws"
    ws.mkdir()
    graphs = ws / "graphs"
    graphs.mkdir()
    (ws / ".graphcaster").mkdir()
    sec = ws / ".graphcaster" / "workspace.secrets.env"
    sec.write_text("VAR=alpha\n", encoding="utf-8")

    gid = "40404040-4040-4404-8404-404040404040"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "envkey-cache"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "t1",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "command": [
                            sys.executable,
                            "-c",
                            "import os, sys; v = os.environ.get('VAR', ''); "
                            "sys.exit(0 if v in ('alpha', 'beta') else 1)",
                        ],
                        "cwd": str(ws),
                        "stepCache": True,
                        "envKeys": ["VAR"],
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

    host = RunHostContext(graphs_root=graphs, artifacts_base=ws)
    pol = StepCachePolicy(enabled=True, dirty_nodes=frozenset())

    ev1: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev1.append(e), host=host, step_cache=pol).run()
    assert sum(1 for e in ev1 if e.get("type") == "process_spawn" and e.get("nodeId") == "t1") == 1

    ev2: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev2.append(e), host=host, step_cache=pol).run()
    assert sum(1 for e in ev2 if e.get("type") == "process_spawn" and e.get("nodeId") == "t1") == 0
    assert any(e.get("type") == "node_cache_hit" for e in ev2)

    sec.write_text("VAR=beta\n", encoding="utf-8")
    ev3: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev3.append(e), host=host, step_cache=pol).run()
    assert sum(1 for e in ev3 if e.get("type") == "process_spawn" and e.get("nodeId") == "t1") == 1
    assert any(e.get("type") == "node_cache_miss" for e in ev3)


def test_step_cache_ai_route_hits_without_second_provider_invocation(tmp_path: Path) -> None:
    """Second run must emit node_cache_hit; injectable provider runs only on miss."""

    gid = "c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "ai-route-step-cache"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "r1",
                    "type": "ai_route",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "stepCache": True,
                        "title": "R",
                        "endpointUrl": "http://example.invalid/route",
                    },
                },
                {"id": "x1", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "y1", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e0",
                    "source": "s1",
                    "sourceHandle": "out_default",
                    "target": "r1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e1",
                    "source": "r1",
                    "sourceHandle": "out_default",
                    "target": "x1",
                    "targetHandle": "in_default",
                    "data": {"routeDescription": "path X"},
                },
                {
                    "id": "e2",
                    "source": "r1",
                    "sourceHandle": "out_default",
                    "target": "y1",
                    "targetHandle": "in_default",
                    "data": {"routeDescription": "path Y"},
                },
            ],
        }
    )

    bodies: list[dict[str, Any]] = []

    def provider(body: dict[str, Any]) -> dict[str, Any]:
        bodies.append(body)
        return {"choiceIndex": 1}

    host = RunHostContext(artifacts_base=tmp_path)
    pol = StepCachePolicy(enabled=True, dirty_nodes=frozenset())

    ev1: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev1.append(e), host=host, step_cache=pol).run(
        context={"ai_route_provider": provider},
    )
    assert len(bodies) == 1
    assert any(e.get("type") == "ai_route_invoke" for e in ev1)

    ev2: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev2.append(e), host=host, step_cache=pol).run(
        context={"ai_route_provider": provider},
    )
    assert len(bodies) == 1
    assert any(e.get("type") == "node_cache_hit" and e.get("nodeId") == "r1" for e in ev2)
    assert not any(e.get("type") == "ai_route_invoke" for e in ev2)
