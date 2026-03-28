# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

from graph_caster.fork_parallel import build_fork_parallel_plans
from graph_caster.models import GraphDocument

ROOT = Path(__file__).resolve().parents[2]


def test_build_fork_parallel_plans_two_tasks_to_barrier() -> None:
    raw = json.loads((ROOT / "schemas" / "test-fixtures" / "fork-merge-barrier.json").read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    by_id = {n.id: n for n in doc.nodes}
    plans, reason = build_fork_parallel_plans(doc, "f1", by_id)
    assert reason is None
    assert plans is not None
    assert len(plans) == 2
    assert {tuple(p.node_ids) for p in plans} == {("ta",), ("tb",)}
    assert all(p.merge_id == "m1" for p in plans)


def test_build_fork_parallel_plans_single_out_returns_none() -> None:
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "t"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "f1", "type": "fork", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "t1", "type": "task", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "x1", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e0",
                    "source": "s1",
                    "sourceHandle": "out_default",
                    "target": "f1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e1",
                    "source": "f1",
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
    by_id = {n.id: n for n in doc.nodes}
    plans, reason = build_fork_parallel_plans(doc, "f1", by_id)
    assert plans is None and reason is None
