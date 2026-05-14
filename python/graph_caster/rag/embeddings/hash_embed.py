# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.rag.embedding import hash_embedding
from graph_caster.rag.embeddings.base import Embedder


class HashEmbedder(Embedder):
    """Deterministic pseudo-embedder for tests/offline dev (no model dependency)."""

    name = "hash"
    dim = 64

    def __init__(self, dims: int = 64) -> None:
        self._dims = dims

    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [hash_embedding(t, dims=self._dims) for t in texts]
