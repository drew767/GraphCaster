# Copyright Aura. All Rights Reserved.

from __future__ import annotations

from graph_caster.rag.embed_dispatch import rag_embed_chunk
from graph_caster.rag.memory_registry import get_memory_store
from graph_caster.rag.text_split import split_text_chunks


def index_text_for_collection(
    graph_id: str,
    collection_id: str,
    text: str,
    *,
    chunk_size: int = 512,
    chunk_overlap: int = 64,
    embedding_dims: int = 64,
    replace: bool = True,
) -> int:
    store = get_memory_store(graph_id, collection_id)
    if replace:
        store.clear()
    chunks = split_text_chunks(text, chunk_size=chunk_size, overlap=chunk_overlap)
    if not chunks:
        return 0
    ids: list[str] = []
    embeddings: list[list[float]] = []
    docs: list[str] = []
    metas: list[dict[str, object]] = []
    for i, ch in enumerate(chunks):
        ids.append(f"{collection_id}:{i}")
        embeddings.append(rag_embed_chunk(ch, embedding_dims))
        docs.append(ch)
        metas.append({"chunkIndex": i, "collectionId": collection_id})
    store.upsert(ids, embeddings, docs, metas)
    return len(chunks)
