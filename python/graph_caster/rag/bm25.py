# Copyright GraphCaster. All Rights Reserved.

"""Pure-Python BM25 index. No heavy dependencies; suitable for <100K docs."""

from __future__ import annotations

import json
import math
import re
from pathlib import Path
from typing import Any

_STOPWORDS: frozenset[str] = frozenset(
    {
        "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "is", "it", "its", "was", "are", "be",
        "been", "being", "that", "this", "as", "not", "no", "we", "i", "you",
        "he", "she", "they", "their", "our", "your", "my", "his", "her", "do",
        "did", "does", "have", "has", "had", "will", "would", "can", "could",
        "should", "shall", "may", "might", "if", "then", "than", "so", "up",
        "into", "about", "also",
    }
)


def _tokenize(text: str) -> list[str]:
    tokens = re.split(r"\W+", text.lower())
    return [t for t in tokens if t and t not in _STOPWORDS]


class BM25Index:
    """Okapi BM25 over a collection of (doc_id, text) pairs."""

    def __init__(self, k1: float = 1.5, b: float = 0.75) -> None:
        self._k1 = k1
        self._b = b
        self._docs: dict[str, list[str]] = {}
        self._df: dict[str, int] = {}
        self._avgdl: float = 0.0

    def _recompute_stats(self) -> None:
        if not self._docs:
            self._df = {}
            self._avgdl = 0.0
            return
        df: dict[str, int] = {}
        total_len = 0
        for tokens in self._docs.values():
            total_len += len(tokens)
            for t in set(tokens):
                df[t] = df.get(t, 0) + 1
        self._df = df
        self._avgdl = total_len / len(self._docs)

    def add(self, doc_id: str, text: str) -> None:
        self._docs[doc_id] = _tokenize(text)
        self._recompute_stats()

    def remove(self, doc_id: str) -> None:
        if doc_id in self._docs:
            del self._docs[doc_id]
            self._recompute_stats()

    def search(self, query: str, top_k: int = 5) -> list[tuple[str, float]]:
        """Return [(doc_id, bm25_score)] sorted descending, length <= top_k."""
        qtokens = _tokenize(query)
        if not qtokens or not self._docs:
            return []
        n = len(self._docs)
        scores: dict[str, float] = {}
        for token in qtokens:
            df_t = self._df.get(token, 0)
            if df_t == 0:
                continue
            idf = math.log((n - df_t + 0.5) / (df_t + 0.5) + 1)
            for doc_id, tokens in self._docs.items():
                tf = tokens.count(token)
                if tf == 0:
                    continue
                dl = len(tokens)
                denom = tf + self._k1 * (1 - self._b + self._b * dl / max(self._avgdl, 1))
                scores[doc_id] = scores.get(doc_id, 0.0) + idf * tf * (self._k1 + 1) / denom
        return sorted(scores.items(), key=lambda x: x[1], reverse=True)[:top_k]

    def to_disk(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        data: dict[str, Any] = {
            "k1": self._k1,
            "b": self._b,
            "docs": self._docs,
        }
        path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    @classmethod
    def from_disk(cls, path: Path) -> "BM25Index":
        data = json.loads(path.read_text(encoding="utf-8"))
        idx = cls(k1=float(data.get("k1", 1.5)), b=float(data.get("b", 0.75)))
        for doc_id, tokens in data.get("docs", {}).items():
            idx._docs[doc_id] = tokens
        idx._recompute_stats()
        return idx
