# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from typing import Any, Literal, cast

from graph_caster.handle_contract import (
    HANDLE_IN_DEFAULT,
    HANDLE_OUT_DEFAULT,
    HANDLE_OUT_ERROR,
    edge_handles_allowed,
)
from graph_caster.models import Edge, GraphDocument, is_editor_frame_node_type

PortDataKind = Literal["any", "json", "primitive"]

# Must match PORT_KINDS in ui/src/graph/portDataKinds.ts when adding kinds.
_PORT_KIND_SET: frozenset[str] = frozenset({"any", "json", "primitive"})


def coerce_port_kind_override(raw: Any) -> PortDataKind | None:
    """Return a kind only for valid enum strings; invalid values are ignored (no load-time error)."""
    if raw is None:
        return None
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    if s in _PORT_KIND_SET:
        return cast(PortDataKind, s)
    return None


def _edge_data_dict(edge: Edge) -> dict[str, Any]:
    return edge.data if isinstance(edge.data, dict) else {}


def effective_port_kind_for_source(edge: Edge, node_type: str, handle: str) -> PortDataKind:
    base = port_data_kind_for_source(node_type, handle)
    o = coerce_port_kind_override(_edge_data_dict(edge).get("sourcePortKind"))
    return o if o is not None else base


def effective_port_kind_for_target(edge: Edge, node_type: str, handle: str) -> PortDataKind:
    base = port_data_kind_for_target(node_type, handle)
    o = coerce_port_kind_override(_edge_data_dict(edge).get("targetPortKind"))
    return o if o is not None else base


# Node types allowed to emit out_default (per handle contract), excluding out_error.
_SOURCE_OUT_DEFAULT_JSON = frozenset(
    {
        "start",
        "task",
        "graph_ref",
        "mcp_tool",
        "http_request",
        "rag_query",
        "delay",
        "debounce",
        "wait_for",
        "python_code",
        "llm_agent",
        "merge",
        "fork",
        "ai_route",
    }
)

# Node types allowed to accept in_default.
_TARGET_IN_DEFAULT_JSON = frozenset(
    {
        "exit",
        "task",
        "graph_ref",
        "mcp_tool",
        "http_request",
        "rag_query",
        "delay",
        "debounce",
        "wait_for",
        "python_code",
        "llm_agent",
        "merge",
        "fork",
        "ai_route",
    }
)


def port_data_kind_for_source(node_type: str, handle: str) -> PortDataKind:
    if handle == HANDLE_OUT_ERROR:
        return "any"
    if handle != HANDLE_OUT_DEFAULT:
        return "any"
    if node_type in _SOURCE_OUT_DEFAULT_JSON:
        return "json"
    return "any"


def port_data_kind_for_target(node_type: str, handle: str) -> PortDataKind:
    if handle != HANDLE_IN_DEFAULT:
        return "any"
    if node_type in _TARGET_IN_DEFAULT_JSON:
        return "json"
    return "any"


def classify_port_kind_pair(out_kind: PortDataKind, in_kind: PortDataKind) -> Literal["ok", "warn", "block"]:
    """
    ``warn`` (e.g. json↔primitive): non-blocking; does not raise GraphStructureError.
    ``block``: reserved for future PortDataKind pairs; same non-blocking policy in v1 until tied to validate.
    """
    if out_kind == "any" or in_kind == "any":
        return "ok"
    if out_kind == in_kind:
        return "ok"
    if (out_kind == "json" and in_kind == "primitive") or (out_kind == "primitive" and in_kind == "json"):
        return "warn"
    return "block"


def find_port_data_kind_warnings(doc: GraphDocument) -> list[dict[str, Any]]:
    """Non-blocking port kind issues (F18). Matches UI `findHandleCompatibilityIssues` port kinds (incl. edge data overrides)."""
    by_id = {n.id: n for n in doc.nodes}
    out: list[dict[str, Any]] = []
    for e in doc.edges:
        src = by_id.get(e.source)
        tgt = by_id.get(e.target)
        if src is None or tgt is None:
            continue
        if is_editor_frame_node_type(src.type) or is_editor_frame_node_type(tgt.type):
            continue
        sh = e.source_handle
        th = e.target_handle
        if not edge_handles_allowed(src.type, sh, tgt.type, th):
            continue
        out_k = effective_port_kind_for_source(e, src.type, sh)
        in_k = effective_port_kind_for_target(e, tgt.type, th)
        verdict = classify_port_kind_pair(out_k, in_k)
        if verdict == "warn":
            out.append(
                {
                    "kind": "port_data_kind_mismatch",
                    "edgeId": e.id,
                    "sourceId": src.id,
                    "targetId": tgt.id,
                    "sourceHandle": sh,
                    "targetHandle": th,
                    "sourceKind": out_k,
                    "targetKind": in_k,
                }
            )
        elif verdict == "block":
            out.append(
                {
                    "kind": "port_data_kind_incompatible",
                    "edgeId": e.id,
                    "sourceId": src.id,
                    "targetId": tgt.id,
                    "sourceHandle": sh,
                    "targetHandle": th,
                    "sourceKind": out_k,
                    "targetKind": in_k,
                }
            )
    return out
