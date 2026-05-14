# Copyright GraphCaster. All Rights Reserved.

"""Tests for graph_caster.rag.record_manager (F62 — RecordManager + upsert_document)."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any

import anyio
import anyio.from_thread
import pytest

from graph_caster.rag.record_manager import (
    DocumentRecord,
    FileRecordManager,
    InMemoryRecordManager,
    UpsertResult,
    _content_hash,
    upsert_document,
    upsert_documents,
)


# ---------------------------------------------------------------------------
# Test doubles
# ---------------------------------------------------------------------------


class _MockSplitter:
    """Split on double-newline; minimum 1 chunk."""

    def split_text(self, text: str) -> list[str]:
        parts = [p.strip() for p in text.split("\n\n") if p.strip()]
        return parts if parts else ([text] if text.strip() else [])


def _mock_embedder(text: str) -> list[float]:
    """Deterministic hash-based embedding (8-dim float)."""
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    return [(b / 255.0) for b in digest[:8]]


class _MockVectorStore:
    """In-memory dict that satisfies the _VectorStoreLike protocol."""

    def __init__(self) -> None:
        self._data: dict[str, tuple[list[float], dict[str, Any]]] = {}
        self.add_calls: list[list[str]] = []
        self.delete_calls: list[list[str]] = []

    def add(
        self,
        ids: list[str],
        vectors: list[list[float]],
        metadatas: list[dict[str, Any]],
    ) -> None:
        self.add_calls.append(list(ids))
        for cid, vec, meta in zip(ids, vectors, metadatas, strict=True):
            self._data[cid] = (vec, meta)

    def delete(self, ids: list[str]) -> None:
        self.delete_calls.append(list(ids))
        for cid in ids:
            self._data.pop(cid, None)

    @property
    def chunk_ids(self) -> set[str]:
        return set(self._data)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def tmp_root(tmp_path: Path) -> Path:
    return tmp_path / "records"


@pytest.fixture()
def file_manager(tmp_root: Path) -> FileRecordManager:
    return FileRecordManager(tmp_root)


@pytest.fixture()
def mem_manager() -> InMemoryRecordManager:
    return InMemoryRecordManager()


@pytest.fixture()
def splitter() -> _MockSplitter:
    return _MockSplitter()


@pytest.fixture()
def vector_store() -> _MockVectorStore:
    return _MockVectorStore()


# ---------------------------------------------------------------------------
# content_hash normalisation
# ---------------------------------------------------------------------------


def test_content_hash_strips_trailing_whitespace() -> None:
    h1 = _content_hash("hello  \nworld  ")
    h2 = _content_hash("hello\nworld")
    assert h1 == h2, "trailing whitespace should be stripped before hashing"


def test_content_hash_normalises_crlf() -> None:
    h1 = _content_hash("line1\r\nline2")
    h2 = _content_hash("line1\nline2")
    assert h1 == h2


def test_content_hash_different_contents_differ() -> None:
    assert _content_hash("foo") != _content_hash("bar")


# ---------------------------------------------------------------------------
# FileRecordManager — put / get / delete / list_all / find_by_source
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_file_put_get(file_manager: FileRecordManager) -> None:
    rec = DocumentRecord(
        doc_id="doc1",
        source="file.txt",
        content_hash="abc",
        chunk_ids=["doc1:0", "doc1:1"],
        indexed_at="2026-01-01T00:00:00+00:00",
        metadata={"author": "Alice"},
    )
    await file_manager.put(rec)
    got = await file_manager.get("doc1")
    assert got is not None
    assert got.doc_id == "doc1"
    assert got.source == "file.txt"
    assert got.content_hash == "abc"
    assert got.chunk_ids == ["doc1:0", "doc1:1"]
    assert got.metadata == {"author": "Alice"}


@pytest.mark.anyio
async def test_file_get_missing_returns_none(file_manager: FileRecordManager) -> None:
    result = await file_manager.get("nonexistent")
    assert result is None


@pytest.mark.anyio
async def test_file_delete(file_manager: FileRecordManager) -> None:
    rec = DocumentRecord(
        doc_id="doc2",
        source="file2.txt",
        content_hash="xyz",
        chunk_ids=[],
        indexed_at="2026-01-01T00:00:00+00:00",
    )
    await file_manager.put(rec)
    await file_manager.delete("doc2")
    assert await file_manager.get("doc2") is None


@pytest.mark.anyio
async def test_file_delete_nonexistent_is_noop(file_manager: FileRecordManager) -> None:
    await file_manager.delete("ghost")  # must not raise


@pytest.mark.anyio
async def test_file_list_all(file_manager: FileRecordManager) -> None:
    for i in range(3):
        await file_manager.put(
            DocumentRecord(
                doc_id=f"doc{i}",
                source=f"file{i}.txt",
                content_hash=str(i),
                chunk_ids=[],
                indexed_at="2026-01-01T00:00:00+00:00",
            )
        )
    records = await file_manager.list_all()
    assert {r.doc_id for r in records} == {"doc0", "doc1", "doc2"}


@pytest.mark.anyio
async def test_file_list_all_empty(file_manager: FileRecordManager) -> None:
    assert await file_manager.list_all() == []


@pytest.mark.anyio
async def test_file_find_by_source(file_manager: FileRecordManager) -> None:
    await file_manager.put(
        DocumentRecord(
            doc_id="d1",
            source="reports/q1.pdf",
            content_hash="h1",
            chunk_ids=[],
            indexed_at="2026-01-01T00:00:00+00:00",
        )
    )
    found = await file_manager.find_by_source("reports/q1.pdf")
    assert found is not None
    assert found.doc_id == "d1"
    missing = await file_manager.find_by_source("other.pdf")
    assert missing is None


@pytest.mark.anyio
async def test_file_put_overwrites(file_manager: FileRecordManager) -> None:
    rec = DocumentRecord(
        doc_id="dup",
        source="a.txt",
        content_hash="old",
        chunk_ids=["dup:0"],
        indexed_at="2026-01-01T00:00:00+00:00",
    )
    await file_manager.put(rec)
    rec2 = DocumentRecord(
        doc_id="dup",
        source="a.txt",
        content_hash="new",
        chunk_ids=["dup:0", "dup:1"],
        indexed_at="2026-01-01T01:00:00+00:00",
    )
    await file_manager.put(rec2)
    got = await file_manager.get("dup")
    assert got is not None
    assert got.content_hash == "new"
    assert len(got.chunk_ids) == 2
    # list_all must still return exactly one record for this doc_id
    all_recs = await file_manager.list_all()
    assert len([r for r in all_recs if r.doc_id == "dup"]) == 1


# ---------------------------------------------------------------------------
# InMemoryRecordManager — same CRUD contract
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_mem_put_get(mem_manager: InMemoryRecordManager) -> None:
    rec = DocumentRecord(
        doc_id="m1",
        source="url://x",
        content_hash="hh",
        chunk_ids=["m1:0"],
        indexed_at="2026-01-01T00:00:00+00:00",
    )
    await mem_manager.put(rec)
    got = await mem_manager.get("m1")
    assert got is not None and got.doc_id == "m1"


@pytest.mark.anyio
async def test_mem_delete(mem_manager: InMemoryRecordManager) -> None:
    rec = DocumentRecord(
        doc_id="m2",
        source="s",
        content_hash="h",
        chunk_ids=[],
        indexed_at="2026-01-01T00:00:00+00:00",
    )
    await mem_manager.put(rec)
    await mem_manager.delete("m2")
    assert await mem_manager.get("m2") is None


@pytest.mark.anyio
async def test_mem_list_all(mem_manager: InMemoryRecordManager) -> None:
    for i in range(5):
        await mem_manager.put(
            DocumentRecord(
                doc_id=f"m{i}",
                source=f"s{i}",
                content_hash=str(i),
                chunk_ids=[],
                indexed_at="2026-01-01T00:00:00+00:00",
            )
        )
    records = await mem_manager.list_all()
    assert len(records) == 5


@pytest.mark.anyio
async def test_mem_find_by_source(mem_manager: InMemoryRecordManager) -> None:
    await mem_manager.put(
        DocumentRecord(
            doc_id="m3",
            source="unique-source",
            content_hash="hx",
            chunk_ids=[],
            indexed_at="2026-01-01T00:00:00+00:00",
        )
    )
    found = await mem_manager.find_by_source("unique-source")
    assert found is not None and found.doc_id == "m3"


# ---------------------------------------------------------------------------
# Concurrent puts — all records survive
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_file_concurrent_puts(file_manager: FileRecordManager) -> None:
    """10 concurrent coroutines each writing a distinct record — all must survive."""

    async def write_one(i: int) -> None:
        await file_manager.put(
            DocumentRecord(
                doc_id=f"concurrent_{i}",
                source=f"s{i}",
                content_hash=str(i),
                chunk_ids=[f"concurrent_{i}:0"],
                indexed_at="2026-05-12T00:00:00+00:00",
            )
        )

    async with anyio.create_task_group() as tg:
        for i in range(10):
            tg.start_soon(write_one, i)

    records = await file_manager.list_all()
    assert len(records) == 10
    ids = {r.doc_id for r in records}
    for i in range(10):
        assert f"concurrent_{i}" in ids


# ---------------------------------------------------------------------------
# upsert_document — INSERTED / UNCHANGED / UPDATED
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_upsert_inserted(
    mem_manager: InMemoryRecordManager,
    splitter: _MockSplitter,
    vector_store: _MockVectorStore,
) -> None:
    content = "Hello world\n\nThis is a test document."
    result, chunk_ids = await upsert_document(
        mem_manager,
        doc_id="doc-a",
        source="a.txt",
        content=content,
        splitter=splitter,
        embedder=_mock_embedder,
        vector_store=vector_store,
        metadata={"tag": "test"},
    )
    assert result == UpsertResult.INSERTED
    assert len(chunk_ids) > 0
    assert len(vector_store.add_calls) == 1
    assert set(chunk_ids).issubset(vector_store.chunk_ids)
    rec = await mem_manager.get("doc-a")
    assert rec is not None
    assert rec.chunk_ids == chunk_ids


@pytest.mark.anyio
async def test_upsert_unchanged_same_content(
    mem_manager: InMemoryRecordManager,
    splitter: _MockSplitter,
    vector_store: _MockVectorStore,
) -> None:
    content = "Static content that does not change."

    await upsert_document(
        mem_manager,
        doc_id="doc-b",
        source="b.txt",
        content=content,
        splitter=splitter,
        embedder=_mock_embedder,
        vector_store=vector_store,
    )
    add_count_after_first = len(vector_store.add_calls)

    result, chunk_ids = await upsert_document(
        mem_manager,
        doc_id="doc-b",
        source="b.txt",
        content=content,
        splitter=splitter,
        embedder=_mock_embedder,
        vector_store=vector_store,
    )

    assert result == UpsertResult.UNCHANGED
    assert len(vector_store.add_calls) == add_count_after_first, "vector_store must not be touched on UNCHANGED"
    assert len(vector_store.delete_calls) == 0


@pytest.mark.anyio
async def test_upsert_updated_modified_content(
    mem_manager: InMemoryRecordManager,
    splitter: _MockSplitter,
    vector_store: _MockVectorStore,
) -> None:
    # v1: one paragraph → one chunk (doc-c:0)
    # v2: two paragraphs → two chunks (doc-c:0, doc-c:1)
    # After update, doc-c:0 is re-added (new content) AND doc-c:1 appears.
    content_v1 = "Original content."
    content_v2 = "First paragraph.\n\nSecond paragraph — different content entirely."

    result1, old_chunk_ids = await upsert_document(
        mem_manager,
        doc_id="doc-c",
        source="c.txt",
        content=content_v1,
        splitter=splitter,
        embedder=_mock_embedder,
        vector_store=vector_store,
    )
    assert result1 == UpsertResult.INSERTED
    assert old_chunk_ids == ["doc-c:0"]

    result2, new_chunk_ids = await upsert_document(
        mem_manager,
        doc_id="doc-c",
        source="c.txt",
        content=content_v2,
        splitter=splitter,
        embedder=_mock_embedder,
        vector_store=vector_store,
    )
    assert result2 == UpsertResult.UPDATED
    # old chunks must have been deleted before new ones added
    assert len(vector_store.delete_calls) == 1
    assert vector_store.delete_calls[0] == old_chunk_ids
    # v2 produces two chunks
    assert new_chunk_ids == ["doc-c:0", "doc-c:1"]
    # new chunks must be indexed
    assert set(new_chunk_ids).issubset(vector_store.chunk_ids)
    # exactly two chunks in the store (the old one was deleted and re-added with new embedding)
    assert len(vector_store.add_calls) == 2  # one for v1, one for v2

    rec = await mem_manager.get("doc-c")
    assert rec is not None
    assert rec.chunk_ids == new_chunk_ids


@pytest.mark.anyio
async def test_upsert_unchanged_normalised_whitespace(
    mem_manager: InMemoryRecordManager,
    splitter: _MockSplitter,
    vector_store: _MockVectorStore,
) -> None:
    content_v1 = "Hello world  \r\n\r\nTrailing spaces.  "
    content_v2 = "Hello world\n\nTrailing spaces."

    await upsert_document(
        mem_manager,
        doc_id="doc-d",
        source="d.txt",
        content=content_v1,
        splitter=splitter,
        embedder=_mock_embedder,
        vector_store=vector_store,
    )
    result, _ = await upsert_document(
        mem_manager,
        doc_id="doc-d",
        source="d.txt",
        content=content_v2,
        splitter=splitter,
        embedder=_mock_embedder,
        vector_store=vector_store,
    )
    assert result == UpsertResult.UNCHANGED, "Normalised content should hash identically"


# ---------------------------------------------------------------------------
# upsert_documents (batch)
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_upsert_documents_batch(
    mem_manager: InMemoryRecordManager,
    splitter: _MockSplitter,
    vector_store: _MockVectorStore,
) -> None:
    docs = [
        ("id1", "source1", "Content one.", None),
        ("id2", "source2", "Content two.", {"key": "val"}),
        ("id3", "source3", "Content three.", None),
    ]
    results = await upsert_documents(
        mem_manager,
        docs,
        splitter=splitter,
        embedder=_mock_embedder,
        vector_store=vector_store,
    )
    assert set(results.keys()) == {"id1", "id2", "id3"}
    assert all(v == UpsertResult.INSERTED for v in results.values())

    # Second call with same content → all UNCHANGED
    results2 = await upsert_documents(
        mem_manager,
        docs,
        splitter=splitter,
        embedder=_mock_embedder,
        vector_store=vector_store,
    )
    assert all(v == UpsertResult.UNCHANGED for v in results2.values())


# ---------------------------------------------------------------------------
# DocumentRecord round-trip
# ---------------------------------------------------------------------------


def test_document_record_roundtrip() -> None:
    rec = DocumentRecord(
        doc_id="r1",
        source="path/to/file.md",
        content_hash="sha256abc",
        chunk_ids=["r1:0", "r1:1", "r1:2"],
        indexed_at="2026-05-12T10:00:00+00:00",
        metadata={"project": "GraphCaster", "version": 1},
    )
    d = rec.to_dict()
    rec2 = DocumentRecord.from_dict(d)
    assert rec2.doc_id == rec.doc_id
    assert rec2.source == rec.source
    assert rec2.content_hash == rec.content_hash
    assert rec2.chunk_ids == rec.chunk_ids
    assert rec2.indexed_at == rec.indexed_at
    assert rec2.metadata == rec.metadata


# ---------------------------------------------------------------------------
# File persistence — index.json survives across manager instances
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_file_persistence_across_instances(tmp_root: Path) -> None:
    mgr1 = FileRecordManager(tmp_root)
    await mgr1.put(
        DocumentRecord(
            doc_id="persist1",
            source="p.txt",
            content_hash="hpersist",
            chunk_ids=["persist1:0"],
            indexed_at="2026-05-12T00:00:00+00:00",
        )
    )

    mgr2 = FileRecordManager(tmp_root)
    got = await mgr2.get("persist1")
    assert got is not None
    assert got.content_hash == "hpersist"
