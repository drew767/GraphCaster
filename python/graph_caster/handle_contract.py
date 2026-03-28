# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.models import GraphDocument, Node

HANDLE_IN_DEFAULT = "in_default"
HANDLE_OUT_DEFAULT = "out_default"
HANDLE_OUT_ERROR = "out_error"

_START = "start"
_EXIT = "exit"
_TASK = "task"
_GRAPH_REF = "graph_ref"
_COMMENT = "comment"
_MERGE = "merge"
_FORK = "fork"
_AI_ROUTE = "ai_route"


def _allowed_source_handles(node_type: str) -> frozenset[str]:
    if node_type == _START:
        return frozenset({HANDLE_OUT_DEFAULT})
    if node_type == _EXIT:
        return frozenset()
    if node_type in (_MERGE, _FORK, _AI_ROUTE):
        return frozenset({HANDLE_OUT_DEFAULT})
    if node_type in (_TASK, _GRAPH_REF):
        return frozenset({HANDLE_OUT_DEFAULT, HANDLE_OUT_ERROR})
    if node_type == _COMMENT:
        return frozenset()
    return frozenset({HANDLE_OUT_DEFAULT, HANDLE_OUT_ERROR})


def _allowed_target_handles(node_type: str) -> frozenset[str]:
    if node_type == _START:
        return frozenset()
    if node_type == _EXIT:
        return frozenset({HANDLE_IN_DEFAULT})
    if node_type in (_MERGE, _FORK, _AI_ROUTE):
        return frozenset({HANDLE_IN_DEFAULT})
    if node_type in (_TASK, _GRAPH_REF):
        return frozenset({HANDLE_IN_DEFAULT})
    if node_type == _COMMENT:
        return frozenset()
    return frozenset({HANDLE_IN_DEFAULT})


def _node_by_id(nodes: list[Node]) -> dict[str, Node]:
    return {n.id: n for n in nodes}


def find_handle_compatibility_violations(doc: GraphDocument) -> list[dict[str, str]]:
    """
    Static handle/port compatibility (F18). Skips edges whose source or target
    is a comment node. Matches UI `findHandleCompatibilityIssues`.
    """
    by_id = _node_by_id(doc.nodes)
    out: list[dict[str, str]] = []
    for e in doc.edges:
        src = by_id.get(e.source)
        tgt = by_id.get(e.target)
        if src is None or tgt is None:
            continue
        if src.type == _COMMENT or tgt.type == _COMMENT:
            continue
        sh = e.source_handle
        th = e.target_handle
        if sh not in _allowed_source_handles(src.type):
            out.append(
                {
                    "kind": "invalid_source_handle",
                    "edgeId": e.id,
                    "nodeId": src.id,
                    "nodeType": src.type,
                    "handle": sh,
                }
            )
        if th not in _allowed_target_handles(tgt.type):
            out.append(
                {
                    "kind": "invalid_target_handle",
                    "edgeId": e.id,
                    "nodeId": tgt.id,
                    "nodeType": tgt.type,
                    "handle": th,
                }
            )
    return out
