# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import pytest

from graph_caster.expression import ExpressionEvaluator
from graph_caster.expression.errors import ForbiddenOperationError, UndefinedVariableError


class TestExpressionEvaluator:
    def test_evaluate_literal(self) -> None:
        evaluator = ExpressionEvaluator()
        assert evaluator.evaluate("42", {}) == 42

    def test_evaluate_json_access(self) -> None:
        evaluator = ExpressionEvaluator()
        ctx = {"json": {"name": "Alice", "age": 30}}
        assert evaluator.evaluate("$json.name", ctx) == "Alice"

    def test_evaluate_node_reference(self) -> None:
        evaluator = ExpressionEvaluator()
        ctx = {"nodes": {"Task1": {"json": {"result": "success"}}}}
        assert evaluator.evaluate('$node["Task1"].json.result', ctx) == "success"

    def test_evaluate_comparison(self) -> None:
        evaluator = ExpressionEvaluator()
        ctx = {"json": {"count": 15}}
        assert evaluator.evaluate("$json.count > 10", ctx) is True
        assert evaluator.evaluate("$json.count < 10", ctx) is False

    def test_evaluate_function_call(self) -> None:
        evaluator = ExpressionEvaluator()
        ctx = {"json": {"items": [1, 2, 3]}}
        assert evaluator.evaluate("len($json.items)", ctx) == 3

    def test_evaluate_string_functions(self) -> None:
        evaluator = ExpressionEvaluator()
        ctx = {"json": {"text": "Hello World"}}
        assert evaluator.evaluate("lower($json.text)", ctx) == "hello world"

    def test_undefined_variable_raises(self) -> None:
        evaluator = ExpressionEvaluator()
        with pytest.raises(UndefinedVariableError):
            evaluator.evaluate("$json.missing.nested", {"json": {}})

    def test_forbidden_import_raises(self) -> None:
        evaluator = ExpressionEvaluator()
        with pytest.raises(ForbiddenOperationError):
            evaluator.evaluate("__import__('os')", {})

    def test_forbidden_exec_raises(self) -> None:
        evaluator = ExpressionEvaluator()
        with pytest.raises(ForbiddenOperationError):
            evaluator.evaluate("exec('print(1)')", {})
