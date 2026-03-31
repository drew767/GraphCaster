# Copyright Aura. All Rights Reserved.

from __future__ import annotations

from pathlib import Path

import pytest

from graph_caster.rag.embedding import hash_embedding
from graph_caster.rag.memory_registry import (
    _reset_memory_registry_for_tests,
    get_memory_store,
)
from graph_caster.rag.retriever import retrieve_from_memory
from graph_caster.rag.vector_store import InMemoryVectorStore


@pytest.fixture(autouse=True)
def _clean_registry():
    _reset_memory_registry_for_tests()
    yield
    _reset_memory_registry_for_tests()


def test_default_backend_is_in_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_RAG_VECTOR_BACKEND", raising=False)
    monkeypatch.delenv("GC_RAG_CHROMA_PATH", raising=False)
    st = get_memory_store("g-default", "coll-a")
    assert isinstance(st, InMemoryVectorStore)


def test_unknown_backend_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RAG_VECTOR_BACKEND", "nope")
    with pytest.raises(ValueError, match="Unknown GC_RAG_VECTOR_BACKEND"):
        get_memory_store("g1", "c1")


def test_chroma_backend_requires_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RAG_VECTOR_BACKEND", "chroma")
    monkeypatch.delenv("GC_RAG_CHROMA_PATH", raising=False)
    with pytest.raises(ValueError, match="GC_RAG_CHROMA_PATH"):
        get_memory_store("g-chroma", "c1")


def test_faiss_vector_store_roundtrip() -> None:
    faiss = pytest.importorskip("faiss")
    np = pytest.importorskip("numpy")
    del faiss, np  # loaded by store

    from graph_caster.rag.faiss_vector_store import FaissVectorStore

    st = FaissVectorStore()
    emb_a = hash_embedding("hello rag faiss", dims=32)
    emb_b = hash_embedding("other text", dims=32)
    st.upsert(["id1"], [emb_a], ["doc a"], [{"k": 1}])
    st.upsert(["id2"], [emb_b], ["doc b"], None)
    hits = st.query(emb_a, top_k=2)
    assert len(hits) == 2
    assert hits[0].id == "id1"
    assert hits[0].score >= hits[1].score
    assert hits[0].content == "doc a"


def test_faiss_backend_via_registry(monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("faiss")
    pytest.importorskip("numpy")
    monkeypatch.setenv("GC_RAG_VECTOR_BACKEND", "faiss")
    st = get_memory_store("g-faiss", "col-f")
    emb = hash_embedding("registry faiss", dims=48)
    st.upsert(["x"], [emb], ["body"], None)
    hits = st.query(emb, top_k=1)
    assert len(hits) == 1
    assert hits[0].id == "x"
    assert abs(hits[0].score - 1.0) < 1e-3


def test_chroma_vector_store_roundtrip(tmp_path: Path) -> None:
    chromadb = pytest.importorskip("chromadb")

    from graph_caster.rag.chroma_vector_store import ChromaVectorStore

    del chromadb

    persist = str(tmp_path / "chroma")
    st = ChromaVectorStore(persist_path=persist, graph_id="g1", collection_id="books")
    emb = hash_embedding("chromadb smoke", dims=32)
    st.upsert(["c1"], [emb], ["chunk one"], [{"chunkIndex": 0}])
    hits = st.query(emb, top_k=1)
    assert len(hits) == 1
    assert hits[0].id == "c1"
    st.upsert(["c2"], [emb], ["chunk two"], [{"chunkIndex": 1, "lane": "b"}])
    lane_a = st.query(emb, top_k=2, metadata_filter={"lane": "b"})
    assert len(lane_a) == 1
    assert lane_a[0].id == "c2"
    assert hits[0].content == "chunk one"
    assert hits[0].metadata.get("chunkIndex") in (0, "0")
    st.clear()
    assert st.query(emb, top_k=1) == []


def test_inmemory_metadata_filter_and_retriever() -> None:
    st = get_memory_store("g-meta", "col-meta")
    st.clear()
    e0 = hash_embedding("hello world zero", dims=32)
    e1 = hash_embedding("hello world one", dims=32)
    st.upsert(
        ["a", "b"],
        [e0, e1],
        ["doc0", "doc1"],
        [{"chunkIndex": 0, "tag": "x"}, {"chunkIndex": 1, "tag": "y"}],
    )
    hits_all = st.query(e0, top_k=2)
    assert len(hits_all) == 2
    hits_f = st.query(e0, top_k=2, metadata_filter={"tag": "y"})
    assert len(hits_f) == 1
    assert hits_f[0].id == "b"
    out = retrieve_from_memory(
        "g-meta",
        "col-meta",
        "hello world zero",
        top_k=2,
        embedding_dims=32,
        metadata_filter={"tag": "y"},
    )
    assert len(out) == 1
    assert out[0]["id"] == "b"


def test_faiss_metadata_filter_needs_oversample() -> None:
    pytest.importorskip("faiss")
    pytest.importorskip("numpy")
    from graph_caster.rag.faiss_vector_store import FaissVectorStore

    st = FaissVectorStore()
    emb_best_match = hash_embedding("alpha beta gamma query", dims=32)
    emb_ok = hash_embedding("alpha beta delta", dims=32)
    st.upsert(
        ["noisy", "wanted"],
        [emb_best_match, emb_ok],
        ["noise doc", "target doc"],
        [{"role": "bad"}, {"role": "ok"}],
    )
    q = hash_embedding("alpha beta gamma query", dims=32)
    narrow = st.query(q, top_k=1, metadata_filter={"role": "ok"}, oversample=1)
    assert narrow == []
    wide = st.query(q, top_k=1, metadata_filter={"role": "ok"}, oversample=3)
    assert len(wide) == 1
    assert wide[0].id == "wanted"
    assert wide[0].content == "target doc"


def test_chroma_backend_via_registry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("chromadb")
    persist = str(tmp_path / "chroma-reg")
    monkeypatch.setenv("GC_RAG_VECTOR_BACKEND", "chroma")
    monkeypatch.setenv("GC_RAG_CHROMA_PATH", persist)
    st = get_memory_store("g-chroma-reg", "mem")
    emb = hash_embedding("via registry", dims=40)
    st.upsert(["z"], [emb], ["z doc"], None)
    hits = st.query(emb, top_k=2)
    assert len(hits) >= 1
    assert hits[0].id == "z"
    assert hits[0].score > 0.01
