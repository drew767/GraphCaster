# Copyright GraphCaster. All Rights Reserved.

"""Pure helpers shared by `GraphRunner` (context prep, node predicates, cache key hints)."""

from __future__ import annotations

from typing import Any

from graph_caster.models import Node

_RUN_MODE_MAX_LEN = 128


def task_has_process_command(node: Node) -> bool:
    d = node.data
    if d.get("command") is not None or d.get("argv") is not None:
        return True
    return "gcCursorAgent" in d


def llm_agent_has_executable_command(node: Node) -> bool:
    from graph_caster.process_exec import _argv_from_data

    return bool(_argv_from_data(node.data or {}))


def node_wants_step_cache(node: Node) -> bool:
    v = node.data.get("stepCache")
    if v is True:
        return True
    if v in (1, "1", "true", "True", "yes", "Yes"):
        return True
    return False


def cache_key_prefix(key_hex: str) -> str:
    if len(key_hex) >= 16:
        return key_hex[:16]
    return key_hex


def normalize_run_id_candidate(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        t = value.strip()
        return t if t else None
    s = str(value).strip()
    return s if s else None


def run_mode_wire(ctx: dict[str, Any]) -> str:
    rm = ctx.get("run_mode", "manual")
    if isinstance(rm, str):
        s = rm.strip()
        out = s if s else "manual"
    elif rm is None:
        out = "manual"
    else:
        out = str(rm).strip() or "manual"
    if len(out) > _RUN_MODE_MAX_LEN:
        return out[:_RUN_MODE_MAX_LEN]
    return out


def prepare_context(ctx: dict[str, Any] | None) -> dict[str, Any]:
    c: dict[str, Any] = {} if ctx is None else ctx
    c.pop("graphs_root", None)
    c.pop("artifacts_base", None)
    c.pop("_gc_process_cancelled", None)
    c.pop("_run_cancelled", None)
    c.setdefault("nesting_depth", 0)
    c.setdefault("node_outputs", {})
    c.setdefault("max_nesting_depth", 16)
    c.setdefault("last_result", True)
    c.setdefault("_gc_nested_doc_revisions", {})
    return c
