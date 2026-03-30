# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import pytest

from graph_caster.expression.errors import ExpressionSyntaxError
from graph_caster.expression.parser import ExpressionParser


class TestExpressionParser:
    def test_parse_simple_variable(self) -> None:
        parser = ExpressionParser()
        ast = parser.parse("$json.name")
        assert ast.type == "member_access"
        assert ast.property == "name"
        assert ast.object is not None
        assert getattr(ast.object, "type", None) == "member_access"
        assert getattr(ast.object, "property", None) == "json"

    def test_parse_node_reference(self) -> None:
        parser = ExpressionParser()
        ast = parser.parse('$node["Task1"].json.output')
        assert ast.type == "member_access"
        assert ast.property == "output"
        inner = ast.object
        assert inner is not None and inner.type == "member_access"
        assert inner.property == "json"
        base = inner.object
        assert base is not None and base.type == "member_access"
        assert base.property == "Task1"

    def test_parse_binary_operation(self) -> None:
        parser = ExpressionParser()
        ast = parser.parse("$json.count > 10")
        assert ast.type == "binary_op"
        assert ast.operator == ">"

    def test_parse_function_call(self) -> None:
        parser = ExpressionParser()
        ast = parser.parse("len($json.items)")
        assert ast.type == "call"
        assert ast.callee is not None and ast.callee.type == "identifier"
        assert ast.callee.name == "len"

    def test_invalid_syntax_raises(self) -> None:
        parser = ExpressionParser()
        with pytest.raises(ExpressionSyntaxError):
            parser.parse("$json[")
