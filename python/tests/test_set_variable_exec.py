# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner
from graph_caster.set_variable_exec import execute_set_variable, set_variable_structure_invalid_reason


def test_structure_invalid_empty_name() -> None:
    assert set_variable_structure_invalid_reason({"operation": "set", "name": ""}) == "set_variable_invalid_name"


def test_structure_invalid_bad_op() -> None:
    assert (
        set_variable_structure_invalid_reason({"operation": "noop", "name": "x"})
        == "set_variable_invalid_operation"
    )


def test_set_then_increment_updates_pool_via_merge() -> None:
    ctx: dict = {"run_variables": {}}
    ok, patch = execute_set_variable(
        node_id="a",
        graph_id="g",
        data={"operation": "set", "name": "counter", "value": 1},
        ctx=ctx,
    )
    assert ok
    assert patch.get("runVariables") == {"counter": 1}
    ctx["run_variables"].update(patch["runVariables"])
    ok2, patch2 = execute_set_variable(
        node_id="b",
        graph_id="g",
        data={"operation": "increment", "name": "counter"},
        ctx=ctx,
    )
    assert ok2
    assert patch2.get("runVariables") == {"counter": 2}


def test_delete_removes_via_patch() -> None:
    ctx: dict = {"run_variables": {"x": 1}}
    ok, patch = execute_set_variable(
        node_id="c",
        graph_id="g",
        data={"operation": "delete", "name": "x"},
        ctx=ctx,
    )
    assert ok
    assert patch.get("runVariablesRemove") == ["x"]


def test_runner_linear_set_increment_exit() -> None:
    raw: dict = {
        "schemaVersion": 1,
        "meta": {
            "schemaVersion": 1,
            "graphId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "title": "set var",
        },
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "v1",
                "type": "set_variable",
                "position": {"x": 0, "y": 0},
                "data": {"title": "Set", "name": "counter", "operation": "set", "value": 1},
            },
            {
                "id": "v2",
                "type": "set_variable",
                "position": {"x": 0, "y": 0},
                "data": {"title": "Inc", "name": "counter", "operation": "increment"},
            },
            {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "v1",
                "targetHandle": "in_default",
            },
            {
                "id": "e2",
                "source": "v1",
                "sourceHandle": "out_default",
                "target": "v2",
                "targetHandle": "in_default",
            },
            {
                "id": "e3",
                "source": "v2",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
            },
        ],
    }
    doc = GraphDocument.from_dict(raw)
    ctx: dict = {}
    GraphRunner(doc, sink=lambda _e: None).run_from("s", ctx)
    assert ctx.get("_run_success") is True
    assert ctx.get("run_variables", {}).get("counter") == 2


def test_merge_run_variables_respects_remove_list() -> None:
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [],
        }
    )
    runner = GraphRunner(doc, sink=lambda _e: None)
    ctx: dict = {"run_variables": {"a": 1, "b": 2}}
    ctx["node_outputs"] = {
        "n1": {
            "nodeType": "set_variable",
            "data": {},
            "runVariables": {"c": 3},
            "runVariablesRemove": ["a"],
        },
    }
    runner._merge_run_variables_from_node_output(ctx, "n1")
    assert ctx["run_variables"] == {"b": 2, "c": 3}
