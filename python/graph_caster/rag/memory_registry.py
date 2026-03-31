# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import threading

from graph_caster.rag.vector_store import InMemoryVectorStore

_lock = threading.Lock()
_stores: dict[tuple[str, str], InMemoryVectorStore] = {}


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


def get_memory_store(graph_id: str, collection_id: str) -> InMemoryVectorStore:
    key = (_norm_graph(graph_id), _norm_collection(collection_id))
    with _lock:
        st = _stores.get(key)
        if st is None:
            st = InMemoryVectorStore()
            _stores[key] = st
        return st


def clear_memory_collection(graph_id: str, collection_id: str) -> None:
    key = (_norm_graph(graph_id), _norm_collection(collection_id))
    with _lock:
        st = _stores.get(key)
        if st is not None:
            st.clear()
