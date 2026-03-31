# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from typing import Any

from graph_caster.ai_routing import edge_route_description, usable_ai_route_out_edges
from graph_caster.handle_contract import find_handle_compatibility_violations
from graph_caster.delay_wait_exec import parse_duration_sec, parse_wait_for_file_params
from graph_caster.models import Edge, GraphDocument, Node, is_editor_frame_node_type
from graph_caster.rag_index_exec import rag_index_structure_invalid_reason
from graph_caster.set_variable_exec import set_variable_structure_invalid_reason

_OUT_ERROR_HANDLE = "out_error"


def merge_mode(node: Node) -> str:
    if node.type != "merge":
        return "passthrough"
    v = node.data.get("mode")
    if v is None:
        return "passthrough"
    s = str(v).strip().lower()
    return "barrier" if s == "barrier" else "passthrough"


def find_fork_few_outputs_warnings(doc: GraphDocument) -> list[dict[str, int | str]]:
    by_id = {n.id: n for n in doc.nodes}
    out: list[dict[str, int | str]] = []
    for n in doc.nodes:
        if n.type != "fork":
            continue
        cnt = 0
        for e in doc.edges:
            if e.source != n.id:
                continue
            if e.source_handle == _OUT_ERROR_HANDLE:
                continue
            tgt = by_id.get(e.target)
            if tgt is None or is_editor_frame_node_type(tgt.type):
                continue
            c = e.condition
            if c is not None and str(c).strip() != "":
                continue
            cnt += 1
        if cnt < 2:
            out.append({"nodeId": n.id, "unconditionalOutgoing": cnt})
    return out


def find_barrier_merge_out_error_incoming(doc: GraphDocument) -> list[dict[str, str]]:
    by_id = {n.id: n for n in doc.nodes}
    out: list[dict[str, str]] = []
    for e in doc.edges:
        if e.source_handle != _OUT_ERROR_HANDLE:
            continue
        tgt = by_id.get(e.target)
        if tgt is None or tgt.type != "merge":
            continue
        if merge_mode(tgt) != "barrier":
            continue
        out.append({"edgeId": e.id, "mergeNodeId": tgt.id})
    return out


def find_barrier_merge_no_success_incoming_warnings(doc: GraphDocument) -> list[dict[str, str]]:
    by_id = {n.id: n for n in doc.nodes}
    out: list[dict[str, str]] = []
    for n in doc.nodes:
        if n.type != "merge" or merge_mode(n) != "barrier":
            continue
        ok = False
        for e in doc.edges:
            if e.target != n.id or e.source_handle == _OUT_ERROR_HANDLE:
                continue
            src = by_id.get(e.source)
            if src is None or is_editor_frame_node_type(src.type):
                continue
            ok = True
            break
        if not ok:
            out.append({"nodeId": n.id})
    return out


def _node_can_emit_fail_branch(node: Node | None) -> bool:
    if node is None:
        return False
    if node.type == "task":
        d = node.data
        return (
            d.get("command") is not None
            or d.get("argv") is not None
            or "gcCursorAgent" in d
        )
    if node.type == "graph_ref":
        return True
    if node.type == "mcp_tool":
        return True
    if node.type == "http_request":
        u = (node.data or {}).get("url")
        return isinstance(u, str) and bool(u.strip())
    if node.type == "python_code":
        c = (node.data or {}).get("code")
        return isinstance(c, str) and bool(c.strip())
    if node.type == "rag_query":
        d = node.data or {}
        q = d.get("query")
        if not isinstance(q, str) or not q.strip():
            return False
        if str(d.get("vectorBackend") or "").strip().lower() == "memory":
            cid = d.get("collectionId")
            return isinstance(cid, str) and bool(cid.strip())
        u = d.get("url")
        return isinstance(u, str) and bool(u.strip())
    if node.type == "rag_index":
        return rag_index_structure_invalid_reason(node.data or {}) is None
    if node.type == "llm_agent":
        from graph_caster.process_exec import _argv_from_data

        return bool(_argv_from_data(node.data or {}))
    if node.type in ("delay", "debounce"):
        return parse_duration_sec(node.data or {}) is not None
    if node.type == "wait_for":
        d = node.data or {}
        mode = str(d.get("waitMode") or "file").strip().lower()
        if mode != "file":
            return False
        p = d.get("path")
        return isinstance(p, str) and bool(p.strip()) and parse_wait_for_file_params(d) is not None
    if node.type == "set_variable":
        return set_variable_structure_invalid_reason(node.data or {}) is None
    return False


def find_http_request_structure_warnings(doc: GraphDocument) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in doc.nodes:
        if n.type != "http_request":
            continue
        u = (n.data or {}).get("url")
        if not isinstance(u, str) or not u.strip():
            out.append({"kind": "http_request_empty_url", "nodeId": n.id})
    return out


def find_python_code_structure_warnings(doc: GraphDocument) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in doc.nodes:
        if n.type != "python_code":
            continue
        c = (n.data or {}).get("code")
        if not isinstance(c, str) or not c.strip():
            out.append({"kind": "python_code_empty_code", "nodeId": n.id})
    return out


def find_set_variable_structure_warnings(doc: GraphDocument) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in doc.nodes:
        if n.type != "set_variable":
            continue
        if set_variable_structure_invalid_reason(n.data or {}) is not None:
            out.append({"kind": "set_variable_invalid_config", "nodeId": n.id})
    return out


def find_delay_structure_warnings(doc: GraphDocument) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in doc.nodes:
        if n.type != "delay":
            continue
        if parse_duration_sec(n.data or {}) is None:
            out.append({"kind": "delay_invalid_duration", "nodeId": n.id})
    return out


def find_debounce_structure_warnings(doc: GraphDocument) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in doc.nodes:
        if n.type != "debounce":
            continue
        if parse_duration_sec(n.data or {}) is None:
            out.append({"kind": "debounce_invalid_duration", "nodeId": n.id})
    return out


def find_wait_for_structure_warnings(doc: GraphDocument) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in doc.nodes:
        if n.type != "wait_for":
            continue
        d = n.data or {}
        mode = str(d.get("waitMode") or "file").strip().lower()
        if mode != "file":
            out.append({"kind": "wait_for_unknown_mode", "nodeId": n.id})
            continue
        p = d.get("path")
        if not isinstance(p, str) or not p.strip():
            out.append({"kind": "wait_for_empty_path", "nodeId": n.id})
        if parse_wait_for_file_params(d) is None:
            out.append({"kind": "wait_for_invalid_timeout", "nodeId": n.id})
    return out


def find_rag_query_structure_warnings(doc: GraphDocument) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in doc.nodes:
        if n.type != "rag_query":
            continue
        d = n.data or {}
        memory = str(d.get("vectorBackend") or "").strip().lower() == "memory"
        if memory:
            cid = d.get("collectionId")
            if not isinstance(cid, str) or not cid.strip():
                out.append({"kind": "rag_memory_empty_collection", "nodeId": n.id})
        else:
            u = d.get("url")
            if not isinstance(u, str) or not u.strip():
                out.append({"kind": "rag_query_empty_url", "nodeId": n.id})
        q = d.get("query")
        if not isinstance(q, str) or not q.strip():
            out.append({"kind": "rag_query_empty_query", "nodeId": n.id})
    return out


def find_rag_index_structure_warnings(doc: GraphDocument) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in doc.nodes:
        if n.type != "rag_index":
            continue
        r = rag_index_structure_invalid_reason(n.data or {})
        if r == "rag_index_empty_collection_id":
            out.append({"kind": "rag_index_empty_collection_id", "nodeId": n.id})
        elif r == "rag_index_empty_text":
            out.append({"kind": "rag_index_empty_text", "nodeId": n.id})
    return out


def find_mcp_tool_structure_warnings(doc: GraphDocument) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in doc.nodes:
        if n.type != "mcp_tool":
            continue
        d = n.data
        tn = str(d.get("toolName") or "").strip()
        if not tn:
            out.append({"kind": "mcp_tool_empty_tool_name", "nodeId": n.id})
        transport = str(d.get("transport") or "stdio").strip()
        if transport == "stdio":
            cmd = d.get("command")
            argv = d.get("argv")
            has_stdio = isinstance(argv, list) and len(argv) > 0
            if not has_stdio and cmd is not None:
                if isinstance(cmd, str) and cmd.strip() != "":
                    has_stdio = True
                elif isinstance(cmd, list) and len(cmd) > 0:
                    has_stdio = True
            if not has_stdio:
                out.append({"kind": "mcp_tool_stdio_missing_command", "nodeId": n.id})
        elif transport == "streamable_http":
            url = str(d.get("serverUrl") or "").strip()
            if not url:
                out.append({"kind": "mcp_tool_http_empty_url", "nodeId": n.id})
        else:
            out.append({"kind": "mcp_tool_unknown_transport", "nodeId": n.id, "transport": transport})
    return out


def find_unreachable_non_frame_nodes(doc: GraphDocument, start_id: str) -> list[str]:
    """
    Node ids for non-frame nodes (excludes editor-only ``comment`` / ``group``) with no
    directed path from ``start_id`` when every edge is treated as traversable (static
    over-approximation; ignores ``edge.condition`` and runtime branch choice).
    """
    adj: dict[str, set[str]] = {}
    for e in doc.edges:
        adj.setdefault(e.source, set()).add(e.target)
    visited: set[str] = set()
    stack = [start_id]
    visited.add(start_id)
    while stack:
        u = stack.pop()
        for v in adj.get(u, ()):
            if v not in visited:
                visited.add(v)
                stack.append(v)
    out: list[str] = []
    for n in doc.nodes:
        if is_editor_frame_node_type(n.type):
            continue
        if n.id not in visited:
            out.append(n.id)
    return sorted(out)


def find_unreachable_non_comment_nodes(doc: GraphDocument, start_id: str) -> list[str]:
    """Backward-compatible name for :func:`find_unreachable_non_frame_nodes`."""
    return find_unreachable_non_frame_nodes(doc, start_id)


def find_merge_incoming_warnings(doc: GraphDocument) -> list[dict[str, int | str]]:
    """
    Non-blocking: merge nodes with fewer than two incoming edges from non-frame
    sources (excludes comment/group) look degenerate (n8n Merge typically expects
    multiple inputs).
    """
    by_id = {n.id: n for n in doc.nodes}
    incoming_non_comment: dict[str, int] = {}
    for e in doc.edges:
        tgt = by_id.get(e.target)
        if tgt is None or tgt.type != "merge":
            continue
        src = by_id.get(e.source)
        if src is None or is_editor_frame_node_type(src.type):
            continue
        incoming_non_comment[tgt.id] = incoming_non_comment.get(tgt.id, 0) + 1
    out: list[dict[str, int | str]] = []
    for n in doc.nodes:
        if n.type != "merge":
            continue
        cnt = incoming_non_comment.get(n.id, 0)
        if cnt < 2:
            out.append({"nodeId": n.id, "incomingEdges": cnt})
    return out


def find_llm_agent_structure_warnings(doc: GraphDocument) -> list[dict[str, Any]]:
    from graph_caster.process_exec import _argv_from_data

    out: list[dict[str, Any]] = []
    for n in doc.nodes:
        if n.type != "llm_agent":
            continue
        if not _argv_from_data(n.data or {}):
            out.append({"kind": "llm_agent_empty_command", "nodeId": n.id})
    return out


def find_agent_structure_warnings(doc: GraphDocument) -> list[dict[str, Any]]:
    from graph_caster.runner.run_helpers import agent_has_executable_config

    out: list[dict[str, Any]] = []
    for n in doc.nodes:
        if n.type != "agent":
            continue
        if not agent_has_executable_config(n):
            out.append({"kind": "agent_missing_prompt", "nodeId": n.id})
    return out


def find_ai_route_structure_warnings(doc: GraphDocument) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for n in doc.nodes:
        if n.type != "ai_route":
            continue
        usable = usable_ai_route_out_edges(doc, n.id)
        if len(usable) == 0:
            out.append({"kind": "ai_route_no_outgoing", "nodeId": n.id, "outgoingEdges": 0})
            continue
        if len(usable) > 1:
            missing = sum(1 for e in usable if not str(edge_route_description(e)).strip())
            if missing > 0:
                out.append(
                    {
                        "kind": "ai_route_missing_route_descriptions",
                        "nodeId": n.id,
                        "outgoingEdges": len(usable),
                        "missingDescriptions": missing,
                    }
                )
    return out


def find_unreachable_out_error_sources(doc: GraphDocument) -> list[str]:
    """
    Source node ids that have at least one out_error edge but whose type cannot
    emit the runner's fail-branch (same rule as error_route in GraphRunner).
    """
    by_id = {n.id: n for n in doc.nodes}
    seen: set[str] = set()
    out: list[str] = []
    for e in doc.edges:
        if e.source_handle != _OUT_ERROR_HANDLE:
            continue
        nid = e.source
        if nid in seen:
            continue
        if _node_can_emit_fail_branch(by_id.get(nid)):
            continue
        seen.add(nid)
        out.append(nid)
    return out


class GraphStructureError(ValueError):
    pass


def validate_graph_structure(doc: GraphDocument) -> str:
    """
    Returns the start node id if the document is structurally valid.
    Raises GraphStructureError otherwise.
    """
    starts = [n for n in doc.nodes if n.type == "start"]
    if len(starts) == 0:
        raise GraphStructureError("graph must have exactly one node of type 'start', got none")
    if len(starts) > 1:
        raise GraphStructureError(f"graph must have exactly one node of type 'start', got {len(starts)}")
    start_id = starts[0].id
    for e in doc.edges:
        if e.target == start_id:
            raise GraphStructureError(f"start node '{start_id}' must not have incoming edges (edge '{e.id}' targets it)")
    gid = str(doc.graph_id).strip() if doc.graph_id else ""
    if not gid or gid == "default":
        raise GraphStructureError("meta.graphId (or top-level graphId) must be set to a non-empty unique id")
    violations = find_handle_compatibility_violations(doc)
    if violations:
        v = violations[0]
        kind = v["kind"]
        if kind == "invalid_source_handle":
            raise GraphStructureError(
                f"edge '{v['edgeId']}': invalid source handle '{v['handle']}' "
                f"for node '{v['nodeId']}' (type {v['nodeType']})"
            )
        if kind == "invalid_target_handle":
            raise GraphStructureError(
                f"edge '{v['edgeId']}': invalid target handle '{v['handle']}' "
                f"for node '{v['nodeId']}' (type {v['nodeType']})"
            )
        raise GraphStructureError(
            f"edge '{v['edgeId']}': invalid handle compatibility ({kind!r}) "
            f"for node '{v['nodeId']}' (type {v['nodeType']}), handle '{v['handle']}'"
        )
    return start_id
