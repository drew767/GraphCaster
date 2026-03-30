# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.models import GraphDocument, Node, is_editor_frame_node_type

HANDLE_IN_DEFAULT = "in_default"
HANDLE_OUT_DEFAULT = "out_default"
HANDLE_OUT_ERROR = "out_error"

_START = "start"
_EXIT = "exit"
_TASK = "task"
_GRAPH_REF = "graph_ref"
_MCP_TOOL = "mcp_tool"
_HTTP_REQUEST = "http_request"
_RAG_QUERY = "rag_query"
_DELAY = "delay"
_DEBOUNCE = "debounce"
_WAIT_FOR = "wait_for"
_PYTHON_CODE = "python_code"
_LLM_AGENT = "llm_agent"
_COMMENT = "comment"
_GROUP = "group"
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
    if node_type in (
        _TASK,
        _GRAPH_REF,
        _MCP_TOOL,
        _HTTP_REQUEST,
        _RAG_QUERY,
        _DELAY,
        _DEBOUNCE,
        _WAIT_FOR,
        _PYTHON_CODE,
        _LLM_AGENT,
    ):
        return frozenset({HANDLE_OUT_DEFAULT, HANDLE_OUT_ERROR})
    if node_type in (_COMMENT, _GROUP):
        return frozenset()
    return frozenset({HANDLE_OUT_DEFAULT, HANDLE_OUT_ERROR})


def _allowed_target_handles(node_type: str) -> frozenset[str]:
    if node_type == _START:
        return frozenset()
    if node_type == _EXIT:
        return frozenset({HANDLE_IN_DEFAULT})
    if node_type in (_MERGE, _FORK, _AI_ROUTE):
        return frozenset({HANDLE_IN_DEFAULT})
    if node_type in (
        _TASK,
        _GRAPH_REF,
        _MCP_TOOL,
        _HTTP_REQUEST,
        _RAG_QUERY,
        _DELAY,
        _DEBOUNCE,
        _WAIT_FOR,
        _PYTHON_CODE,
        _LLM_AGENT,
    ):
        return frozenset({HANDLE_IN_DEFAULT})
    if node_type in (_COMMENT, _GROUP):
        return frozenset()
    return frozenset({HANDLE_IN_DEFAULT})


def _node_by_id(nodes: list[Node]) -> dict[str, Node]:
    return {n.id: n for n in nodes}


def edge_handles_allowed(source_type: str, source_handle: str, target_type: str, target_handle: str) -> bool:
    """True if both handles are in the static F18 contract for the node types (before port-kind checks)."""
    return source_handle in _allowed_source_handles(source_type) and target_handle in _allowed_target_handles(
        target_type
    )


def find_handle_compatibility_violations(doc: GraphDocument) -> list[dict[str, str]]:
    """
    Static handle/port compatibility (F18). Skips edges whose source or target
    is a comment or group frame. Matches UI `findHandleCompatibilityIssues`.
    """
    by_id = _node_by_id(doc.nodes)
    out: list[dict[str, str]] = []
    for e in doc.edges:
        src = by_id.get(e.source)
        tgt = by_id.get(e.target)
        if src is None or tgt is None:
            continue
        if is_editor_frame_node_type(src.type) or is_editor_frame_node_type(tgt.type):
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
