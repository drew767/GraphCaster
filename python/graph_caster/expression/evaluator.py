# Copyright GraphCaster. All Rights Reserved.

"""Safe expression evaluator using AST transformation."""

from __future__ import annotations

import ast
import operator
import re
from typing import Any, Callable

from .errors import (
    ExpressionEvaluationError,
    ForbiddenOperationError,
    UndefinedVariableError,
)
from .functions import EXPRESSION_FUNCTIONS

FORBIDDEN_NAMES = frozenset(
    {
        "__import__",
        "__builtins__",
        "__class__",
        "__bases__",
        "__subclasses__",
        "__mro__",
        "__globals__",
        "__code__",
        "exec",
        "eval",
        "compile",
        "open",
        "input",
        "breakpoint",
        "getattr",
        "setattr",
        "delattr",
        "globals",
        "locals",
        "vars",
        "dir",
    }
)

ALLOWED_BUILTINS: dict[str, Callable[..., Any]] = {
    "len": len,
    "str": str,
    "int": int,
    "float": float,
    "bool": bool,
    "list": list,
    "dict": dict,
    "abs": abs,
    "min": min,
    "max": max,
    "sum": sum,
    "round": round,
    "sorted": sorted,
    "reversed": lambda x: list(reversed(x)),
    "enumerate": lambda x: list(enumerate(x)),
    "zip": lambda *args: list(zip(*args, strict=False)),
    "range": lambda *args: list(range(*args)),
    "any": any,
    "all": all,
    "filter": lambda f, x: list(filter(f, x)),
    "map": lambda f, x: list(map(f, x)),
    **EXPRESSION_FUNCTIONS,
}

BINARY_OPS: dict[type, Callable[[Any, Any], Any]] = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
    ast.Eq: operator.eq,
    ast.NotEq: operator.ne,
    ast.Lt: operator.lt,
    ast.LtE: operator.le,
    ast.Gt: operator.gt,
    ast.GtE: operator.ge,
    ast.And: lambda a, b: a and b,
    ast.Or: lambda a, b: a or b,
    ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b,
}

UNARY_OPS: dict[type, Callable[[Any], Any]] = {
    ast.Not: operator.not_,
    ast.USub: operator.neg,
    ast.UAdd: operator.pos,
}

_STR_JS_METHOD_NAMES = frozenset(
    {
        "toUpperCase",
        "toLowerCase",
        "trim",
        "split",
        "startsWith",
        "endsWith",
        "includes",
        "slice",
        "replace",
    }
)


def _str_js_method_receiver(s: str, name: str) -> Callable[..., Any]:
    """n8n-style names on Python ``str`` instances (return callables for ``visit_Call``)."""

    if name == "toUpperCase":

        def _fn() -> str:
            return s.upper()

        return _fn
    if name == "toLowerCase":

        def _fn() -> str:
            return s.lower()

        return _fn
    if name == "trim":

        def _fn() -> str:
            return s.strip()

        return _fn
    if name == "split":

        def _fn(sep: str | None = None) -> list[str]:
            return s.split(sep) if sep is not None else s.split()

        return _fn
    if name == "startsWith":

        def _fn(prefix: str) -> bool:
            return s.startswith(prefix)

        return _fn
    if name == "endsWith":

        def _fn(suffix: str) -> bool:
            return s.endswith(suffix)

        return _fn
    if name == "includes":

        def _fn(sub: str) -> bool:
            return sub in s

        return _fn
    if name == "slice":

        def _fn(start: int, end: int | None = None) -> str:
            return s[start:end]

        return _fn
    if name == "replace":

        def _fn(old: str, new: str = "") -> str:
            return s.replace(old, new)

        return _fn
    raise UndefinedVariableError(f"String method {name!r} not supported", name)


class SafeEvalVisitor(ast.NodeVisitor):
    """AST visitor that evaluates expressions safely."""

    def __init__(self, context: dict[str, Any]):
        self.context = context
        self._ensure_defaults()

    def _ensure_defaults(self) -> None:
        if "json" not in self.context:
            self.context["json"] = {}
        if "nodes" not in self.context:
            self.context["nodes"] = {}
        if "env" not in self.context:
            self.context["env"] = {}
        if "item" not in self.context:
            self.context["item"] = None
        if "run" not in self.context:
            self.context["run"] = {}
        if "iteration" not in self.context:
            self.context["iteration"] = 0
        if "vars" not in self.context:
            self.context["vars"] = {}

    def visit(self, node: ast.AST) -> Any:
        if isinstance(node, ast.Name) and node.id in FORBIDDEN_NAMES:
            raise ForbiddenOperationError(f"Access to '{node.id}' is forbidden")
        return super().visit(node)

    def visit_Constant(self, node: ast.Constant) -> Any:
        return node.value

    def visit_Name(self, node: ast.Name) -> Any:
        name = node.id
        if name == "True":
            return True
        if name == "False":
            return False
        if name == "None":
            return None
        if name == "__ctx__":
            return self.context
        if name in ALLOWED_BUILTINS:
            return ALLOWED_BUILTINS[name]
        if name in FORBIDDEN_NAMES:
            raise ForbiddenOperationError(f"Access to '{name}' is forbidden")
        raise UndefinedVariableError(f"Undefined variable: {name}", "")

    def visit_BinOp(self, node: ast.BinOp) -> Any:
        left = self.visit(node.left)
        right = self.visit(node.right)
        op_func = BINARY_OPS.get(type(node.op))
        if op_func is None:
            raise ForbiddenOperationError(f"Operator {type(node.op).__name__} not allowed")
        return op_func(left, right)

    def visit_Compare(self, node: ast.Compare) -> Any:
        left = self.visit(node.left)
        result = True
        for op, comparator in zip(node.ops, node.comparators, strict=True):
            right = self.visit(comparator)
            op_func = BINARY_OPS.get(type(op))
            if op_func is None:
                raise ForbiddenOperationError(f"Comparison {type(op).__name__} not allowed")
            result = result and bool(op_func(left, right))
            left = right
        return result

    def visit_BoolOp(self, node: ast.BoolOp) -> Any:
        op_func = BINARY_OPS.get(type(node.op))
        if op_func is None:
            raise ForbiddenOperationError(f"Boolean op {type(node.op).__name__} not allowed")
        result = self.visit(node.values[0])
        for val in node.values[1:]:
            result = op_func(result, self.visit(val))
        return result

    def visit_UnaryOp(self, node: ast.UnaryOp) -> Any:
        operand = self.visit(node.operand)
        op_func = UNARY_OPS.get(type(node.op))
        if op_func is None:
            raise ForbiddenOperationError(f"Unary op {type(node.op).__name__} not allowed")
        return op_func(operand)

    def visit_Subscript(self, node: ast.Subscript) -> Any:
        obj = self.visit(node.value)
        key = self._get_subscript_key(node.slice)
        try:
            return obj[key]
        except (KeyError, IndexError, TypeError) as e:
            raise UndefinedVariableError(f"Cannot access [{key!r}]: {e}", "") from e

    def visit_Attribute(self, node: ast.Attribute) -> Any:
        obj = self.visit(node.value)
        attr = node.attr
        if attr.startswith("_"):
            raise ForbiddenOperationError(f"Access to private attribute '{attr}' forbidden")
        if isinstance(obj, str) and attr in _STR_JS_METHOD_NAMES:
            return _str_js_method_receiver(obj, attr)
        if isinstance(obj, dict):
            if attr in obj:
                return obj[attr]
            raise UndefinedVariableError(f"Key '{attr}' not found", attr)
        if hasattr(obj, attr):
            return getattr(obj, attr)
        raise UndefinedVariableError(f"Attribute '{attr}' not found", attr)

    def visit_Call(self, node: ast.Call) -> Any:
        func = self.visit(node.func)
        if not callable(func):
            raise ForbiddenOperationError(f"{func!r} is not callable")
        args = [self.visit(arg) for arg in node.args]
        kwargs: dict[str, Any] = {}
        for kw in node.keywords:
            if kw.arg is None:
                raise ForbiddenOperationError("Keyword-only splat calls are not allowed")
            kwargs[kw.arg] = self.visit(kw.value)
        return func(*args, **kwargs)

    def visit_List(self, node: ast.List) -> list[Any]:
        return [self.visit(el) for el in node.elts]

    def visit_Dict(self, node: ast.Dict) -> dict[Any, Any]:
        return {self.visit(k): self.visit(v) for k, v in zip(node.keys, node.values, strict=True)}

    def visit_IfExp(self, node: ast.IfExp) -> Any:
        test = self.visit(node.test)
        if test:
            return self.visit(node.body)
        return self.visit(node.orelse)

    def _get_subscript_key(self, slice_node: ast.AST) -> Any:
        if isinstance(slice_node, ast.Constant):
            return slice_node.value
        return self.visit(slice_node)


class ExpressionEvaluator:
    """Evaluate expressions safely in a context."""

    def evaluate(self, expression: str, context: dict[str, Any]) -> Any:
        preprocessed = self._preprocess(expression)
        try:
            tree = ast.parse(preprocessed, mode="eval")
        except SyntaxError as e:
            raise ExpressionEvaluationError(str(e), expression) from e
        visitor = SafeEvalVisitor(dict(context))
        return visitor.visit(tree.body)

    def _preprocess(self, expr: str) -> str:
        result = re.sub(r"\$json\b", '__ctx__["json"]', expr)
        result = re.sub(r'\$node\["([^"]+)"\]', r'__ctx__["nodes"]["\1"]', result)
        result = re.sub(r"\$item\b", '__ctx__["item"]', result)
        result = re.sub(r"\$env\b", '__ctx__["env"]', result)
        result = re.sub(r"\$iteration\b", '__ctx__["iteration"]', result)
        result = re.sub(r"\$vars\b", '__ctx__["vars"]', result)
        return result
