# Copyright GraphCaster. All Rights Reserved.

"""Langflow-style AST inference of inputs/outputs from a code snippet.

Walks the AST to detect patterns like:
    args["foo"]   or   args.foo      → Input("foo", str, default=None)
    result = {"sum": s, "diff": d}   → Output("sum", ...), Output("diff", ...)

This is optional for v1; it lets the UI build dynamic input/output forms
without the user manually declaring them.
"""

from __future__ import annotations

import ast
from typing import Any

from graph_caster.node_api.fields import Input, Output


def infer_inputs_from_code(code: str) -> list[Input]:
    """Walk *code* AST. For subscript or attribute accesses on `args`, infer Input."""
    try:
        tree = ast.parse(code, "<code_parser>", "exec")
    except SyntaxError:
        return []

    names: list[str] = []
    seen: set[str] = set()

    class _Visitor(ast.NodeVisitor):
        def visit_Subscript(self, node: ast.Subscript) -> None:
            if isinstance(node.value, ast.Name) and node.value.id == "args":
                key = _extract_string_key(node.slice)
                if key and key not in seen:
                    seen.add(key)
                    names.append(key)
            self.generic_visit(node)

        def visit_Attribute(self, node: ast.Attribute) -> None:
            if isinstance(node.value, ast.Name) and node.value.id == "args":
                key = node.attr
                if key not in seen:
                    seen.add(key)
                    names.append(key)
            self.generic_visit(node)

    _Visitor().visit(tree)
    return [Input(name=n, field_type=str, default=None) for n in names]


def infer_outputs_from_code(code: str) -> list[Output]:
    """If `result` is assigned a dict literal, infer Outputs from its keys.

    Falls back to a single Output("result", "json") for any other assignment
    or when no assignment to `result` is found.
    """
    try:
        tree = ast.parse(code, "<code_parser>", "exec")
    except SyntaxError:
        return [Output(name="result", field_type="json")]

    dict_keys: list[str] | None = None

    for node in ast.walk(tree):
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == "result":
                if isinstance(node.value, ast.Dict):
                    keys = _extract_dict_keys(node.value)
                    if keys is not None:
                        dict_keys = keys
                break

    if dict_keys:
        return [Output(name=k, field_type="json") for k in dict_keys]
    return [Output(name="result", field_type="json")]


# ── helpers ───────────────────────────────────────────────────────────────────

def _extract_string_key(node: ast.expr) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.Index):
        inner = node.value  # type: ignore[attr-defined]
        if isinstance(inner, ast.Constant) and isinstance(inner.value, str):
            return inner.value
    return None


def _extract_dict_keys(node: ast.Dict) -> list[str] | None:
    keys: list[str] = []
    for k in node.keys:
        if isinstance(k, ast.Constant) and isinstance(k.value, str):
            keys.append(k.value)
        else:
            return None
    return keys if keys else None
