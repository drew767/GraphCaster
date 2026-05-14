# Copyright GraphCaster. All Rights Reserved.

"""F62 — RecordManager: document deduplication on upsert.

JSONL-backed FileRecordManager + volatile InMemoryRecordManager, plus
upsert_document / upsert_documents helpers that wire splitter + embedder +
vector_store through the record layer.

Layout (FileRecordManager):
  <root>/records.jsonl   — append-only log; each line is a DocumentRecord JSON
  <root>/index.json      — {doc_id: record_dict, ...} fast-lookup map
"""

from __future__ import annotations

import hashlib
import json
import uuid
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

import anyio
import anyio.to_thread


# ---------------------------------------------------------------------------
# Domain model
# ---------------------------------------------------------------------------


@dataclass
class DocumentRecord:
    doc_id: str
    source: str
    content_hash: str
    chunk_ids: list[str]
    indexed_at: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "doc_id": self.doc_id,
            "source": self.source,
            "content_hash": self.content_hash,
            "chunk_ids": list(self.chunk_ids),
            "indexed_at": self.indexed_at,
            "metadata": dict(self.metadata),
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "DocumentRecord":
        return cls(
            doc_id=d["doc_id"],
            source=d["source"],
            content_hash=d["content_hash"],
            chunk_ids=list(d.get("chunk_ids", [])),
            indexed_at=d.get("indexed_at", ""),
            metadata=dict(d.get("metadata", {})),
        )


# ---------------------------------------------------------------------------
# UpsertResult
# ---------------------------------------------------------------------------


class UpsertResult(StrEnum):
    INSERTED = "inserted"
    UPDATED = "updated"
    UNCHANGED = "unchanged"


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------


class RecordManager(ABC):
    @abstractmethod
    async def get(self, doc_id: str) -> DocumentRecord | None:
        """Return the record for doc_id, or None if not found."""
        raise NotImplementedError

    @abstractmethod
    async def put(self, record: DocumentRecord) -> None:
        """Insert or overwrite the record for record.doc_id."""
        raise NotImplementedError

    @abstractmethod
    async def delete(self, doc_id: str) -> None:
        """Remove the record for doc_id (no-op if absent)."""
        raise NotImplementedError

    @abstractmethod
    async def list_all(self) -> list[DocumentRecord]:
        """Return all records."""
        raise NotImplementedError

    @abstractmethod
    async def find_by_source(self, source: str) -> DocumentRecord | None:
        """Return the first record matching source, or None."""
        raise NotImplementedError


# ---------------------------------------------------------------------------
# InMemoryRecordManager (volatile; for tests)
# ---------------------------------------------------------------------------


class InMemoryRecordManager(RecordManager):
    def __init__(self) -> None:
        self._store: dict[str, DocumentRecord] = {}
        self._lock = anyio.Lock()

    async def get(self, doc_id: str) -> DocumentRecord | None:
        async with self._lock:
            rec = self._store.get(doc_id)
            if rec is None:
                return None
            return DocumentRecord.from_dict(rec.to_dict())

    async def put(self, record: DocumentRecord) -> None:
        async with self._lock:
            self._store[record.doc_id] = DocumentRecord.from_dict(record.to_dict())

    async def delete(self, doc_id: str) -> None:
        async with self._lock:
            self._store.pop(doc_id, None)

    async def list_all(self) -> list[DocumentRecord]:
        async with self._lock:
            return [DocumentRecord.from_dict(r.to_dict()) for r in self._store.values()]

    async def find_by_source(self, source: str) -> DocumentRecord | None:
        async with self._lock:
            for r in self._store.values():
                if r.source == source:
                    return DocumentRecord.from_dict(r.to_dict())
            return None


# ---------------------------------------------------------------------------
# FileRecordManager
# ---------------------------------------------------------------------------

_INDEX_FILE = "index.json"
_RECORDS_FILE = "records.jsonl"


def _load_index(index_path: Path) -> dict[str, dict[str, Any]]:
    if not index_path.exists():
        return {}
    try:
        raw = index_path.read_text(encoding="utf-8")
        return json.loads(raw)
    except (json.JSONDecodeError, OSError):
        return {}


def _save_index(index_path: Path, index: dict[str, dict[str, Any]]) -> None:
    tmp = index_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    tmp.replace(index_path)


def _append_jsonl(records_path: Path, record: DocumentRecord) -> None:
    line = json.dumps(record.to_dict(), ensure_ascii=False) + "\n"
    with records_path.open("a", encoding="utf-8") as fh:
        fh.write(line)


class FileRecordManager(RecordManager):
    """JSONL-backed record manager.

    - ``<root>/records.jsonl`` — append-only log (audit trail).
    - ``<root>/index.json``    — authoritative map {doc_id: record_dict}.

    All mutations rewrite index.json atomically (tmp → replace).
    The anyio.Lock serialises concurrent coroutine access; file I/O runs in
    a thread via anyio.to_thread so it does not block the event loop.
    """

    def __init__(self, root: Path) -> None:
        self._root = root
        self._index_path = root / _INDEX_FILE
        self._records_path = root / _RECORDS_FILE
        self._lock = anyio.Lock()

    def _ensure_dir(self) -> None:
        self._root.mkdir(parents=True, exist_ok=True)

    async def get(self, doc_id: str) -> DocumentRecord | None:
        async with self._lock:
            index = await anyio.to_thread.run_sync(lambda: _load_index(self._index_path))
            raw = index.get(doc_id)
            if raw is None:
                return None
            return DocumentRecord.from_dict(raw)

    async def put(self, record: DocumentRecord) -> None:
        async with self._lock:
            await anyio.to_thread.run_sync(lambda: self._put_sync(record))

    def _put_sync(self, record: DocumentRecord) -> None:
        self._ensure_dir()
        index = _load_index(self._index_path)
        index[record.doc_id] = record.to_dict()
        _save_index(self._index_path, index)
        _append_jsonl(self._records_path, record)

    async def delete(self, doc_id: str) -> None:
        async with self._lock:
            await anyio.to_thread.run_sync(lambda: self._delete_sync(doc_id))

    def _delete_sync(self, doc_id: str) -> None:
        self._ensure_dir()
        index = _load_index(self._index_path)
        if doc_id in index:
            del index[doc_id]
            _save_index(self._index_path, index)

    async def list_all(self) -> list[DocumentRecord]:
        async with self._lock:
            index = await anyio.to_thread.run_sync(lambda: _load_index(self._index_path))
            return [DocumentRecord.from_dict(v) for v in index.values()]

    async def find_by_source(self, source: str) -> DocumentRecord | None:
        async with self._lock:
            index = await anyio.to_thread.run_sync(lambda: _load_index(self._index_path))
            for raw in index.values():
                if raw.get("source") == source:
                    return DocumentRecord.from_dict(raw)
            return None


# ---------------------------------------------------------------------------
# VectorStoreLike protocol (duck-type; no hard import of F33 stores)
# ---------------------------------------------------------------------------


@runtime_checkable
class _VectorStoreLike(Protocol):
    def add(
        self,
        ids: list[str],
        vectors: list[list[float]],
        metadatas: list[dict[str, Any]],
    ) -> None: ...

    def delete(self, ids: list[str]) -> None: ...


# ---------------------------------------------------------------------------
# Content-hash helper
# ---------------------------------------------------------------------------


def _normalize_content(content: str) -> str:
    """Strip trailing whitespace per line, normalise line endings, strip outer whitespace."""
    lines = content.replace("\r\n", "\n").replace("\r", "\n").splitlines()
    normalised = "\n".join(line.rstrip() for line in lines).strip()
    return normalised


def _content_hash(content: str) -> str:
    normalised = _normalize_content(content)
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds")


def _new_id() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# upsert_document
# ---------------------------------------------------------------------------


async def upsert_document(
    manager: RecordManager,
    *,
    doc_id: str,
    source: str,
    content: str,
    splitter: Any,
    embedder: Any,
    vector_store: Any,
    metadata: dict[str, Any] | None = None,
) -> tuple[UpsertResult, list[str]]:
    """Deduplicate by content hash and upsert into vector store.

    Parameters
    ----------
    manager:      RecordManager instance (FileRecordManager or InMemoryRecordManager).
    doc_id:       Stable document identifier (e.g. file path, URL, UUID).
    source:       Human-readable source label stored in the record.
    content:      Full document text.
    splitter:     Object with ``.split_text(text: str) -> list[str]`` method (F58 TextSplitter).
    embedder:     Callable ``(text: str) -> list[float]``.
    vector_store: Duck-typed object with ``.add(ids, vectors, metadatas)`` and
                  ``.delete(ids)`` (conforms to _VectorStoreLike protocol).
    metadata:     Arbitrary key-value metadata stored alongside the record.

    Returns
    -------
    (UpsertResult, chunk_ids) where chunk_ids are the IDs currently indexed.
    """
    new_hash = _content_hash(content)
    existing = await manager.get(doc_id)

    if existing is not None and existing.content_hash == new_hash:
        return UpsertResult.UNCHANGED, list(existing.chunk_ids)

    if existing is not None:
        old_ids = existing.chunk_ids
        if old_ids:
            vector_store.delete(old_ids)
        result = UpsertResult.UPDATED
    else:
        result = UpsertResult.INSERTED

    texts = splitter.split_text(content)
    if not texts:
        texts = [content] if content.strip() else []

    chunk_ids: list[str] = []
    vectors: list[list[float]] = []
    metas: list[dict[str, Any]] = []
    base_meta = dict(metadata or {})

    for i, text in enumerate(texts):
        cid = f"{doc_id}:{i}"
        chunk_ids.append(cid)
        vectors.append(embedder(text))
        metas.append({**base_meta, "doc_id": doc_id, "source": source, "chunk_index": i})

    if chunk_ids:
        vector_store.add(chunk_ids, vectors, metas)

    record = DocumentRecord(
        doc_id=doc_id,
        source=source,
        content_hash=new_hash,
        chunk_ids=chunk_ids,
        indexed_at=_now_iso(),
        metadata=dict(metadata or {}),
    )
    await manager.put(record)

    return result, chunk_ids


# ---------------------------------------------------------------------------
# upsert_documents (batch)
# ---------------------------------------------------------------------------


async def upsert_documents(
    manager: RecordManager,
    docs: list[tuple[str, str, str, dict[str, Any] | None]],
    *,
    splitter: Any,
    embedder: Any,
    vector_store: Any,
) -> dict[str, UpsertResult]:
    """Batch upsert. Each entry is ``(doc_id, source, content, metadata)``.

    Returns a mapping {doc_id: UpsertResult}.
    """
    results: dict[str, UpsertResult] = {}
    for doc_id, source, content, metadata in docs:
        res, _ = await upsert_document(
            manager,
            doc_id=doc_id,
            source=source,
            content=content,
            splitter=splitter,
            embedder=embedder,
            vector_store=vector_store,
            metadata=metadata,
        )
        results[doc_id] = res
    return results
