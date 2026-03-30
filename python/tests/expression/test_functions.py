# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import pytest

from graph_caster.expression import ExpressionEvaluator


class TestExpressionFunctions:
    @pytest.fixture
    def evaluator(self) -> ExpressionEvaluator:
        return ExpressionEvaluator()

    def test_upper(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"text": "hello"}}
        assert evaluator.evaluate("upper($json.text)", ctx) == "HELLO"

    def test_lower(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"text": "HELLO"}}
        assert evaluator.evaluate("lower($json.text)", ctx) == "hello"

    def test_trim(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"text": "  hello  "}}
        assert evaluator.evaluate("trim($json.text)", ctx) == "hello"

    def test_split(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"text": "a,b,c"}}
        assert evaluator.evaluate("split($json.text, ',')", ctx) == ["a", "b", "c"]

    def test_join(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"items": ["a", "b", "c"]}}
        assert evaluator.evaluate("join($json.items, '-')", ctx) == "a-b-c"

    def test_replace(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"text": "hello world"}}
        assert evaluator.evaluate("replace($json.text, 'world', 'there')", ctx) == "hello there"

    def test_floor(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"num": 3.7}}
        assert evaluator.evaluate("floor($json.num)", ctx) == 3

    def test_ceil(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"num": 3.2}}
        assert evaluator.evaluate("ceil($json.num)", ctx) == 4

    def test_first(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"items": [1, 2, 3]}}
        assert evaluator.evaluate("first($json.items)", ctx) == 1

    def test_last(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"items": [1, 2, 3]}}
        assert evaluator.evaluate("last($json.items)", ctx) == 3

    def test_unique(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"items": [1, 2, 2, 3, 3, 3]}}
        assert evaluator.evaluate("unique($json.items)", ctx) == [1, 2, 3]

    def test_flatten(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"items": [[1, 2], [3, 4]]}}
        assert evaluator.evaluate("flatten($json.items)", ctx) == [1, 2, 3, 4]

    def test_json_parse(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"text": '{"a": 1}'}}
        assert evaluator.evaluate("json_parse($json.text)", ctx) == {"a": 1}

    def test_json_stringify(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"obj": {"a": 1}}}
        assert evaluator.evaluate("json_stringify($json.obj)", ctx) == '{"a":1}'

    def test_now(self, evaluator: ExpressionEvaluator) -> None:
        result = evaluator.evaluate("now()", {})
        assert isinstance(result, str)
        assert "20" in result

    def test_format_date(self, evaluator: ExpressionEvaluator) -> None:
        ctx = {"json": {"date": "2026-03-30T12:00:00Z"}}
        result = evaluator.evaluate("format_date($json.date, '%Y-%m-%d')", ctx)
        assert result == "2026-03-30"
