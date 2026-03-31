# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import os
import threading

from graph_caster.rag.vector_store import InMemoryVectorStore, VectorStore

_lock = threading.Lock()
_stores: dict[tuple[str, str], VectorStore] = {}


def _create_store(graph_id: str, collection_id: str) -> VectorStore:
    b = (os.environ.get("GC_RAG_VECTOR_BACKEND") or "memory").strip().lower()
    if b in ("", "memory", "inmemory"):
        return InMemoryVectorStore()
    if b == "chroma":
        path = (os.environ.get("GC_RAG_CHROMA_PATH") or "").strip()
        if not path:
            raise ValueError(
                "GC_RAG_CHROMA_PATH is required when GC_RAG_VECTOR_BACKEND=chroma"
            )
        from graph_caster.rag.chroma_vector_store import ChromaVectorStore

        return ChromaVectorStore(persist_path=path, graph_id=graph_id, collection_id=collection_id)
    if b == "faiss":
        from graph_caster.rag.faiss_vector_store import FaissVectorStore

        return FaissVectorStore()
    raise ValueError(
        f"Unknown GC_RAG_VECTOR_BACKEND={b!r} (expected memory, chroma, or faiss)"
    )


def _norm_graph(g: str) -> str:
    s = str(g).strip()
    if not s:
        raise ValueError("graph_id required")
    return s


def _norm_collection(c: str) -> str:
    s = str(c).strip()
    if not s:
        raise ValueError("collection_id required")
    return s


def get_memory_store(graph_id: str, collection_id: str) -> VectorStore:
    key = (_norm_graph(graph_id), _norm_collection(collection_id))
    with _lock:
        st = _stores.get(key)
        if st is None:
            st = _create_store(key[0], key[1])
            _stores[key] = st
        return st


def clear_memory_collection(graph_id: str, collection_id: str) -> None:
    key = (_norm_graph(graph_id), _norm_collection(collection_id))
    with _lock:
        st = _stores.get(key)
        if st is not None:
            st.clear()


def _reset_memory_registry_for_tests() -> None:
    """Clear cached stores (pytest / dev only; not an API guarantee for multi-tenant use)."""
    with _lock:
        _stores.clear()
