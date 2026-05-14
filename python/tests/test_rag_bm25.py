# Copyright GraphCaster. All Rights Reserved.

"""Tests for BM25Index (F60)."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from graph_caster.rag.bm25 import BM25Index


DOCS = [
    ("doc1", "the quick brown fox jumps over the lazy dog"),
    ("doc2", "python programming language is great for data science"),
    ("doc3", "machine learning and deep learning are subfields of artificial intelligence"),
    ("doc4", "the fox ran quickly through the forest"),
    ("doc5", "natural language processing enables computers to understand human text"),
]


def _make_index() -> BM25Index:
    idx = BM25Index()
    for doc_id, text in DOCS:
        idx.add(doc_id, text)
    return idx


def test_search_returns_relevant_doc() -> None:
    idx = _make_index()
    results = idx.search("fox", top_k=3)
    ids = [r[0] for r in results]
    assert "doc1" in ids or "doc4" in ids


def test_search_ranking_order() -> None:
    idx = _make_index()
    results = idx.search("python programming", top_k=5)
    assert results, "Expected at least one result"
    ids = [r[0] for r in results]
    assert ids[0] == "doc2", f"Expected doc2 first, got {ids}"


def test_search_scores_are_positive() -> None:
    idx = _make_index()
    results = idx.search("machine learning", top_k=5)
    for doc_id, score in results:
        assert score >= 0.0, f"Score for {doc_id} is negative: {score}"


def test_search_top_k_respected() -> None:
    idx = _make_index()
    results = idx.search("the", top_k=2)
    assert len(results) <= 2


def test_search_empty_index() -> None:
    idx = BM25Index()
    results = idx.search("anything", top_k=5)
    assert results == []


def test_search_no_match_returns_empty() -> None:
    idx = _make_index()
    results = idx.search("zzzznonexistenttoken", top_k=5)
    assert results == []


def test_add_then_remove() -> None:
    idx = _make_index()
    results_before = idx.search("fox", top_k=5)
    ids_before = {r[0] for r in results_before}
    assert "doc1" in ids_before

    idx.remove("doc1")
    results_after = idx.search("fox", top_k=5)
    ids_after = {r[0] for r in results_after}
    assert "doc1" not in ids_after


def test_remove_nonexistent_is_noop() -> None:
    idx = _make_index()
    idx.remove("does-not-exist")
    results = idx.search("fox", top_k=5)
    assert len(results) > 0


def test_persistence_round_trip() -> None:
    idx = _make_index()
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "bm25.json"
        idx.to_disk(path)

        assert path.exists()
        raw = json.loads(path.read_text(encoding="utf-8"))
        assert "docs" in raw
        assert "k1" in raw
        assert "b" in raw

        idx2 = BM25Index.from_disk(path)
        results = idx2.search("fox", top_k=3)
        ids = [r[0] for r in results]
        assert "doc1" in ids or "doc4" in ids


def test_persistence_preserves_scores() -> None:
    idx = _make_index()
    with tempfile.TemporaryDirectory() as tmpdir:
        path = Path(tmpdir) / "bm25.json"
        idx.to_disk(path)
        idx2 = BM25Index.from_disk(path)

        r1 = idx.search("deep learning", top_k=5)
        r2 = idx2.search("deep learning", top_k=5)
        assert [r[0] for r in r1] == [r[0] for r in r2]
        for (id1, s1), (id2, s2) in zip(r1, r2):
            assert abs(s1 - s2) < 1e-9, f"Score mismatch for {id1}: {s1} vs {s2}"


def test_custom_k1_b_params() -> None:
    idx = BM25Index(k1=2.0, b=0.9)
    idx.add("d1", "machine learning artificial intelligence")
    idx.add("d2", "python data science programming")
    results = idx.search("machine", top_k=2)
    assert results[0][0] == "d1"
