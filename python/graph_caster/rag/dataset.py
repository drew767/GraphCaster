# Copyright GraphCaster. All Rights Reserved.

"""Workspace-level Dataset: owns a collection of documents, indexed once, queried many times.

Layout inside .graphcaster/knowledge/<datasetId>/:
  dataset.json     — DatasetMetadata (name, embedding_backend, vector_backend, splitter_config)
  manifest.jsonl   — one entry per indexed document (source, hash, chunk_ids[])
  chunks/          — one .json per chunk: {id, text, doc_id, metadata}
  index/           — vector index storage (backend-specific subdir)
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from graph_caster.rag.bm25 import BM25Index
from graph_caster.rag.embed_dispatch import rag_embed_chunk
from graph_caster.rag.retrieval import (
    RetrievalConfig,
    RetrievalMode,
    RetrievalResult,
    merge_hybrid,
    reciprocal_rank_fusion,
)
from graph_caster.rag.vector_store import InMemoryVectorStore, VectorHit, VectorStore

# ---------------------------------------------------------------------------
# Splitter resolution: prefer F58 splitters module (same package), fall back
# to the lightweight recursive split already present in text_split.py.
# ---------------------------------------------------------------------------
try:
    from graph_caster.rag.splitters import RecursiveCharacterSplitter as _RCS

    def _split_text(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:
        return _RCS(chunk_size=chunk_size, chunk_overlap=chunk_overlap).split_text(text)

except ImportError:  # pragma: no cover — splitters always present in current tree
    from graph_caster.rag.text_split import split_text_chunks as _split_text_chunks

    def _split_text(text: str, chunk_size: int, chunk_overlap: int) -> list[str]:  # type: ignore[misc]
        return _split_text_chunks(text, chunk_size=chunk_size, overlap=chunk_overlap)


_KNOWLEDGE_DIR = Path(".graphcaster") / "knowledge"
_EMBEDDING_DIMS = 64


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------


@dataclass
class DatasetMetadata:
    id: str
    name: str
    description: str = ""
    embedding_backend: str = "hash"
    embedding_model: str | None = None
    vector_backend: str = "memory"
    splitter: dict = field(default_factory=lambda: {"kind": "recursive", "chunk_size": 1000, "chunk_overlap": 200})
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "DatasetMetadata":
        return cls(
            id=d["id"],
            name=d["name"],
            description=d.get("description", ""),
            embedding_backend=d.get("embedding_backend", "hash"),
            embedding_model=d.get("embedding_model"),
            vector_backend=d.get("vector_backend", "memory"),
            splitter=d.get("splitter", {"kind": "recursive", "chunk_size": 1000, "chunk_overlap": 200}),
            created_at=d.get("created_at", ""),
            updated_at=d.get("updated_at", ""),
        )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(tz=timezone.utc).isoformat(timespec="seconds")


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _new_id() -> str:
    return str(uuid.uuid4())


def _load_manifest(manifest_path: Path) -> list[dict[str, Any]]:
    if not manifest_path.exists():
        return []
    entries: list[dict[str, Any]] = []
    for line in manifest_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            try:
                entries.append(json.loads(line))
            except json.JSONDecodeError:
                pass
    return entries


def _save_manifest(manifest_path: Path, entries: list[dict[str, Any]]) -> None:
    manifest_path.write_text(
        "\n".join(json.dumps(e, ensure_ascii=False) for e in entries) + ("\n" if entries else ""),
        encoding="utf-8",
    )


def _build_vector_store(meta: DatasetMetadata, index_dir: Path) -> VectorStore:
    backend = meta.vector_backend.lower()
    if backend in ("memory", "inmemory", ""):
        return InMemoryVectorStore()
    if backend == "chroma":
        chroma_path = str(index_dir / "chroma")
        from graph_caster.rag.chroma_vector_store import ChromaVectorStore  # type: ignore[import]

        return ChromaVectorStore(
            persist_path=chroma_path,
            graph_id=meta.id,
            collection_id="default",
        )
    if backend == "faiss":
        from graph_caster.rag.faiss_vector_store import FaissVectorStore  # type: ignore[import]

        return FaissVectorStore()
    raise ValueError(f"Unknown vector_backend={backend!r} (expected memory, chroma, faiss)")


def _embed(text: str) -> list[float]:
    return rag_embed_chunk(text, _EMBEDDING_DIMS)


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------


class Dataset:
    """Workspace-level document collection with persistent chunks and vector index."""

    def __init__(self, workspace_root: Path, dataset_id: str) -> None:
        self._root = workspace_root.resolve()
        self._dataset_id = dataset_id
        self._dir = self._root / _KNOWLEDGE_DIR / dataset_id
        self._chunks_dir = self._dir / "chunks"
        self._index_dir = self._dir / "index"
        self._manifest_path = self._dir / "manifest.jsonl"
        self._meta_path = self._dir / "dataset.json"
        self._meta: DatasetMetadata | None = None
        self._store: VectorStore | None = None
        self._bm25: BM25Index | None = None

    # ------------------------------------------------------------------
    # Class-level constructors
    # ------------------------------------------------------------------

    @classmethod
    def create(
        cls,
        workspace_root: Path,
        name: str,
        *,
        description: str = "",
        embedding_backend: str = "hash",
        embedding_model: str | None = None,
        vector_backend: str = "memory",
        splitter: dict | None = None,
    ) -> "Dataset":
        dataset_id = _new_id()
        ds = cls(workspace_root, dataset_id)
        ds._dir.mkdir(parents=True, exist_ok=True)
        ds._chunks_dir.mkdir(parents=True, exist_ok=True)
        ds._index_dir.mkdir(parents=True, exist_ok=True)
        now = _now_iso()
        meta = DatasetMetadata(
            id=dataset_id,
            name=name,
            description=description,
            embedding_backend=embedding_backend,
            embedding_model=embedding_model,
            vector_backend=vector_backend,
            splitter=splitter or {"kind": "recursive", "chunk_size": 1000, "chunk_overlap": 200},
            created_at=now,
            updated_at=now,
        )
        ds._meta_path.write_text(json.dumps(meta.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        ds._meta = meta
        # Create an empty manifest
        _save_manifest(ds._manifest_path, [])
        return ds

    @classmethod
    def open(cls, workspace_root: Path, dataset_id: str) -> "Dataset":
        ds = cls(workspace_root, dataset_id)
        if not ds._meta_path.exists():
            raise FileNotFoundError(f"Dataset {dataset_id!r} not found in {workspace_root}")
        return ds

    @classmethod
    def list(cls, workspace_root: Path) -> list[DatasetMetadata]:
        knowledge_root = workspace_root.resolve() / _KNOWLEDGE_DIR
        if not knowledge_root.exists():
            return []
        metas: list[DatasetMetadata] = []
        for entry in sorted(knowledge_root.iterdir()):
            if not entry.is_dir():
                continue
            meta_path = entry / "dataset.json"
            if not meta_path.exists():
                continue
            try:
                raw = json.loads(meta_path.read_text(encoding="utf-8"))
                metas.append(DatasetMetadata.from_dict(raw))
            except (json.JSONDecodeError, KeyError, TypeError):
                pass
        return metas

    def delete(self) -> None:
        import shutil
        if self._dir.exists():
            shutil.rmtree(self._dir)
        self._meta = None
        self._store = None

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def metadata(self) -> DatasetMetadata:
        if self._meta is None:
            raw = json.loads(self._meta_path.read_text(encoding="utf-8"))
            self._meta = DatasetMetadata.from_dict(raw)
        return self._meta

    def _get_store(self) -> VectorStore:
        if self._store is None:
            self._store = _build_vector_store(self.metadata, self._index_dir)
            # For memory backends, repopulate from persisted chunks on every open
            # (the in-memory store is empty after a new process starts).
            if self.metadata.vector_backend.lower() in ("memory", "inmemory", ""):
                self._populate_store_from_disk(self._store)
        return self._store

    @property
    def _bm25_path(self) -> Path:
        return self._index_dir / "bm25.json"

    def _get_bm25(self) -> BM25Index:
        if self._bm25 is None:
            if self._bm25_path.exists():
                self._bm25 = BM25Index.from_disk(self._bm25_path)
            else:
                self._bm25 = BM25Index()
                self._populate_bm25_from_disk(self._bm25)
        return self._bm25

    def _populate_bm25_from_disk(self, idx: BM25Index) -> None:
        if not self._chunks_dir.exists():
            return
        for cf in sorted(self._chunks_dir.glob("*.json")):
            try:
                raw = json.loads(cf.read_text(encoding="utf-8"))
                idx.add(raw["id"], raw["text"])
            except (json.JSONDecodeError, KeyError):
                pass

    def _save_bm25(self) -> None:
        if self._bm25 is not None:
            self._index_dir.mkdir(parents=True, exist_ok=True)
            self._bm25.to_disk(self._bm25_path)

    def _populate_store_from_disk(self, store: VectorStore) -> None:
        """Synchronously load persisted chunks into a freshly created in-memory store."""
        if not self._chunks_dir.exists():
            return
        ids: list[str] = []
        embeddings: list[list[float]] = []
        docs: list[str] = []
        metas: list[dict[str, Any]] = []
        for cf in sorted(self._chunks_dir.glob("*.json")):
            try:
                raw = json.loads(cf.read_text(encoding="utf-8"))
                ids.append(raw["id"])
                embeddings.append(_embed(raw["text"]))
                docs.append(raw["text"])
                metas.append(raw.get("metadata", {}))
            except (json.JSONDecodeError, KeyError):
                pass
        if ids:
            store.upsert(ids, embeddings, docs, metas)

    # ------------------------------------------------------------------
    # Document management
    # ------------------------------------------------------------------

    async def add_document(
        self,
        source: str,
        content: str,
        metadata: dict | None = None,
    ) -> str:
        """Split, embed, persist chunks, update manifest. Returns doc_id."""
        doc_id = _new_id()
        doc_hash = _sha256_text(content)
        splitter_cfg = self.metadata.splitter
        chunk_size = int(splitter_cfg.get("chunk_size", 1000))
        chunk_overlap = int(splitter_cfg.get("chunk_overlap", 200))
        texts = _split_text(content, chunk_size, chunk_overlap)
        if not texts:
            texts = [content] if content.strip() else []

        chunk_ids: list[str] = []
        ids: list[str] = []
        embeddings: list[list[float]] = []
        docs: list[str] = []
        metas: list[dict[str, Any]] = []

        for i, text in enumerate(texts):
            chunk_id = f"{doc_id}:{i}"
            chunk_ids.append(chunk_id)
            ids.append(chunk_id)
            embeddings.append(_embed(text))
            docs.append(text)
            chunk_meta: dict[str, Any] = {
                "doc_id": doc_id,
                "source": source,
                "chunk_index": i,
                **(metadata or {}),
            }
            metas.append(chunk_meta)
            chunk_data = {
                "id": chunk_id,
                "text": text,
                "doc_id": doc_id,
                "metadata": chunk_meta,
            }
            self._chunks_dir.mkdir(parents=True, exist_ok=True)
            (self._chunks_dir / f"{chunk_id.replace(':', '_')}.json").write_text(
                json.dumps(chunk_data, ensure_ascii=False), encoding="utf-8"
            )

        store = self._get_store()
        if ids:
            store.upsert(ids, embeddings, docs, metas)

        bm25 = self._get_bm25()
        for chunk_id, text in zip(ids, docs):
            bm25.add(chunk_id, text)
        self._save_bm25()

        manifest = _load_manifest(self._manifest_path)
        manifest.append(
            {"doc_id": doc_id, "source": source, "hash": doc_hash, "chunk_ids": chunk_ids}
        )
        _save_manifest(self._manifest_path, manifest)
        self._touch_updated()
        return doc_id

    async def add_documents(self, docs: list[tuple[str, str, dict]]) -> list[str]:
        """Add multiple documents. Each tuple is (source, content, metadata)."""
        ids: list[str] = []
        for source, content, meta in docs:
            ids.append(await self.add_document(source, content, meta))
        return ids

    async def remove_document(self, doc_id: str) -> None:
        manifest = _load_manifest(self._manifest_path)
        entry = next((e for e in manifest if e["doc_id"] == doc_id), None)
        if entry is None:
            raise KeyError(f"Document {doc_id!r} not found in dataset {self._dataset_id!r}")
        chunk_ids: list[str] = entry.get("chunk_ids", [])
        bm25 = self._get_bm25()
        for cid in chunk_ids:
            chunk_file = self._chunks_dir / f"{cid.replace(':', '_')}.json"
            if chunk_file.exists():
                chunk_file.unlink()
            bm25.remove(cid)
        self._save_bm25()

        new_manifest = [e for e in manifest if e["doc_id"] != doc_id]
        _save_manifest(self._manifest_path, new_manifest)

        # Rebuild vector store from remaining chunks
        self._store = None
        await self._rebuild_index_from_chunks()
        self._touch_updated()

    async def list_documents(self) -> list[dict]:
        return _load_manifest(self._manifest_path)

    # ------------------------------------------------------------------
    # Query
    # ------------------------------------------------------------------

    async def query(
        self,
        text: str,
        *,
        top_k: int = 5,
        filter: dict | None = None,
        config: RetrievalConfig | None = None,
    ) -> list[dict] | list[RetrievalResult]:
        """Query the dataset.

        Backward-compatible: old callers using top_k/filter get list[dict].
        New callers passing config get list[RetrievalResult].
        """
        if config is None:
            cfg = RetrievalConfig(
                mode=RetrievalMode.VECTOR,
                top_k=top_k,
                metadata_filter=filter,
            )
            return_dict = True
        else:
            cfg = config
            return_dict = False

        results = await self._query_with_config(text, cfg)

        if return_dict:
            return [r.to_dict() for r in results]
        return results

    async def _query_with_config(self, text: str, cfg: RetrievalConfig) -> list[RetrievalResult]:
        fetch_k = cfg.rerank_top_n if cfg.rerank_top_n is not None else cfg.top_k

        if cfg.mode == RetrievalMode.VECTOR:
            results = await self._vector_search(text, fetch_k, cfg.metadata_filter)

        elif cfg.mode == RetrievalMode.KEYWORD:
            results = await self._keyword_search(text, fetch_k, cfg.metadata_filter)

        elif cfg.mode == RetrievalMode.HYBRID:
            results = await self._hybrid_search(text, fetch_k, cfg.hybrid_alpha, cfg.metadata_filter)

        elif cfg.mode == RetrievalMode.FULL_TEXT:
            results = await self._full_text_search(text, fetch_k, cfg.metadata_filter)

        elif cfg.mode == RetrievalMode.MULTIWAY:
            results = await self._multiway_search(text, fetch_k, cfg.metadata_filter)

        else:
            results = await self._vector_search(text, fetch_k, cfg.metadata_filter)

        if cfg.score_threshold is not None:
            results = [r for r in results if r.score >= cfg.score_threshold]

        if cfg.reranker and results:
            from graph_caster.rag.rerankers import get_reranker

            reranker = get_reranker(cfg.reranker)
            results = await reranker.rerank(text, results)
            for r in results:
                r.score = r.rerank_score if r.rerank_score is not None else r.score

        return results[: cfg.top_k]

    async def _vector_search(
        self,
        text: str,
        top_k: int,
        metadata_filter: dict | None,
    ) -> list[RetrievalResult]:
        qv = _embed(text)
        store = self._get_store()
        hits: list[VectorHit] = store.query(qv, top_k, metadata_filter=metadata_filter)
        return [
            RetrievalResult(
                chunk_id=h.id,
                doc_id=h.metadata.get("doc_id", ""),
                text=h.content,
                score=h.score,
                vector_score=h.score,
                metadata=h.metadata,
            )
            for h in hits
        ]

    async def _keyword_search(
        self,
        text: str,
        top_k: int,
        metadata_filter: dict | None,
    ) -> list[RetrievalResult]:
        bm25 = self._get_bm25()
        hits = bm25.search(text, top_k=top_k * 4)
        return self._hits_to_results(hits, metadata_filter, top_k, keyword_scores=True)

    async def _full_text_search(
        self,
        text: str,
        top_k: int,
        metadata_filter: dict | None,
    ) -> list[RetrievalResult]:
        """Case-insensitive substring search over all chunks."""
        lower = text.lower()
        results: list[RetrievalResult] = []
        if not self._chunks_dir.exists():
            return results
        for cf in sorted(self._chunks_dir.glob("*.json")):
            try:
                raw = json.loads(cf.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if lower not in raw.get("text", "").lower():
                continue
            meta = raw.get("metadata", {})
            from graph_caster.rag.vector_store import metadata_matches_row

            if not metadata_matches_row(meta, metadata_filter):
                continue
            results.append(
                RetrievalResult(
                    chunk_id=raw["id"],
                    doc_id=raw.get("doc_id", meta.get("doc_id", "")),
                    text=raw["text"],
                    score=1.0,
                    metadata=meta,
                )
            )
            if len(results) >= top_k:
                break
        return results

    async def _hybrid_search(
        self,
        text: str,
        top_k: int,
        alpha: float,
        metadata_filter: dict | None,
    ) -> list[RetrievalResult]:
        oversample = max(top_k * 4, 20)
        vec_results = await self._vector_search(text, oversample, metadata_filter)
        kw_results = await self._keyword_search(text, oversample, metadata_filter)

        vec_pairs = [(r.chunk_id, r.vector_score or r.score) for r in vec_results]
        kw_pairs = [(r.chunk_id, r.keyword_score or r.score) for r in kw_results]

        merged = merge_hybrid(vec_pairs, kw_pairs, alpha)

        chunk_map: dict[str, RetrievalResult] = {}
        for r in vec_results:
            chunk_map[r.chunk_id] = r
        for r in kw_results:
            if r.chunk_id not in chunk_map:
                chunk_map[r.chunk_id] = r

        results: list[RetrievalResult] = []
        for chunk_id, combined_score in merged[:top_k]:
            base = chunk_map.get(chunk_id)
            if base is None:
                continue
            vec_s = next((r.vector_score for r in vec_results if r.chunk_id == chunk_id), None)
            kw_s = next((r.keyword_score for r in kw_results if r.chunk_id == chunk_id), None)
            results.append(
                RetrievalResult(
                    chunk_id=base.chunk_id,
                    doc_id=base.doc_id,
                    text=base.text,
                    score=combined_score,
                    vector_score=vec_s,
                    keyword_score=kw_s,
                    metadata=base.metadata,
                )
            )
        return results

    async def _multiway_search(
        self,
        text: str,
        top_k: int,
        metadata_filter: dict | None,
    ) -> list[RetrievalResult]:
        oversample = max(top_k * 4, 20)
        vec_results = await self._vector_search(text, oversample, metadata_filter)
        kw_results = await self._keyword_search(text, oversample, metadata_filter)
        ft_results = await self._full_text_search(text, oversample, metadata_filter)

        ranked_lists = [
            [r.chunk_id for r in vec_results],
            [r.chunk_id for r in kw_results],
            [r.chunk_id for r in ft_results],
        ]
        fused = reciprocal_rank_fusion(ranked_lists)

        chunk_map: dict[str, RetrievalResult] = {}
        for r in vec_results + kw_results + ft_results:
            if r.chunk_id not in chunk_map:
                chunk_map[r.chunk_id] = r

        results: list[RetrievalResult] = []
        for chunk_id, rrf_score in fused[:top_k]:
            base = chunk_map.get(chunk_id)
            if base is None:
                continue
            results.append(
                RetrievalResult(
                    chunk_id=base.chunk_id,
                    doc_id=base.doc_id,
                    text=base.text,
                    score=rrf_score,
                    vector_score=base.vector_score,
                    keyword_score=base.keyword_score,
                    metadata=base.metadata,
                )
            )
        return results

    def _hits_to_results(
        self,
        hits: list[tuple[str, float]],
        metadata_filter: dict | None,
        top_k: int,
        keyword_scores: bool = False,
    ) -> list[RetrievalResult]:
        from graph_caster.rag.vector_store import metadata_matches_row

        results: list[RetrievalResult] = []
        for chunk_id, score in hits:
            cf = self._chunks_dir / f"{chunk_id.replace(':', '_')}.json"
            if not cf.exists():
                continue
            try:
                raw = json.loads(cf.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            meta = raw.get("metadata", {})
            if not metadata_matches_row(meta, metadata_filter):
                continue
            results.append(
                RetrievalResult(
                    chunk_id=chunk_id,
                    doc_id=raw.get("doc_id", meta.get("doc_id", "")),
                    text=raw["text"],
                    score=score,
                    keyword_score=score if keyword_scores else None,
                    metadata=meta,
                )
            )
            if len(results) >= top_k:
                break
        return results

    # ------------------------------------------------------------------
    # Reindex
    # ------------------------------------------------------------------

    async def reindex(self) -> None:
        """Re-run embeddings and rebuild vector index and BM25 from persisted chunks."""
        self._store = None
        self._bm25 = None
        if self._bm25_path.exists():
            self._bm25_path.unlink()
        await self._rebuild_index_from_chunks()
        new_bm25 = BM25Index()
        self._populate_bm25_from_disk(new_bm25)
        self._bm25 = new_bm25
        self._save_bm25()
        self._touch_updated()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _rebuild_index_from_chunks(self) -> None:
        store = self._get_store()
        store.clear()
        self._populate_store_from_disk(store)

    def _touch_updated(self) -> None:
        if self._meta is not None:
            self._meta.updated_at = _now_iso()
        if self._meta_path.exists():
            try:
                raw = json.loads(self._meta_path.read_text(encoding="utf-8"))
                raw["updated_at"] = _now_iso()
                self._meta_path.write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")
            except (json.JSONDecodeError, OSError):
                pass
