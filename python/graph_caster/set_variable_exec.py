# Copyright GraphCaster. All Rights Reserved.

"""Update ``ctx[\"run_variables\"]`` via the ``set_variable`` node (set / increment / append / delete)."""

from __future__ import annotations

import copy
import math
import re
from typing import Any

from graph_caster.models import Node

_VAR_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_SET_VAR_OPS = frozenset({"set", "increment", "append", "delete"})


def variable_name_from_data(data: dict[str, Any]) -> str:
    raw = data.get("name")
    if raw is None:
        raw = data.get("variableName")
    if raw is None:
        return ""
    return str(raw).strip()


def normalized_operation(data: dict[str, Any]) -> str:
    o = data.get("operation")
    if o is None:
        return ""
    return str(o).strip().lower()


def set_variable_structure_invalid_reason(data: dict[str, Any]) -> str | None:
    name = variable_name_from_data(data)
    if not name or _VAR_NAME_RE.match(name) is None:
        return "set_variable_invalid_name"
    op = normalized_operation(data)
    if op not in _SET_VAR_OPS:
        return "set_variable_invalid_operation"
    return None


def set_variable_has_valid_config(node: Node) -> bool:
    return set_variable_structure_invalid_reason(node.data or {}) is None


def _numeric_delta(value: Any) -> float | int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    if isinstance(value, str) and value.strip():
        try:
            v = float(value)
        except ValueError:
            return None
        if not math.isfinite(v):
            return None
        return int(v) if v == int(v) else v
    return None


def _coerce_increment_base(current: Any) -> float | int | None:
    if current is None:
        return 0
    if isinstance(current, bool):
        return None
    if isinstance(current, int):
        return current
    if isinstance(current, float) and math.isfinite(current):
        return current
    if isinstance(current, str):
        try:
            v = float(current)
        except ValueError:
            return None
        return v if math.isfinite(v) else None
    return None


def _fail(err: str) -> tuple[bool, dict[str, Any]]:
    return False, {
        "processResult": {
            "success": False,
            "exitCode": 1,
            "timedOut": False,
            "error": err,
        },
        "setVariableResult": {"success": False, "error": err},
    }


def execute_set_variable(
    *,
    node_id: str,
    graph_id: str,
    data: dict[str, Any],
    ctx: dict[str, Any],
) -> tuple[bool, dict[str, Any]]:
    """Compute output patch; runner merges ``runVariables`` / ``runVariablesRemove`` into context."""
    reason = set_variable_structure_invalid_reason(data)
    if reason:
        return _fail(reason)

    name = variable_name_from_data(data)
    op = normalized_operation(data)
    rv_delta: dict[str, Any] = {}
    patch_rm: list[str] = []

    pool = ctx.get("run_variables")
    if not isinstance(pool, dict):
        pool = {}
    previous = copy.deepcopy(pool.get(name)) if name in pool else None

    if op == "delete":
        patch_rm.append(name)
        new_value = None
    elif op == "set":
        new_value = copy.deepcopy(data.get("value"))
        rv_delta[name] = new_value
    elif op == "increment":
        raw_v = data.get("value")
        delta = _numeric_delta(raw_v)
        if delta is None:
            if raw_v is None or raw_v == "":
                delta = 1
            else:
                return _fail("set_variable_increment_bad_delta")
        base = _coerce_increment_base(pool.get(name))
        if base is None:
            return _fail("set_variable_increment_non_numeric")
        if isinstance(base, int) and isinstance(delta, int):
            new_value = base + delta
        else:
            new_value = float(base) + float(delta)
        rv_delta[name] = new_value
    elif op == "append":
        append_val = copy.deepcopy(data.get("value"))
        cur = pool.get(name)
        if cur is None:
            new_value = [append_val]
        elif isinstance(cur, list):
            new_value = [*cur, append_val]
        else:
            new_value = [copy.deepcopy(cur), append_val]
        rv_delta[name] = new_value
    else:
        return _fail("set_variable_invalid_operation")

    patch: dict[str, Any] = {
        "processResult": {
            "success": True,
            "exitCode": 0,
            "timedOut": False,
            "error": None,
        },
        "setVariableResult": {
            "success": True,
            "operation": op,
            "name": name,
            "previous": previous,
            "value": copy.deepcopy(new_value) if op != "delete" else None,
        },
    }
    if rv_delta:
        patch["runVariables"] = rv_delta
    if patch_rm:
        patch["runVariablesRemove"] = patch_rm
    return True, patch
