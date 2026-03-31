# Copyright Aura. All Rights Reserved.

from __future__ import annotations

from typing import Any

from graph_caster.expression.templates import render_template
from graph_caster.models import Node
from graph_caster.runner.expression_conditions import runner_predicate_to_expression_context
from graph_caster.rag.indexer import index_text_for_collection


def rag_index_structure_invalid_reason(data: dict[str, Any]) -> str | None:
    cid = str(data.get("collectionId") or data.get("collection_id") or "").strip()
    if not cid:
        return "rag_index_empty_collection_id"
    raw = data.get("text")
    if raw is None or not str(raw).strip():
        return "rag_index_empty_text"
    return None


def rag_index_has_valid_config(node: Node) -> bool:
    return rag_index_structure_invalid_reason(node.data or {}) is None


def execute_rag_index(
    *,
    node_id: str,
    graph_id: str,
    data: dict[str, Any],
    ctx: dict[str, Any],
) -> tuple[bool, dict[str, Any]]:
    reason = rag_index_structure_invalid_reason(data)
    if reason:
        return False, {
            "processResult": {
                "success": False,
                "exitCode": 1,
                "timedOut": False,
                "error": reason,
            },
            "ragIndexResult": {"success": False, "error": reason},
        }

    tmpl_ctx = dict(runner_predicate_to_expression_context(ctx))
    cid = str(
        render_template(
            str(data.get("collectionId") or data.get("collection_id") or "").strip(),
            tmpl_ctx,
        ).strip()
    )
    text = render_template(str(data.get("text") or "").strip(), tmpl_ctx).strip()
    if not cid or not text:
        err = "rag_index_empty_collection_id" if not cid else "rag_index_empty_text"
        return False, {
            "processResult": {
                "success": False,
                "exitCode": 1,
                "timedOut": False,
                "error": err,
            },
            "ragIndexResult": {"success": False, "error": err},
        }

    cs = data.get("chunkSize", 512)
    co = data.get("chunkOverlap", 64)
    ed = data.get("embeddingDims", 64)
    try:
        chunk_size = int(cs)
    except (TypeError, ValueError):
        chunk_size = 512
    try:
        chunk_overlap = int(co)
    except (TypeError, ValueError):
        chunk_overlap = 64
    try:
        embedding_dims = int(ed)
    except (TypeError, ValueError):
        embedding_dims = 64

    mode = str(data.get("mode") or "replace").strip().lower()
    replace = mode != "append"

    try:
        n = index_text_for_collection(
            graph_id,
            cid,
            text,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            embedding_dims=embedding_dims,
            replace=replace,
        )
    except ValueError as e:
        err = str(e)
        return False, {
            "processResult": {
                "success": False,
                "exitCode": 1,
                "timedOut": False,
                "error": err,
            },
            "ragIndexResult": {"success": False, "error": err},
        }

    return True, {
        "processResult": {
            "success": True,
            "exitCode": 0,
            "timedOut": False,
            "error": None,
        },
        "ragIndexResult": {
            "success": True,
            "collectionId": cid,
            "chunksIndexed": n,
            "mode": "replace" if replace else "append",
            "nodeId": node_id,
        },
    }
