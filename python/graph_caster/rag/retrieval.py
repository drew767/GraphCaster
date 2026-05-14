# Copyright GraphCaster. All Rights Reserved.

"""F60 — Hybrid retrieval: vector + keyword (BM25) + rerank, with RRF multiway fusion."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import StrEnum
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    pass


class RetrievalMode(StrEnum):
    VECTOR = "vector"
    KEYWORD = "keyword"
    HYBRID = "hybrid"
    FULL_TEXT = "full_text"
    MULTIWAY = "multiway"


@dataclass
class RetrievalConfig:
    mode: RetrievalMode = RetrievalMode.VECTOR
    top_k: int = 5
    score_threshold: float | None = None
    hybrid_alpha: float = 0.5
    rerank_top_n: int | None = None
    reranker: str | None = None
    metadata_filter: dict | None = None


@dataclass
class RetrievalResult:
    chunk_id: str
    doc_id: str
    text: str
    score: float
    vector_score: float | None = None
    keyword_score: float | None = None
    rerank_score: float | None = None
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "chunk_id": self.chunk_id,
            "doc_id": self.doc_id,
            "text": self.text,
            "score": self.score,
            "vector_score": self.vector_score,
            "keyword_score": self.keyword_score,
            "rerank_score": self.rerank_score,
            "metadata": self.metadata,
        }


def _normalize_scores(pairs: list[tuple[str, float]]) -> dict[str, float]:
    """Normalize a list of (id, score) so scores are in [0, 1]."""
    if not pairs:
        return {}
    max_score = max(s for _, s in pairs)
    if max_score == 0.0:
        return {doc_id: 0.0 for doc_id, _ in pairs}
    return {doc_id: score / max_score for doc_id, score in pairs}


def merge_hybrid(
    vector_hits: list[tuple[str, float]],
    keyword_hits: list[tuple[str, float]],
    alpha: float,
) -> list[tuple[str, float]]:
    """Combine vector and keyword scored lists into a single ranked list.

    alpha=1.0 → pure vector, alpha=0.0 → pure keyword.
    Each side is normalized independently by its max before combining.
    """
    vec_norm = _normalize_scores(vector_hits)
    kw_norm = _normalize_scores(keyword_hits)
    all_ids = set(vec_norm) | set(kw_norm)
    combined: list[tuple[str, float]] = []
    for doc_id in all_ids:
        v = vec_norm.get(doc_id, 0.0)
        k = kw_norm.get(doc_id, 0.0)
        combined.append((doc_id, alpha * v + (1.0 - alpha) * k))
    combined.sort(key=lambda x: x[1], reverse=True)
    return combined


def reciprocal_rank_fusion(
    ranked_lists: list[list[str]],
    k: int = 60,
) -> list[tuple[str, float]]:
    """RRF across multiple ranked id lists. Returns (id, rrf_score) sorted desc."""
    scores: dict[str, float] = {}
    for ranked in ranked_lists:
        for rank, doc_id in enumerate(ranked):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)
