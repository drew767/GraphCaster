# Copyright GraphCaster. All Rights Reserved.

"""Tests for hybrid retrieval modes (F60)."""

from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path

import pytest

from graph_caster.rag.dataset import Dataset
from graph_caster.rag.retrieval import (
    RetrievalConfig,
    RetrievalMode,
    RetrievalResult,
    merge_hybrid,
    reciprocal_rank_fusion,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

DOCS = [
    ("science.txt", "machine learning and artificial intelligence transform science", {}),
    ("python.txt", "python is a popular programming language for data science", {}),
    ("fox.txt", "the quick brown fox jumps over the lazy dog", {"category": "animals"}),
    ("nlp.txt", "natural language processing enables understanding of human text", {}),
    ("deep.txt", "deep learning neural networks achieve state of the art results", {}),
]


def _make_dataset(tmpdir: str) -> Dataset:
    ds = Dataset.create(Path(tmpdir), "Test Dataset")
    asyncio.run(_populate(ds))
    return ds


async def _populate(ds: Dataset) -> None:
    for source, content, meta in DOCS:
        await ds.add_document(source, content, meta)


# ---------------------------------------------------------------------------
# Unit tests: merge_hybrid / RRF utilities
# ---------------------------------------------------------------------------


def test_merge_hybrid_alpha_1_pure_vector() -> None:
    vec = [("a", 0.9), ("b", 0.6), ("c", 0.3)]
    kw = [("b", 1.0), ("a", 0.5), ("c", 0.2)]
    merged = merge_hybrid(vec, kw, alpha=1.0)
    ids = [m[0] for m in merged]
    assert ids[0] == "a", f"Expected 'a' first with alpha=1.0, got {ids}"


def test_merge_hybrid_alpha_0_pure_keyword() -> None:
    vec = [("a", 0.9), ("b", 0.1)]
    kw = [("b", 1.0), ("a", 0.1)]
    merged = merge_hybrid(vec, kw, alpha=0.0)
    ids = [m[0] for m in merged]
    assert ids[0] == "b", f"Expected 'b' first with alpha=0.0, got {ids}"


def test_merge_hybrid_balanced() -> None:
    vec = [("a", 1.0), ("b", 0.0)]
    kw = [("b", 1.0), ("a", 0.0)]
    merged = merge_hybrid(vec, kw, alpha=0.5)
    ids = [m[0] for m in merged]
    scores = {m[0]: m[1] for m in merged}
    assert abs(scores["a"] - scores["b"]) < 1e-9, "Equal alpha=0.5 should produce equal scores"


def test_rrf_combines_across_lists() -> None:
    lists = [
        ["a", "b", "c"],
        ["b", "a", "c"],
        ["c", "b", "a"],
    ]
    result = reciprocal_rank_fusion(lists)
    ids = [r[0] for r in result]
    assert ids[0] == "b", f"Expected 'b' as top RRF result, got {ids}"


def test_rrf_single_list() -> None:
    result = reciprocal_rank_fusion([["x", "y", "z"]])
    assert result[0][0] == "x"


def test_rrf_empty() -> None:
    result = reciprocal_rank_fusion([])
    assert result == []


# ---------------------------------------------------------------------------
# Integration tests via Dataset.query(config=...)
# ---------------------------------------------------------------------------


def test_vector_mode_returns_results() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        ds = _make_dataset(tmpdir)
        cfg = RetrievalConfig(mode=RetrievalMode.VECTOR, top_k=3)
        results = asyncio.run(ds.query("machine learning", config=cfg))
        assert isinstance(results, list)
        assert len(results) <= 3
        assert all(isinstance(r, RetrievalResult) for r in results)


def test_keyword_mode_returns_results() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        ds = _make_dataset(tmpdir)
        cfg = RetrievalConfig(mode=RetrievalMode.KEYWORD, top_k=3)
        results = asyncio.run(ds.query("python programming", config=cfg))
        assert isinstance(results, list)
        assert len(results) >= 1
        texts = " ".join(r.text for r in results)
        assert "python" in texts.lower()


def test_keyword_mode_scores_set() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        ds = _make_dataset(tmpdir)
        cfg = RetrievalConfig(mode=RetrievalMode.KEYWORD, top_k=3)
        results = asyncio.run(ds.query("deep learning", config=cfg))
        for r in results:
            assert r.keyword_score is not None


def test_hybrid_mode_returns_results() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        ds = _make_dataset(tmpdir)
        cfg = RetrievalConfig(mode=RetrievalMode.HYBRID, top_k=3, hybrid_alpha=0.5)
        results = asyncio.run(ds.query("machine learning", config=cfg))
        assert len(results) >= 1
        assert all(isinstance(r, RetrievalResult) for r in results)


def test_hybrid_alpha_1_matches_vector_ranking() -> None:
    """alpha=1.0 means pure-vector weight; the top result must come from the vector set."""
    with tempfile.TemporaryDirectory() as tmpdir:
        ds = _make_dataset(tmpdir)
        cfg_v = RetrievalConfig(mode=RetrievalMode.VECTOR, top_k=5)
        cfg_h = RetrievalConfig(mode=RetrievalMode.HYBRID, top_k=5, hybrid_alpha=1.0)
        vec = asyncio.run(ds.query("deep learning", config=cfg_v))
        hyb = asyncio.run(ds.query("deep learning", config=cfg_h))
        vec_ids = {r.chunk_id for r in vec}
        hyb_ids = {r.chunk_id for r in hyb}
        # Both should pull from the same top vector results (set overlap)
        assert hyb_ids.issubset(vec_ids) or len(hyb_ids & vec_ids) >= len(hyb_ids) // 2, (
            f"alpha=1.0 hybrid should heavily overlap with vector: {vec_ids} vs {hyb_ids}"
        )
        # Top result of hybrid must be top result of vector (both have same best hit)
        if vec and hyb:
            assert hyb[0].chunk_id == vec[0].chunk_id, (
                f"alpha=1.0 top hybrid result {hyb[0].chunk_id!r} != vector top {vec[0].chunk_id!r}"
            )


def test_hybrid_alpha_0_matches_keyword_ranking() -> None:
    """alpha=0.0 means pure-keyword weight; the top result must be the top keyword hit."""
    with tempfile.TemporaryDirectory() as tmpdir:
        ds = _make_dataset(tmpdir)
        cfg_k = RetrievalConfig(mode=RetrievalMode.KEYWORD, top_k=5)
        cfg_h = RetrievalConfig(mode=RetrievalMode.HYBRID, top_k=5, hybrid_alpha=0.0)
        kw = asyncio.run(ds.query("python language", config=cfg_k))
        hyb = asyncio.run(ds.query("python language", config=cfg_h))
        if kw and hyb:
            assert hyb[0].chunk_id == kw[0].chunk_id, (
                f"alpha=0.0 top hybrid result {hyb[0].chunk_id!r} != keyword top {kw[0].chunk_id!r}"
            )


def test_multiway_mode_returns_results() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        ds = _make_dataset(tmpdir)
        cfg = RetrievalConfig(mode=RetrievalMode.MULTIWAY, top_k=3)
        results = asyncio.run(ds.query("natural language", config=cfg))
        assert len(results) >= 1


def test_multiway_top_result_high_rrf_score() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        ds = _make_dataset(tmpdir)
        cfg = RetrievalConfig(mode=RetrievalMode.MULTIWAY, top_k=5)
        results = asyncio.run(ds.query("python language", config=cfg))
        if len(results) >= 2:
            assert results[0].score >= results[1].score, "Results should be sorted by RRF score desc"


def test_score_threshold_filters_low_scores() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        ds = _make_dataset(tmpdir)
        cfg = RetrievalConfig(mode=RetrievalMode.VECTOR, top_k=5, score_threshold=0.99)
        results = asyncio.run(ds.query("zzz completely unrelated query xyz", config=cfg))
        for r in results:
            assert r.score >= 0.99


def test_metadata_filter_excludes_non_matching() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        ds = _make_dataset(tmpdir)
        cfg = RetrievalConfig(
            mode=RetrievalMode.KEYWORD,
            top_k=5,
            metadata_filter={"category": "animals"},
        )
        results = asyncio.run(ds.query("fox", config=cfg))
        for r in results:
            assert r.metadata.get("category") == "animals", f"Unexpected metadata: {r.metadata}"


def test_top_k_respected() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        ds = _make_dataset(tmpdir)
        cfg = RetrievalConfig(mode=RetrievalMode.KEYWORD, top_k=2)
        results = asyncio.run(ds.query("language", config=cfg))
        assert len(results) <= 2


def test_backward_compat_dict_return() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        ds = _make_dataset(tmpdir)
        results = asyncio.run(ds.query("machine learning", top_k=3))
        assert isinstance(results, list)
        if results:
            assert isinstance(results[0], dict)
            assert "chunk_id" in results[0]
            assert "score" in results[0]


def test_full_text_mode() -> None:
    with tempfile.TemporaryDirectory() as tmpdir:
        ds = _make_dataset(tmpdir)
        cfg = RetrievalConfig(mode=RetrievalMode.FULL_TEXT, top_k=5)
        results = asyncio.run(ds.query("fox", config=cfg))
        assert len(results) >= 1
        for r in results:
            assert "fox" in r.text.lower()
