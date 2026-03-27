# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from typing import Any

MAX_EDGE_CONDITION_CHARS = 65536

_SUPPORTED_OPS = frozenset(
    {
        "==",
        "!=",
        ">",
        ">=",
        "<",
        "<=",
        "!",
        "!!",
        "and",
        "or",
        "if",
        "var",
        "in",
        "max",
        "min",
        "%",
        "cat",
    }
)


def _public_context(context: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in context.items() if not str(k).startswith("_")}


def _truthy(value: Any) -> bool:
    if value is None or value is False:
        return False
    if value == 0 or value == "":
        return False
    if isinstance(value, (list, dict)) and len(value) == 0:
        return False
    return True


def _coerce_num(a: Any, b: Any) -> tuple[Any, Any]:
    if isinstance(a, (int, float)) and isinstance(b, str):
        try:
            return a, float(b) if "." in b else int(b)
        except ValueError:
            return a, b
    if isinstance(b, (int, float)) and isinstance(a, str):
        try:
            return (float(a) if "." in a else int(a)), b
        except ValueError:
            return a, b
    return a, b


def _get_path(root: dict[str, Any], path: str) -> Any:
    cur: Any = root
    parts = path.split(".")
    for p in parts:
        if not p or p.startswith("_"):
            return None
        if not isinstance(cur, dict):
            return None
        cur = cur.get(p)
    return cur


def _eval_maybe_rule(expr: Any, data: dict[str, Any]) -> Any:
    if isinstance(expr, dict) and len(expr) == 1:
        op = next(iter(expr))
        if op in _SUPPORTED_OPS:
            return _eval_rule(expr, data)
    if isinstance(expr, list):
        return [_eval_maybe_rule(x, data) for x in expr]
    return expr


def _eval_rule(rule: dict[str, Any], data: dict[str, Any]) -> Any:
    if len(rule) != 1:
        raise ValueError("rule must have exactly one operator key")
    op, raw = next(iter(rule.items()))
    if op not in _SUPPORTED_OPS:
        raise ValueError(f"unsupported operator: {op!r}")

    if op == "var":
        if isinstance(raw, str):
            return _get_path(data, raw)
        if isinstance(raw, list) and raw:
            key = raw[0]
            if not isinstance(key, str):
                return None
            val = _get_path(data, key)
            if val is None and len(raw) > 1:
                return raw[1]
            return val
        return None

    if op in {"!", "!!"}:
        inner = _eval_maybe_rule(raw, data) if not isinstance(raw, list) else _eval_maybe_rule(raw[0], data)
        t = _truthy(inner)
        if op == "!":
            return not t
        return t

    if op in {"and", "or"}:
        if not isinstance(raw, list):
            raw = [raw]
        if op == "and":
            for item in raw:
                if not _truthy(_eval_maybe_rule(item, data)):
                    return False
            return True
        for item in raw:
            if _truthy(_eval_maybe_rule(item, data)):
                return True
        return False

    if op == "if":
        if not isinstance(raw, list) or len(raw) < 2:
            raise ValueError("if expects [cond, then, else?]")
        cond_v = _eval_maybe_rule(raw[0], data)
        if _truthy(cond_v):
            return _eval_maybe_rule(raw[1], data) if len(raw) > 1 else None
        if len(raw) > 2:
            return _eval_maybe_rule(raw[2], data)
        return None

    if op == "in":
        if not isinstance(raw, list) or len(raw) != 2:
            raise ValueError("in expects [item, list]")
        item = _eval_maybe_rule(raw[0], data)
        container = _eval_maybe_rule(raw[1], data)
        if not isinstance(container, list):
            return False
        return item in container

    if op in {"max", "min"}:
        if not isinstance(raw, list) or not raw:
            return None
        vals = [_eval_maybe_rule(x, data) for x in raw]
        nums: list[float] = []
        for v in vals:
            if isinstance(v, (int, float)):
                nums.append(float(v))
            else:
                return None
        return max(nums) if op == "max" else min(nums)

    if op == "cat":
        if not isinstance(raw, list):
            raw = [raw]
        parts = [_eval_maybe_rule(x, data) for x in raw]
        return "".join("" if p is None else str(p) for p in parts)

    if op == "%":
        if not isinstance(raw, list) or len(raw) != 2:
            raise ValueError("% expects [a, b]")
        a = _eval_maybe_rule(raw[0], data)
        b = _eval_maybe_rule(raw[1], data)
        if not isinstance(a, (int, float)) or not isinstance(b, (int, float)):
            try:
                a, b = int(a), int(b)
            except (TypeError, ValueError):
                return None
        if b == 0:
            return None
        return int(a) % int(b)

    if op in {"==", "!=", ">", ">=", "<", "<="}:
        if not isinstance(raw, list) or len(raw) != 2:
            raise ValueError(f"{op} expects two arguments")
        left = _eval_maybe_rule(raw[0], data)
        right = _eval_maybe_rule(raw[1], data)
        if op in {">", ">=", "<", "<="}:
            left, right = _coerce_num(left, right)
        if op == "==":
            return left == right
        if op == "!=":
            return left != right
        try:
            if op == ">":
                return left > right
            if op == ">=":
                return left >= right
            if op == "<":
                return left < right
            if op == "<=":
                return left <= right
        except TypeError:
            return False

    raise ValueError(f"unhandled op {op!r}")


def eval_edge_condition(condition: str, context: dict[str, Any]) -> bool:
    s = condition.strip()
    if len(s) > MAX_EDGE_CONDITION_CHARS:
        return False
    low = s.lower()
    if low in {"true", "1", "yes"}:
        return True
    if low in {"false", "0", "no"}:
        return False

    if s.startswith("{"):
        try:
            parsed = json.loads(s)
        except json.JSONDecodeError:
            return False
        if not isinstance(parsed, dict) or len(parsed) != 1:
            return False
        op_key = next(iter(parsed))
        if op_key not in _SUPPORTED_OPS:
            return False
        data = _public_context(context)
        try:
            result = _eval_rule(parsed, data)
        except (KeyError, TypeError, ValueError):
            return False
        return _truthy(result)

    return bool(context.get("last_result"))
