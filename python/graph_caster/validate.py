# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from typing import Any

from graph_caster.ai_routing import edge_route_description, usable_ai_route_out_edges
from graph_caster.handle_contract import find_handle_compatibility_violations
from graph_caster.models import Edge, GraphDocument, Node

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
            if tgt is None or tgt.type == "comment":
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
            if src is None or src.type == "comment":
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
        return d.get("command") is not None or d.get("argv") is not None
    if node.type == "graph_ref":
        return True
    return False


def find_unreachable_non_comment_nodes(doc: GraphDocument, start_id: str) -> list[str]:
    """
    Node ids (excluding comment frames) with no directed path from start_id when
    every edge is treated as traversable (static over-approximation; ignores
    edge.condition and runtime branch choice).
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
        if n.type == "comment":
            continue
        if n.id not in visited:
            out.append(n.id)
    return sorted(out)


def find_merge_incoming_warnings(doc: GraphDocument) -> list[dict[str, int | str]]:
    """
    Non-blocking: merge nodes with fewer than two incoming edges from non-comment
    sources look degenerate (n8n Merge typically expects multiple inputs).
    """
    by_id = {n.id: n for n in doc.nodes}
    incoming_non_comment: dict[str, int] = {}
    for e in doc.edges:
        tgt = by_id.get(e.target)
        if tgt is None or tgt.type != "merge":
            continue
        src = by_id.get(e.source)
        if src is None or src.type == "comment":
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
