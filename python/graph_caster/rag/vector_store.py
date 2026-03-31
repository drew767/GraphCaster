# Copyright Aura. All Rights Reserved.

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any, Sequence

from graph_caster.rag.embedding import cosine_similarity


def metadata_matches_row(
    meta: dict[str, Any], metadata_filter: dict[str, Any] | None
) -> bool:
    """AND-equality filter on chunk metadata (exact key match, ``meta[k] == v``)."""
    if not metadata_filter:
        return True
    for key, expected in metadata_filter.items():
        if meta.get(key) != expected:
            return False
    return True


@dataclass
class VectorHit:
    id: str
    content: str
    metadata: dict[str, Any]
    score: float


class VectorStore(ABC):
    @abstractmethod
    def upsert(
        self,
        ids: list[str],
        embeddings: list[list[float]],
        documents: list[str],
        metadatas: list[dict[str, Any]] | None = None,
    ) -> None:
        raise NotImplementedError

    @abstractmethod
    def clear(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def query(
        self,
        embedding: Sequence[float],
        top_k: int,
        *,
        metadata_filter: dict[str, Any] | None = None,
        oversample: int = 1,
    ) -> list[VectorHit]:
        raise NotImplementedError


class InMemoryVectorStore(VectorStore):
    def __init__(self) -> None:
        self._rows: list[tuple[str, list[float], str, dict[str, Any]]] = []

    def clear(self) -> None:
        self._rows.clear()

    def upsert(
        self,
        ids: list[str],
        embeddings: list[list[float]],
        documents: list[str],
        metadatas: list[dict[str, Any]] | None = None,
    ) -> None:
        if not (len(ids) == len(embeddings) == len(documents)):
            raise ValueError("ids, embeddings, documents length mismatch")
        md = metadatas or [{} for _ in ids]
        if len(md) != len(ids):
            raise ValueError("metadatas length mismatch")
        for i, e, d, m in zip(ids, embeddings, documents, md, strict=True):
            self._rows.append((i, list(e), d, dict(m)))

    def query(
        self,
        embedding: Sequence[float],
        top_k: int,
        *,
        metadata_filter: dict[str, Any] | None = None,
        oversample: int = 1,
    ) -> list[VectorHit]:
        del oversample  # full scan; oversample ignored
        k = max(1, min(100, top_k))
        scored: list[tuple[str, list[float], str, dict[str, Any], float]] = []
        for rid, emb, doc, meta in self._rows:
            if not metadata_matches_row(meta, metadata_filter):
                continue
            scored.append((rid, emb, doc, meta, cosine_similarity(embedding, emb)))
        scored.sort(key=lambda t: t[4], reverse=True)
        return [
            VectorHit(id=t[0], content=t[2], metadata=t[3], score=t[4]) for t in scored[:k]
        ]
