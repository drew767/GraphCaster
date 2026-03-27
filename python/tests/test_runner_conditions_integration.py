# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner


def test_branch_first_matching_edge_by_last_result_from_context() -> None:
    gid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "branch"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "e_ok", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "e_fail", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "s",
                    "sourceHandle": "out_default",
                    "target": "e_ok",
                    "targetHandle": "in_default",
                    "condition": '{"==":[{"var":"last_result"},true]}',
                },
                {
                    "id": "e2",
                    "source": "s",
                    "sourceHandle": "out_default",
                    "target": "e_fail",
                    "targetHandle": "in_default",
                    "condition": '{"==":[{"var":"last_result"},false]}',
                },
            ],
        }
    )
    ev_ok: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev_ok.append(e)).run(context={"last_result": True})
    assert any(e.get("type") == "run_success" and e.get("nodeId") == "e_ok" for e in ev_ok)
    assert not any(e.get("type") == "run_success" and e.get("nodeId") == "e_fail" for e in ev_ok)

    ev_fail: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev_fail.append(e)).run(context={"last_result": False})
    assert any(e.get("type") == "run_success" and e.get("nodeId") == "e_fail" for e in ev_fail)
    assert not any(e.get("type") == "run_success" and e.get("nodeId") == "e_ok" for e in ev_fail)


def test_unconditional_edge_wins_first_in_list() -> None:
    gid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "b2"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "x1", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "x2", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "ea",
                    "source": "s",
                    "sourceHandle": "out_default",
                    "target": "x1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "eb",
                    "source": "s",
                    "sourceHandle": "out_default",
                    "target": "x2",
                    "targetHandle": "in_default",
                    "condition": '{"==":[1,1]}',
                },
            ],
        }
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": False})
    assert any(e.get("type") == "run_success" and e.get("nodeId") == "x1" for e in events)
