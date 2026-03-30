# Copyright GraphCaster. All Rights Reserved.

"""AST-based expression parser for GraphCaster expressions."""

from __future__ import annotations

import ast
import re
from dataclasses import dataclass
from typing import Any

from .errors import ExpressionSyntaxError


@dataclass
class ExprNode:
    """AST node for expressions."""

    type: str
    value: Any = None
    left: ExprNode | None = None
    right: ExprNode | None = None
    operator: str | None = None
    object: ExprNode | str | None = None
    property: str | int | None = None
    callee: ExprNode | None = None
    arguments: list[ExprNode] | None = None
    name: str | None = None


class ExpressionParser:
    """Parse n8n-style expressions to AST."""

    def __init__(self) -> None:
        self._operators = {
            ast.Add: "+",
            ast.Sub: "-",
            ast.Mult: "*",
            ast.Div: "/",
            ast.Mod: "%",
            ast.Pow: "**",
            ast.FloorDiv: "//",
            ast.Eq: "==",
            ast.NotEq: "!=",
            ast.Lt: "<",
            ast.LtE: "<=",
            ast.Gt: ">",
            ast.GtE: ">=",
            ast.And: "and",
            ast.Or: "or",
            ast.Not: "not",
            ast.In: "in",
            ast.NotIn: "not in",
        }

    def parse(self, expression: str) -> ExprNode:
        """Parse expression string to AST."""
        preprocessed = self._preprocess(expression)
        try:
            tree = ast.parse(preprocessed, mode="eval")
            return self._convert_ast(tree.body)
        except SyntaxError as e:
            raise ExpressionSyntaxError(str(e), getattr(e, "offset", None)) from e

    def _preprocess(self, expr: str) -> str:
        """Convert $json, $node[\"X\"] syntax to Python-parseable form."""
        result = re.sub(r"\$json\b", '__ctx__["json"]', expr)
        result = re.sub(r'\$node\["([^"]+)"\]', r'__ctx__["nodes"]["\1"]', result)
        result = re.sub(r"\$item\b", '__ctx__["item"]', result)
        result = re.sub(r"\$env\b", '__ctx__["env"]', result)
        result = re.sub(r"\$vars\b", '__ctx__["vars"]', result)
        return result

    def _convert_ast(self, node: ast.AST) -> ExprNode:
        """Convert Python AST to ExprNode."""
        if isinstance(node, ast.Constant):
            return ExprNode(type="literal", value=node.value)

        if isinstance(node, ast.Name):
            return ExprNode(type="identifier", name=node.id)

        if isinstance(node, ast.BinOp):
            return ExprNode(
                type="binary_op",
                operator=self._operators.get(type(node.op), "?"),
                left=self._convert_ast(node.left),
                right=self._convert_ast(node.right),
            )

        if isinstance(node, ast.Compare):
            return ExprNode(
                type="binary_op",
                operator=self._operators.get(type(node.ops[0]), "?"),
                left=self._convert_ast(node.left),
                right=self._convert_ast(node.comparators[0]),
            )

        if isinstance(node, ast.BoolOp):
            result = self._convert_ast(node.values[0])
            op = self._operators.get(type(node.op), "?")
            for val in node.values[1:]:
                result = ExprNode(
                    type="binary_op",
                    operator=op,
                    left=result,
                    right=self._convert_ast(val),
                )
            return result

        if isinstance(node, ast.UnaryOp):
            return ExprNode(
                type="unary_op",
                operator=self._operators.get(type(node.op), "?"),
                right=self._convert_ast(node.operand),
            )

        if isinstance(node, ast.Subscript):
            return ExprNode(
                type="member_access",
                object=self._convert_ast(node.value),
                property=self._get_subscript_key(node.slice),
            )

        if isinstance(node, ast.Attribute):
            return ExprNode(
                type="member_access",
                object=self._convert_ast(node.value),
                property=node.attr,
            )

        if isinstance(node, ast.Call):
            return ExprNode(
                type="call",
                callee=self._convert_ast(node.func),
                arguments=[self._convert_ast(arg) for arg in node.args],
            )

        if isinstance(node, ast.List):
            return ExprNode(type="array", value=[self._convert_ast(el) for el in node.elts])

        if isinstance(node, ast.Dict):
            return ExprNode(
                type="object",
                value={
                    self._convert_ast(k): self._convert_ast(v)
                    for k, v in zip(node.keys, node.values, strict=True)
                },
            )

        raise ExpressionSyntaxError(f"Unsupported AST node: {type(node).__name__}")

    def _get_subscript_key(self, slice_node: ast.AST) -> str | int:
        """Extract subscript key from slice."""
        if isinstance(slice_node, ast.Constant):
            return slice_node.value
        if isinstance(slice_node, ast.Name):
            return slice_node.id
        raise ExpressionSyntaxError("Complex subscripts not supported")
