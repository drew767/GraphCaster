# Copyright GraphCaster. All Rights Reserved.

"""Pure helpers shared by `GraphRunner` (context prep, node predicates, cache key hints)."""

from __future__ import annotations

from typing import Any

from graph_caster.delay_wait_exec import parse_duration_sec, parse_wait_for_file_params
from graph_caster.models import Node
from graph_caster.rag_index_exec import rag_index_has_valid_config
from graph_caster.set_variable_exec import set_variable_has_valid_config

_RUN_MODE_MAX_LEN = 128


def task_has_process_command(node: Node) -> bool:
    d = node.data
    if d.get("command") is not None or d.get("argv") is not None:
        return True
    return "gcCursorAgent" in d


def llm_agent_has_executable_command(node: Node) -> bool:
    from graph_caster.process_exec import _argv_from_data

    return bool(_argv_from_data(node.data or {}))


def http_request_has_url(node: Node) -> bool:
    u = (node.data or {}).get("url")
    return isinstance(u, str) and bool(u.strip())


def rag_query_has_url_and_query(node: Node) -> bool:
    d = node.data or {}
    q = d.get("query")
    if not isinstance(q, str) or not q.strip():
        return False
    if str(d.get("vectorBackend") or "").strip().lower() == "memory":
        cid = d.get("collectionId")
        return isinstance(cid, str) and bool(cid.strip())
    u = d.get("url")
    return isinstance(u, str) and bool(u.strip())


def python_code_has_code(node: Node) -> bool:
    c = (node.data or {}).get("code")
    return isinstance(c, str) and bool(c.strip())


def agent_has_executable_config(node: Node) -> bool:
    """In-runner ``agent`` node requires a non-empty user/prompt field."""
    d = node.data or {}
    for key in ("inputText", "input", "prompt", "userMessage"):
        v = d.get(key)
        if isinstance(v, str) and v.strip():
            return True
    return False


def delay_has_duration(node: Node) -> bool:
    return parse_duration_sec(node.data or {}) is not None


def debounce_has_duration(node: Node) -> bool:
    return delay_has_duration(node)


def wait_for_has_executable_config(node: Node) -> bool:
    d = node.data or {}
    mode = str(d.get("waitMode") or "file").strip().lower()
    if mode != "file":
        return False
    p = d.get("path")
    return (
        isinstance(p, str)
        and bool(p.strip())
        and parse_wait_for_file_params(d) is not None
    )


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
    c.setdefault("run_variables", {})
    c.setdefault("max_nesting_depth", 16)
    c.setdefault("last_result", True)
    c.setdefault("_gc_nested_doc_revisions", {})
    return c
