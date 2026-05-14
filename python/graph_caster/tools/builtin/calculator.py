# Copyright GraphCaster. All Rights Reserved.

"""Built-in tool: safe arithmetic calculator using AST walking."""

from __future__ import annotations

import ast
import math
import operator as _op
from typing import Any

_SAFE_MATH_NAMES = frozenset(dir(math))

_BINOP_MAP = {
    ast.Add: _op.add,
    ast.Sub: _op.sub,
    ast.Mult: _op.mul,
    ast.Div: _op.truediv,
    ast.Mod: _op.mod,
    ast.Pow: _op.pow,
    ast.FloorDiv: _op.floordiv,
}

_UNARYOP_MAP = {
    ast.UAdd: _op.pos,
    ast.USub: _op.neg,
}


def _eval_node(node: ast.expr) -> float:
    if isinstance(node, ast.Constant):
        if isinstance(node.value, (int, float)):
            return float(node.value)
        raise ValueError(f"Non-numeric constant: {node.value!r}")

    if isinstance(node, ast.BinOp):
        fn = _BINOP_MAP.get(type(node.op))
        if fn is None:
            raise ValueError(f"Unsupported binary operator: {type(node.op).__name__}")
        left = _eval_node(node.left)
        right = _eval_node(node.right)
        return fn(left, right)

    if isinstance(node, ast.UnaryOp):
        fn = _UNARYOP_MAP.get(type(node.op))
        if fn is None:
            raise ValueError(f"Unsupported unary operator: {type(node.op).__name__}")
        return fn(_eval_node(node.operand))

    if isinstance(node, ast.Attribute):
        if (
            isinstance(node.value, ast.Name)
            and node.value.id == "math"
            and node.attr in _SAFE_MATH_NAMES
        ):
            return float(getattr(math, node.attr))
        raise ValueError(
            f"Attribute access denied: only math.<name> constants allowed, got {ast.unparse(node)!r}"
        )

    if isinstance(node, ast.Call):
        if (
            isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "math"
            and node.func.attr in _SAFE_MATH_NAMES
        ):
            fn = getattr(math, node.func.attr)
            args = [_eval_node(a) for a in node.args]
            if node.keywords:
                raise ValueError("Keyword arguments not allowed in math calls")
            return float(fn(*args))
        raise ValueError(
            f"Function call denied: only math.*() calls allowed, got {ast.unparse(node)!r}"
        )

    if isinstance(node, ast.Name):
        raise ValueError(
            f"Name lookup denied: {node.id!r} — use math.<name> for math constants"
        )

    raise ValueError(f"Unsupported expression node: {type(node).__name__}")


async def calc(expression: str) -> float:
    """Evaluate a safe arithmetic expression.

    Allowed: numeric literals, +,-,*,/,%,**,//,  (parens), math.* constants
    and math.*() function calls.
    Rejected: any name lookup, attribute access other than math.*, __builtins__,
    string literals, list/dict/set literals, imports, assignments, etc.
    """
    expr = expression.strip()
    if not expr:
        raise ValueError("Empty expression")

    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:
        raise ValueError(f"Syntax error in expression: {exc}") from exc

    return _eval_node(tree.body)
