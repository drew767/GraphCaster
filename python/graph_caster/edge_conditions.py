# Copyright GraphCaster. All Rights Reserved.

"""Edge conditions: JSON Logic subset, mustache templates, legacy last_result truthiness.

Template (n8n-style ergonomics, no VM): ``{{ dotted.path }}`` for truthiness, or
``{{ dotted.path }} <op> <literal>`` with op in ==, !=, <, <=, >, >=. The first path
segment may be ``$json`` (reserved): same object as ``last_result`` when it is a
dict, else ``{"value": last_result}`` (compare n8n ``$json`` on the current item).
Otherwise segments match ``[a-zA-Z_][a-zA-Z0-9_]*`` joined by dots; at most
MAX_TEMPLATE_PLACEHOLDERS per string. See python/README.md.
"""

from __future__ import annotations

import json
import re
from typing import Any

MAX_EDGE_CONDITION_CHARS = 65536

# Template mode (n8n-style {{ path }}): dotted paths resolve against predicate data
# (_public_context plus reserved $json envelope for last_result). Optional tail:
# {{ path }} <op> <literal> with op in ==, !=, <, <=, >, >=. No eval(); max placeholders below.
MAX_TEMPLATE_PLACEHOLDERS = 32

_PATH_SEGMENT = r"[a-zA-Z_][a-zA-Z0-9_]*"
_DOTTED_PATH = rf"(?:\$json|{_PATH_SEGMENT})(?:\.{_PATH_SEGMENT})*"
_RE_TEMPLATE_TRUTHY = re.compile(rf"^\s*\{{\{{\s*({_DOTTED_PATH})\s*\}}\}}\s*$")
_RE_TEMPLATE_CMP = re.compile(
    rf"^\s*\{{\{{\s*({_DOTTED_PATH})\s*\}}\}}\s*(==|!=|<=|>=|<|>)\s*(.+?)\s*$",
)
_RE_ALL_PLACEHOLDERS = re.compile(rf"\{{\{{\s*({_DOTTED_PATH})\s*\}}\}}")

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


def _last_result_as_json_envelope(last: Any) -> Any:
    if isinstance(last, dict):
        return last
    return {"value": last}


def _predicate_data(context: dict[str, Any]) -> dict[str, Any]:
    out = dict(_public_context(context))
    out["$json"] = _last_result_as_json_envelope(context.get("last_result"))
    return out


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


def _parse_template_literal(raw: str) -> Any:
    t = raw.strip()
    if not t:
        return None
    low = t.lower()
    if low == "true":
        return True
    if low == "false":
        return False
    if (t.startswith('"') and t.endswith('"')) or (t.startswith("'") and t.endswith("'")):
        return t[1:-1]
    try:
        if "." in t:
            return float(t)
        return int(t)
    except ValueError:
        return t


def _compare_template(left: Any, op: str, right: Any) -> bool:
    if op in {"==", "!=", ">", ">=", "<", "<="}:
        left, right = _coerce_num(left, right)
    try:
        if op == "==":
            return left == right
        if op == "!=":
            return left != right
        if op == ">":
            return bool(left > right)
        if op == ">=":
            return bool(left >= right)
        if op == "<":
            return bool(left < right)
        if op == "<=":
            return bool(left <= right)
    except TypeError:
        return False
    return False


def extract_template_paths(condition: str) -> list[str]:
    if len(condition.strip()) > MAX_EDGE_CONDITION_CHARS:
        return []
    if "{{" not in condition:
        return []
    return [m.group(1) for m in _RE_ALL_PLACEHOLDERS.finditer(condition)]


def _eval_template_condition(s: str, context: dict[str, Any]) -> bool:
    if len(s) > MAX_EDGE_CONDITION_CHARS:
        return False
    data = _predicate_data(context)
    matches = list(_RE_ALL_PLACEHOLDERS.finditer(s))
    if len(matches) > MAX_TEMPLATE_PLACEHOLDERS:
        return False
    if "{{" in s and not matches:
        return False

    m_truthy = _RE_TEMPLATE_TRUTHY.match(s)
    if m_truthy and len(matches) == 1:
        path = m_truthy.group(1)
        val = _get_path(data, path)
        return _truthy(val)

    m_cmp = _RE_TEMPLATE_CMP.match(s)
    if m_cmp and len(matches) == 1:
        path = m_cmp.group(1)
        op = m_cmp.group(2)
        literal_raw = m_cmp.group(3)
        left = _get_path(data, path)
        right = _parse_template_literal(literal_raw)
        return _compare_template(left, op, right)

    return False


def eval_edge_condition(condition: str, context: dict[str, Any]) -> bool:
    s = condition.strip()
    if len(s) > MAX_EDGE_CONDITION_CHARS:
        return False
    low = s.lower()
    if low in {"true", "1", "yes"}:
        return True
    if low in {"false", "0", "no"}:
        return False

    if s.startswith("{{"):
        return _eval_template_condition(s, context)

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
        data = _predicate_data(context)
        try:
            result = _eval_rule(parsed, data)
        except (KeyError, TypeError, ValueError):
            return False
        return _truthy(result)

    if "{{" in s:
        return _eval_template_condition(s, context)

    return bool(context.get("last_result"))
