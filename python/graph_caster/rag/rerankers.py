# Copyright GraphCaster. All Rights Reserved.

"""F60 — Rerankers: Cohere (HTTP) and BGE (local sentence_transformers / BM25 fallback)."""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from graph_caster.rag.retrieval import RetrievalResult


class Reranker(ABC):
    @abstractmethod
    async def rerank(self, query: str, candidates: list["RetrievalResult"]) -> list["RetrievalResult"]:
        raise NotImplementedError


class CohereReranker(Reranker):
    """POST https://api.cohere.com/v1/rerank.

    API key from COHERE_API_KEY env or workspace secrets.
    """

    _URL = "https://api.cohere.com/v1/rerank"

    def __init__(self, api_key: str | None = None, model: str = "rerank-english-v3.0") -> None:
        self._api_key = api_key or os.environ.get("COHERE_API_KEY", "")
        self._model = model

    async def rerank(self, query: str, candidates: list["RetrievalResult"]) -> list["RetrievalResult"]:
        if not candidates:
            return candidates
        try:
            import httpx
        except ImportError as exc:
            raise RuntimeError("httpx is required for CohereReranker: pip install httpx") from exc

        docs = [c.text for c in candidates]
        payload = {
            "model": self._model,
            "query": query,
            "documents": docs,
            "top_n": len(candidates),
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient() as client:
            resp = await client.post(self._URL, json=payload, headers=headers, timeout=30.0)
            resp.raise_for_status()
            data = resp.json()

        results_raw = data.get("results", [])
        reranked: list["RetrievalResult"] = []
        for r in results_raw:
            idx = int(r["index"])
            rel_score = float(r["relevance_score"])
            item = candidates[idx]
            from graph_caster.rag.retrieval import RetrievalResult

            reranked.append(
                RetrievalResult(
                    chunk_id=item.chunk_id,
                    doc_id=item.doc_id,
                    text=item.text,
                    score=rel_score,
                    vector_score=item.vector_score,
                    keyword_score=item.keyword_score,
                    rerank_score=rel_score,
                    metadata=item.metadata,
                )
            )
        return reranked


class BGEReranker(Reranker):
    """Local reranker.

    Tries to use ``sentence_transformers.CrossEncoder`` (model BAAI/bge-reranker-base).
    Falls back to BM25 score ordering if sentence_transformers is not installed.
    """

    def __init__(self, model_name: str = "BAAI/bge-reranker-base") -> None:
        self._model_name = model_name
        self._encoder: object | None = None
        self._loaded = False

    def _try_load(self) -> bool:
        if self._loaded:
            return self._encoder is not None
        self._loaded = True
        try:
            from sentence_transformers import CrossEncoder  # type: ignore[import]

            self._encoder = CrossEncoder(self._model_name)
            return True
        except Exception:
            return False

    async def rerank(self, query: str, candidates: list["RetrievalResult"]) -> list["RetrievalResult"]:
        if not candidates:
            return candidates

        if self._try_load() and self._encoder is not None:
            pairs = [(query, c.text) for c in candidates]
            encoder = self._encoder
            scores = encoder.predict(pairs)  # type: ignore[attr-defined]
            scored = list(zip(candidates, scores))
            scored.sort(key=lambda x: float(x[1]), reverse=True)
            from graph_caster.rag.retrieval import RetrievalResult

            return [
                RetrievalResult(
                    chunk_id=c.chunk_id,
                    doc_id=c.doc_id,
                    text=c.text,
                    score=float(s),
                    vector_score=c.vector_score,
                    keyword_score=c.keyword_score,
                    rerank_score=float(s),
                    metadata=c.metadata,
                )
                for c, s in scored
            ]

        # Fallback: BM25-style ordering already present; just return as-is
        return candidates


def get_reranker(name: str) -> Reranker:
    n = name.strip().lower()
    if n == "cohere":
        return CohereReranker()
    if n in ("bge", "bge-reranker"):
        return BGEReranker()
    raise ValueError(f"Unknown reranker {name!r}. Choose 'cohere' or 'bge'.")
