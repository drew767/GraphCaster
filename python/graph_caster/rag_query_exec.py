# Copyright GraphCaster. All Rights Reserved.

"""RAG / vector query node: builds an HTTP request from ``query`` + endpoint and delegates to ``execute_http_request``."""

from __future__ import annotations

import json
from typing import Any, Callable

from graph_caster.expression.templates import render_template
from graph_caster.http_request_exec import execute_http_request, redact_http_request_data_for_execute
from graph_caster.rag.retriever import retrieve_from_memory
from graph_caster.runner.expression_conditions import runner_predicate_to_expression_context

EmitFn = Callable[..., None]


def _template_context(ctx: dict[str, Any]) -> dict[str, Any]:
    return dict(runner_predicate_to_expression_context(ctx))


def _top_k(data: dict[str, Any], default: int = 5) -> int:
    v = data.get("topK", default)
    try:
        n = int(v)
    except (TypeError, ValueError):
        n = default
    return max(1, min(100, n))


def _execute_rag_memory_query(
    *,
    node_id: str,
    graph_id: str,
    data: dict[str, Any],
    tmpl_ctx: dict[str, Any],
    emit: EmitFn,
    attempt: int,
    should_cancel: Callable[[], bool] | None,
) -> tuple[bool, dict[str, Any]]:
    if should_cancel is not None and should_cancel():
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=0,
            timedOut=False,
            attempt=attempt,
            success=False,
            stdoutTail="",
            stderrTail="rag_query_cancelled",
        )
        err = "rag_query_cancelled"
        return False, {
            "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": err},
            "httpResult": {
                "success": False,
                "statusCode": 0,
                "error": err,
                "bodyText": "",
                "bodyJson": None,
            },
            "ragResult": {"success": False, "error": err},
        }

    raw_coll = data.get("collectionId")
    cid = (
        render_template(str(raw_coll).strip(), tmpl_ctx).strip()
        if raw_coll is not None and str(raw_coll).strip()
        else ""
    )
    if not cid:
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=0,
            timedOut=False,
            attempt=attempt,
            success=False,
            stdoutTail="",
            stderrTail="rag_memory_empty_collection",
        )
        err = "rag_memory_empty_collection"
        return False, {
            "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": err},
            "httpResult": {
                "success": False,
                "statusCode": 0,
                "error": err,
                "bodyText": "",
                "bodyJson": None,
            },
            "ragResult": {"success": False, "error": err},
        }

    raw_query = data.get("query")
    if not isinstance(raw_query, str) or not raw_query.strip():
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=0,
            timedOut=False,
            attempt=attempt,
            success=False,
            stdoutTail="",
            stderrTail="rag_query_empty_query",
        )
        err = "rag_query_empty_query"
        return False, {
            "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": err},
            "httpResult": {
                "success": False,
                "statusCode": 0,
                "error": err,
                "bodyText": "",
                "bodyJson": None,
            },
            "ragResult": {"success": False, "error": err},
        }

    q = render_template(raw_query.strip(), tmpl_ctx).strip()
    if not q:
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=0,
            timedOut=False,
            attempt=attempt,
            success=False,
            stdoutTail="",
            stderrTail="rag_query_empty_query_rendered",
        )
        err = "rag_query_empty_query_rendered"
        return False, {
            "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": err},
            "httpResult": {
                "success": False,
                "statusCode": 0,
                "error": err,
                "bodyText": "",
                "bodyJson": None,
            },
            "ragResult": {"success": False, "error": err},
        }

    top_k = _top_k(data)
    ed_raw = data.get("embeddingDims", 64)
    try:
        embedding_dims = int(ed_raw)
    except (TypeError, ValueError):
        embedding_dims = 64
    embedding_dims = max(8, min(4096, embedding_dims))

    hits = retrieve_from_memory(
        graph_id, cid, q, top_k=top_k, embedding_dims=embedding_dims
    )
    body = json.dumps({"hits": hits, "query": q, "collectionId": cid}, ensure_ascii=False)
    emit(
        "process_complete",
        nodeId=node_id,
        graphId=graph_id,
        exitCode=0,
        timedOut=False,
        attempt=attempt,
        success=True,
        stdoutTail="",
        stderrTail="",
    )
    return True, {
        "processResult": {"success": True, "exitCode": 0, "timedOut": False, "error": None},
        "httpResult": {
            "success": True,
            "statusCode": 200,
            "error": None,
            "bodyText": body,
            "bodyJson": {"hits": hits, "query": q, "collectionId": cid},
        },
        "ragResult": {
            "success": True,
            "query": q,
            "topK": top_k,
            "collectionId": cid,
            "vectorBackend": "memory",
            "hits": hits,
        },
    }


def redact_rag_query_data_for_execute(data: dict[str, Any]) -> dict[str, Any]:
    out = redact_http_request_data_for_execute(dict(data))
    q = out.get("query")
    if isinstance(q, str) and len(q) > 8000:
        out["query"] = q[:8000] + "…<truncated>"
    b = out.get("body")
    if isinstance(b, str) and len(b) > 8000:
        out["body"] = b[:8000] + "…<truncated>"
    return out


def execute_rag_query(
    *,
    node_id: str,
    graph_id: str,
    data: dict[str, Any],
    ctx: dict[str, Any],
    emit: EmitFn,
    attempt: int = 0,
    should_cancel: Callable[[], bool] | None = None,
) -> tuple[bool, dict[str, Any]]:
    """
    One vector-search HTTP round-trip. Requires non-empty ``url`` and ``query`` (after trim).
    Default ``POST`` with JSON body ``{"query", "top_k", optional ``collection_id``} unless ``body`` is set.
    Templates in ``query``, ``url``, ``collectionId``, ``body`` see extra keys ``rag_query``, ``ragQuery``, ``top_k``, ``collection_id``.
    When ``vectorBackend`` is ``memory``, queries the in-process store populated by ``rag_index`` (no HTTP).
    """
    tmpl_ctx = _template_context(ctx)
    backend = str(data.get("vectorBackend") or "").strip().lower()
    if backend == "memory":
        return _execute_rag_memory_query(
            node_id=node_id,
            graph_id=graph_id,
            data=data,
            tmpl_ctx=tmpl_ctx,
            emit=emit,
            attempt=attempt,
            should_cancel=should_cancel,
        )

    raw_url = data.get("url")
    if not isinstance(raw_url, str) or not raw_url.strip():
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=0,
            timedOut=False,
            attempt=attempt,
            success=False,
            stdoutTail="",
            stderrTail="rag_query_empty_url",
        )
        err = "rag_query_empty_url"
        return False, {
            "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": err},
            "httpResult": {
                "success": False,
                "statusCode": 0,
                "error": err,
                "bodyText": "",
                "bodyJson": None,
            },
            "ragResult": {"success": False, "error": err},
        }

    raw_query = data.get("query")
    if not isinstance(raw_query, str) or not raw_query.strip():
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=0,
            timedOut=False,
            attempt=attempt,
            success=False,
            stdoutTail="",
            stderrTail="rag_query_empty_query",
        )
        err = "rag_query_empty_query"
        return False, {
            "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": err},
            "httpResult": {
                "success": False,
                "statusCode": 0,
                "error": err,
                "bodyText": "",
                "bodyJson": None,
            },
            "ragResult": {"success": False, "error": err},
        }

    query_rendered = render_template(raw_query.strip(), tmpl_ctx).strip()
    if not query_rendered:
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=0,
            timedOut=False,
            attempt=attempt,
            success=False,
            stdoutTail="",
            stderrTail="rag_query_empty_query_rendered",
        )
        err = "rag_query_empty_query_rendered"
        return False, {
            "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": err},
            "httpResult": {
                "success": False,
                "statusCode": 0,
                "error": err,
                "bodyText": "",
                "bodyJson": None,
            },
            "ragResult": {"success": False, "error": err},
        }

    top_k = _top_k(data)
    raw_coll = data.get("collectionId")
    coll_raw = str(raw_coll).strip() if raw_coll is not None else ""
    coll_rendered = render_template(coll_raw, tmpl_ctx).strip() if coll_raw else ""

    method = str(data.get("method") or "POST").strip().upper() or "POST"
    if method not in (
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
    ):
        method = "POST"

    template_extras: dict[str, Any] = {
        "rag_query": query_rendered,
        "ragQuery": query_rendered,
        "top_k": top_k,
        "collection_id": coll_rendered,
    }

    body_literal = False
    body_str: str | None = None
    raw_body = data.get("body")
    if isinstance(raw_body, str) and raw_body.strip():
        body_str = render_template(raw_body.strip(), {**tmpl_ctx, **template_extras})
        body_literal = True
    elif method in ("POST", "PUT", "PATCH"):
        payload: dict[str, Any] = {"query": query_rendered, "top_k": top_k}
        if coll_rendered:
            payload["collection_id"] = coll_rendered
        body_str = json.dumps(payload, ensure_ascii=False)
        body_literal = True

    http_data: dict[str, Any] = {
        "url": data.get("url"),
        "method": method,
        "headers": data.get("headers") if isinstance(data.get("headers"), dict) else {},
        "auth": data.get("auth"),
        "timeoutSec": data.get("timeoutSec"),
        "verifyTls": data.get("verifyTls"),
        "parseResponseBody": data.get("parseResponseBody", "auto"),
    }
    if body_str is not None:
        http_data["body"] = body_str
    if body_literal:
        http_data["bodyLiteral"] = True

    ok, patch = execute_http_request(
        node_id=node_id,
        graph_id=graph_id,
        data=http_data,
        ctx=ctx,
        emit=emit,
        attempt=attempt,
        should_cancel=should_cancel,
        template_context_extra=template_extras,
    )
    patch["ragResult"] = {
        "success": ok,
        "query": query_rendered,
        "topK": top_k,
        "collectionId": coll_rendered or None,
    }
    return ok, patch
