# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.expression import ExpressionEvaluator
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner
from graph_caster.runner.expression_conditions import (
    evaluate_edge_condition_inline,
    runner_predicate_to_expression_context,
)


def _minimal_linear_doc(*, variables: dict | None = None) -> GraphDocument:
    raw: dict = {
        "schemaVersion": 1,
        "meta": {
            "schemaVersion": 1,
            "graphId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "title": "vars test",
        },
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
            }
        ],
    }
    if variables is not None:
        raw["meta"]["variables"] = variables
    return GraphDocument.from_dict(raw)


def test_run_from_merges_document_variables_under_context() -> None:
    doc = _minimal_linear_doc(variables={"a": 1, "b": 0})
    ctx: dict = {"run_variables": {"b": 2}}
    GraphRunner(doc, sink=lambda _e: None).run_from("s", ctx)
    assert ctx["run_variables"] == {"a": 1, "b": 2}


def test_merge_run_variables_from_node_output() -> None:
    doc = _minimal_linear_doc()
    runner = GraphRunner(doc, sink=lambda _e: None)
    ctx: dict = {"run_variables": {"x": 1}}
    ctx["node_outputs"] = {
        "t1": {"nodeType": "task", "data": {}, "runVariables": {"y": 2, "x": 9}},
    }
    runner._merge_run_variables_from_node_output(ctx, "t1")
    assert ctx["run_variables"] == {"x": 9, "y": 2}


def test_runner_predicate_maps_run_variables_to_vars() -> None:
    ctx = {"last_result": True, "node_outputs": {}, "run_variables": {"flag": True}}
    mapped = runner_predicate_to_expression_context(ctx)
    assert mapped.get("vars") == {"flag": True}
    assert evaluate_edge_condition_inline("$vars.flag == True", mapped) is True


def test_expression_evaluator_vars_access() -> None:
    ev = ExpressionEvaluator()
    assert ev.evaluate('$vars["k"] == 1', {"vars": {"k": 1}}) is True
