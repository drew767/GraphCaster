# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import hashlib
from typing import Any, Sequence

from graph_caster.rag.vector_store import VectorHit, VectorStore


def _collection_name(graph_id: str, collection_id: str) -> str:
    digest = hashlib.sha256(f"{graph_id}\0{collection_id}".encode("utf-8")).hexdigest()[:40]
    return f"gc_{digest}"


def _chroma_where(metadata_filter: dict[str, Any] | None) -> dict[str, Any] | None:
    if not metadata_filter:
        return None
    parts: list[dict[str, Any]] = []
    for key, val in metadata_filter.items():
        if val is None:
            continue
        parts.append({str(key): {"$eq": val}})
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    return {"$and": parts}


class ChromaVectorStore(VectorStore):
    """Persistent ChromaDB-backed :class:`VectorStore` (optional extra ``[rag-chroma]``)."""

    def __init__(self, *, persist_path: str, graph_id: str, collection_id: str) -> None:
        import chromadb  # noqa: F401

        self._persist_path = persist_path
        self._name = _collection_name(graph_id, collection_id)
        self._client = chromadb.PersistentClient(path=persist_path)
        self._col = self._client.get_or_create_collection(
            name=self._name,
            metadata={"hnsw:space": "cosine"},
        )

    def clear(self) -> None:
        data = self._col.get(include=[])
        ids = (data or {}).get("ids") if data else None
        if ids:
            self._col.delete(ids=list(ids))

    def upsert(
        self,
        ids: list[str],
        embeddings: list[list[float]],
        documents: list[str],
        metadatas: list[dict[str, Any]] | None = None,
    ) -> None:
        if not (len(ids) == len(embeddings) == len(documents)):
            raise ValueError("ids, embeddings, documents length mismatch")
        md = metadatas or [{} for _ in ids]
        if len(md) != len(ids):
            raise ValueError("metadatas length mismatch")
        chroma_meta: list[dict[str, Any]] = []
        for m in md:
            row: dict[str, Any] = {}
            for k, v in m.items():
                if v is None:
                    continue
                if isinstance(v, (str, int, float, bool)):
                    row[str(k)] = v
                else:
                    row[str(k)] = str(v)
            chroma_meta.append(row)
        self._col.upsert(
            ids=list(ids),
            embeddings=[list(map(float, e)) for e in embeddings],
            documents=list(documents),
            metadatas=chroma_meta,
        )

    def query(
        self,
        embedding: Sequence[float],
        top_k: int,
        *,
        metadata_filter: dict[str, Any] | None = None,
        oversample: int = 1,
    ) -> list[VectorHit]:
        mult = max(1, min(10, int(oversample)))
        cap = max(1, min(100, top_k))
        fetch = max(1, min(100, cap * mult))
        qargs: dict[str, Any] = {
            "query_embeddings": [list(map(float, embedding))],
            "n_results": fetch,
            "include": ["distances", "documents", "metadatas"],
        }
        chroma_where = _chroma_where(metadata_filter)
        if chroma_where is not None:
            qargs["where"] = chroma_where
        res = self._col.query(**qargs)
        out: list[VectorHit] = []
        if not res or not res.get("ids") or not res["ids"][0]:
            return out
        ids_row = res["ids"][0]
        dists = (res.get("distances") or [[]])[0]
        docs = (res.get("documents") or [[]])[0]
        metas = (res.get("metadatas") or [[]])[0]
        for i, rid in enumerate(ids_row):
            d = float(dists[i]) if i < len(dists) else 0.0
            score = 1.0 - d
            doc = docs[i] if i < len(docs) else ""
            raw_meta = metas[i] if i < len(metas) else None
            meta = dict(raw_meta) if isinstance(raw_meta, dict) else {}
            out.append(VectorHit(id=str(rid), content=str(doc), metadata=meta, score=score))
        return out[:cap]
