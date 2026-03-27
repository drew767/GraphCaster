# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner


def _minimal_meta(gid: str, title: str) -> dict:
    return {"schemaVersion": 1, "meta": {"schemaVersion": 1, "graphId": gid, "title": title}}


def test_two_outgoing_conditional_false_then_unconditional_emits_skip_taken_traverse() -> None:
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            **_minimal_meta(gid, "branch-seq"),
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "t", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e_bad",
                    "source": "s",
                    "sourceHandle": "out_default",
                    "target": "t",
                    "targetHandle": "in_default",
                    "condition": '{"==":[1,2]}',
                },
                {
                    "id": "e_ok",
                    "source": "s",
                    "sourceHandle": "out_default",
                    "target": "t",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    idx_s_exit = next(i for i, e in enumerate(events) if e.get("type") == "node_exit" and e.get("nodeId") == "s")
    step_types = [e.get("type") for e in events[idx_s_exit + 1 : idx_s_exit + 4]]
    assert step_types == ["branch_skipped", "branch_taken", "edge_traverse"]
    sk = next(x for x in events if x.get("type") == "branch_skipped")
    assert sk.get("edgeId") == "e_bad"
    assert sk.get("reason") == "condition_false"
    assert sk.get("graphId") == gid
    tk = next(x for x in events if x.get("type") == "branch_taken")
    assert tk.get("edgeId") == "e_ok"
    assert tk.get("graphId") == gid
    tr = next(x for x in events if x.get("type") == "edge_traverse")
    assert tr.get("edgeId") == "e_ok"


def test_single_conditional_true_no_branch_meta_only_traverse() -> None:
    gid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            **_minimal_meta(gid, "one-cond-ok"),
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "t", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "only",
                    "source": "s",
                    "sourceHandle": "out_default",
                    "target": "t",
                    "targetHandle": "in_default",
                    "condition": '{"==":[{"var":"last_result"},true]}',
                },
            ],
        }
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    assert not any(e.get("type") == "branch_skipped" for e in events)
    assert not any(e.get("type") == "branch_taken" for e in events)
    assert any(e.get("type") == "edge_traverse" and e.get("edgeId") == "only" for e in events)


def test_single_conditional_false_skip_only_then_run_end() -> None:
    gid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            **_minimal_meta(gid, "one-cond-fail"),
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "t", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "only",
                    "source": "s",
                    "sourceHandle": "out_default",
                    "target": "t",
                    "targetHandle": "in_default",
                    "condition": '{"==":[{"var":"last_result"},true]}',
                },
            ],
        }
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": False})
    skips = [e for e in events if e.get("type") == "branch_skipped"]
    assert len(skips) == 1
    assert skips[0].get("edgeId") == "only"
    assert skips[0].get("reason") == "condition_false"
    assert not any(e.get("type") == "branch_taken" for e in events)
    assert not any(e.get("type") == "edge_traverse" for e in events)
    ends = [e for e in events if e.get("type") == "run_end"]
    assert any(e.get("reason") == "no_outgoing_or_no_matching_condition" for e in ends)
