# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.edge_conditions import eval_edge_condition
from graph_caster.expression import ExpressionContext
from graph_caster.runner.expression_conditions import (
    evaluate_edge_condition_inline,
    runner_predicate_to_expression_context,
)


class TestEdgeConditionIntegration:
    def test_evaluate_simple_comparison(self) -> None:
        node_outputs = {"Task1": {"count": 15}}
        ctx = ExpressionContext.from_run_state(
            current_node_id="Task2",
            node_outputs=node_outputs,
        )
        assert evaluate_edge_condition_inline('$node["Task1"].json.count > 10', ctx) is True

    def test_evaluate_string_match(self) -> None:
        node_outputs = {"Task1": {"status": "success"}}
        ctx = ExpressionContext.from_run_state(
            current_node_id="Task2",
            node_outputs=node_outputs,
        )
        assert (
            evaluate_edge_condition_inline('$node["Task1"].json.status == "success"', ctx) is True
        )

    def test_evaluate_with_functions(self) -> None:
        node_outputs = {"Task1": {"items": [1, 2, 3, 4, 5]}}
        ctx = ExpressionContext.from_run_state(
            current_node_id="Task2",
            node_outputs=node_outputs,
        )
        assert (
            evaluate_edge_condition_inline('len($node["Task1"].json.items) >= 5', ctx) is True
        )

    def test_evaluate_boolean_expression(self) -> None:
        node_outputs = {
            "Task1": {"status": "complete"},
            "Task2": {"error": None},
        }
        ctx = ExpressionContext.from_run_state(
            current_node_id="Task3",
            node_outputs=node_outputs,
        )
        assert (
            evaluate_edge_condition_inline(
                '$node["Task1"].json.status == "complete" and $node["Task2"].json.error == None',
                ctx,
            )
            is True
        )

    def test_empty_condition_is_truthy(self) -> None:
        ctx = ExpressionContext.empty()
        assert evaluate_edge_condition_inline("", ctx) is True

    def test_none_condition_is_truthy(self) -> None:
        ctx = ExpressionContext.empty()
        assert evaluate_edge_condition_inline(None, ctx) is True

    def test_eval_edge_condition_routes_dollar_expressions(self) -> None:
        ctx = {
            "last_result": {"count": 2},
            "node_outputs": {"A": {"items": [1, 2, 3]}},
        }
        assert eval_edge_condition("$json.count > 1", ctx) is True
        mapped = runner_predicate_to_expression_context(ctx)
        assert evaluate_edge_condition_inline('len($node["A"].json.items) == 3', mapped) is True
