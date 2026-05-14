# Copyright GraphCaster. All Rights Reserved.

"""Tests for rerankers module (F60)."""

from __future__ import annotations

import asyncio
import json

import pytest

from graph_caster.rag.retrieval import RetrievalResult
from graph_caster.rag.rerankers import BGEReranker, CohereReranker, get_reranker


def _make_results() -> list[RetrievalResult]:
    return [
        RetrievalResult(chunk_id="c1", doc_id="d1", text="Python is a programming language", score=0.8),
        RetrievalResult(chunk_id="c2", doc_id="d2", text="Machine learning uses data", score=0.6),
        RetrievalResult(chunk_id="c3", doc_id="d3", text="The quick brown fox", score=0.4),
    ]


# ---------------------------------------------------------------------------
# CohereReranker with mocked httpx transport
# ---------------------------------------------------------------------------


def _make_cohere_response_body(candidates: list[RetrievalResult], order: list[int]) -> dict:
    return {
        "results": [
            {"index": idx, "relevance_score": 1.0 - i * 0.1}
            for i, idx in enumerate(order)
        ]
    }


def test_cohere_reranker_calls_api_and_reorders() -> None:
    httpx = pytest.importorskip("httpx")

    candidates = _make_results()
    # Simulate Cohere returning order [2, 0, 1] (fox first, python second, ml third)
    body = _make_cohere_response_body(candidates, [2, 0, 1])
    response_content = json.dumps(body).encode()

    reranker = CohereReranker(api_key="test-key")

    # Patch AsyncClient.post on the class so the context manager works normally
    async def _fake_post(self, url, **kwargs):
        return httpx.Response(
            200,
            content=response_content,
            request=httpx.Request("POST", url),
        )

    old_post = httpx.AsyncClient.post
    try:
        httpx.AsyncClient.post = _fake_post  # type: ignore[method-assign]
        results = asyncio.run(reranker.rerank("test query", candidates))
    finally:
        httpx.AsyncClient.post = old_post  # type: ignore[method-assign]

    assert len(results) == 3
    assert results[0].chunk_id == "c3", f"Expected c3 first (index 2), got {results[0].chunk_id}"
    assert results[1].chunk_id == "c1", f"Expected c1 second (index 0), got {results[1].chunk_id}"
    assert results[2].chunk_id == "c2", f"Expected c2 third (index 1), got {results[2].chunk_id}"
    for r in results:
        assert r.rerank_score is not None


def test_cohere_reranker_empty_candidates() -> None:
    reranker = CohereReranker(api_key="test-key")
    results = asyncio.run(reranker.rerank("query", []))
    assert results == []


# ---------------------------------------------------------------------------
# BGEReranker
# ---------------------------------------------------------------------------


def test_bge_reranker_fallback_returns_candidates_unchanged() -> None:
    """When sentence_transformers is absent, BGEReranker returns candidates as-is."""
    reranker = BGEReranker()
    reranker._loaded = True
    reranker._encoder = None

    candidates = _make_results()
    results = asyncio.run(reranker.rerank("python language", candidates))
    assert len(results) == len(candidates)
    assert [r.chunk_id for r in results] == [r.chunk_id for r in candidates]


def test_bge_reranker_empty_candidates() -> None:
    reranker = BGEReranker()
    results = asyncio.run(reranker.rerank("query", []))
    assert results == []


# ---------------------------------------------------------------------------
# get_reranker factory
# ---------------------------------------------------------------------------


def test_get_reranker_cohere() -> None:
    r = get_reranker("cohere")
    assert isinstance(r, CohereReranker)


def test_get_reranker_bge() -> None:
    r = get_reranker("bge")
    assert isinstance(r, BGEReranker)


def test_get_reranker_unknown_raises() -> None:
    with pytest.raises(ValueError, match="Unknown reranker"):
        get_reranker("unknown-model")


def test_get_reranker_case_insensitive() -> None:
    r = get_reranker("Cohere")
    assert isinstance(r, CohereReranker)
