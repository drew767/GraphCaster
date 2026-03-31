# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.expression.evaluator import ExpressionEvaluator


def test_js_string_to_upper_on_literal() -> None:
    ev = ExpressionEvaluator()
    assert ev.evaluate('"ab".toUpperCase()', {}) == "AB"


def test_js_string_chain_from_json_context() -> None:
    ev = ExpressionEvaluator()
    ctx = {"json": {"name": "  te  "}}
    assert ev.evaluate('$json["name"].trim().toUpperCase()', ctx) == "TE"


def test_js_string_starts_with() -> None:
    ev = ExpressionEvaluator()
    assert ev.evaluate('"hello".startsWith("he")', {}) is True
