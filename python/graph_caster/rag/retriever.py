# Copyright Aura. All Rights Reserved.

from __future__ import annotations

from typing import Any

from graph_caster.rag.embedding import hash_embedding
from graph_caster.rag.memory_registry import get_memory_store


def retrieve_from_memory(
    graph_id: str,
    collection_id: str,
    query: str,
    *,
    top_k: int = 5,
    embedding_dims: int = 64,
) -> list[dict[str, Any]]:
    store = get_memory_store(graph_id, collection_id)
    qv = hash_embedding(query.strip(), dims=embedding_dims)
    hits = store.query(qv, top_k)
    return [
        {
            "id": h.id,
            "content": h.content,
            "metadata": h.metadata,
            "score": h.score,
        }
        for h in hits
    ]
