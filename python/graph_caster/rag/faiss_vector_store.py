# Copyright Aura. All Rights Reserved.

from __future__ import annotations

from typing import Any, Sequence

from graph_caster.rag.vector_store import VectorHit, VectorStore, metadata_matches_row


class FaissVectorStore(VectorStore):
    """In-process FAISS :class:`VectorStore` (optional extra ``[rag-faiss]``).

    Vectors are L2-normalized; search uses inner product (= cosine similarity).
    """

    def __init__(self) -> None:
        import faiss  # noqa: F401

        self._dim: int | None = None
        self._ids: list[str] = []
        self._documents: list[str] = []
        self._metadatas: list[dict[str, Any]] = []
        self._index: Any = None

    def clear(self) -> None:
        self._dim = None
        self._ids.clear()
        self._documents.clear()
        self._metadatas.clear()
        self._index = None

    @staticmethod
    def _norm(vec: Sequence[float]) -> Any:
        import numpy as np

        arr = np.asarray(vec, dtype=np.float32)
        n = float(np.linalg.norm(arr))
        if n > 0.0:
            arr = arr / n
        return arr

    def upsert(
        self,
        ids: list[str],
        embeddings: list[list[float]],
        documents: list[str],
        metadatas: list[dict[str, Any]] | None = None,
    ) -> None:
        import faiss
        import numpy as np

        if not (len(ids) == len(embeddings) == len(documents)):
            raise ValueError("ids, embeddings, documents length mismatch")
        md = metadatas or [{} for _ in ids]
        if len(md) != len(ids):
            raise ValueError("metadatas length mismatch")
        dim = len(embeddings[0])
        if self._dim is None:
            self._dim = dim
            self._index = faiss.IndexFlatIP(dim)
        elif dim != self._dim:
            raise ValueError("embedding dimension mismatch")
        assert self._index is not None
        mat = np.stack([self._norm(e) for e in embeddings]).astype(np.float32, copy=False)
        self._index.add(mat)
        self._ids.extend(ids)
        self._documents.extend(documents)
        self._metadatas.extend(dict(m) for m in md)

    def query(
        self,
        embedding: Sequence[float],
        top_k: int,
        *,
        metadata_filter: dict[str, Any] | None = None,
        oversample: int = 1,
    ) -> list[VectorHit]:
        import numpy as np

        if self._index is None or self._index.ntotal == 0:
            return []
        mult = max(1, min(10, int(oversample)))
        cap = max(1, min(100, top_k))
        k_base = cap
        if metadata_filter:
            k_base = min(100, cap * mult)
        q = np.asarray(self._norm(embedding), dtype=np.float32).reshape(1, -1)
        n = int(self._index.ntotal)
        scores, idx_arr = self._index.search(q, min(max(1, k_base), n))
        out: list[VectorHit] = []
        row_scores = scores[0].tolist()
        row_idx = idx_arr[0].tolist()
        for rank, idx in enumerate(row_idx):
            if int(idx) < 0:
                continue
            i = int(idx)
            meta = dict(self._metadatas[i])
            if not metadata_matches_row(meta, metadata_filter):
                continue
            out.append(
                VectorHit(
                    id=self._ids[i],
                    content=self._documents[i],
                    metadata=meta,
                    score=float(row_scores[rank]),
                )
            )
            if len(out) >= cap:
                break
        return out
