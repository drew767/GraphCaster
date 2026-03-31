# Copyright Aura. All Rights Reserved.

from __future__ import annotations

from graph_caster.models import GraphDocument
from graph_caster.rag.memory_registry import clear_memory_collection
from graph_caster.rag.retriever import retrieve_from_memory
from graph_caster.runner.graph_runner import GraphRunner


def _doc_rag_pipeline(gid: str) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid, "title": "rag"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "idx",
                "type": "rag_index",
                "position": {"x": 0, "y": 0},
                "data": {
                    "collectionId": "c1",
                    "text": "alpha beta gamma uniquechunk",
                    "chunkSize": 64,
                    "chunkOverlap": 0,
                },
            },
            {
                "id": "q",
                "type": "rag_query",
                "position": {"x": 0, "y": 0},
                "data": {
                    "vectorBackend": "memory",
                    "collectionId": "c1",
                    "query": "gamma",
                    "topK": 3,
                },
            },
            {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "idx",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "e2",
                "source": "idx",
                "sourceHandle": "out_default",
                "target": "q",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "e3",
                "source": "q",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }


def test_rag_index_then_memory_query_in_runner() -> None:
    gid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    clear_memory_collection(gid, "c1")
    doc = GraphDocument.from_dict(_doc_rag_pipeline(gid))
    ev: list = []
    runner = GraphRunner(doc, sink=lambda e: ev.append(e), run_id="rid-rag-1")
    ctx: dict = {}
    runner.run_from("s", ctx)
    types = [e.get("type") for e in ev]
    assert "run_success" in types
    out_q = (ctx.get("node_outputs") or {}).get("q") or {}
    rag = out_q.get("ragResult") or {}
    assert rag.get("success") is True
    hits = rag.get("hits") or []
    assert len(hits) >= 1


def test_indexer_append_mode_adds_chunks() -> None:
    from graph_caster.rag.indexer import index_text_for_collection

    gid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    clear_memory_collection(gid, "ax")
    n1 = index_text_for_collection(gid, "ax", "hello", replace=True)
    assert n1 >= 1
    n2 = index_text_for_collection(gid, "ax", "world", replace=False)
    assert n2 >= 1
    hits = retrieve_from_memory(gid, "ax", "hello", top_k=5)
    texts = " ".join(h["content"] for h in hits)
    assert "hello" in texts and "world" in texts
