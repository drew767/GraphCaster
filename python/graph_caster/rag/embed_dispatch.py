# Copyright Aura. All Rights Reserved.

"""Pluggable RAG chunk embeddings: hash (default), OpenAI API, sentence-transformers."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

from graph_caster.rag.embedding import hash_embedding

_ST_MODEL: Any = None
_ST_MODEL_NAME: str | None = None


def _resize_vector(vec: list[float], dims: int) -> list[float]:
    if dims < 8 or dims > 4096:
        raise ValueError("dims must be between 8 and 4096")
    if len(vec) == dims:
        return vec
    if len(vec) > dims:
        return vec[:dims]
    return vec + [0.0] * (dims - len(vec))


def _embed_openai(text: str, dims: int) -> list[float]:
    key = (os.environ.get("GC_OPENAI_API_KEY") or os.environ.get("OPENAI_API_KEY") or "").strip()
    if not key:
        raise ValueError(
            "GC_RAG_EMBEDDING_BACKEND=openai requires GC_OPENAI_API_KEY or OPENAI_API_KEY",
        )
    model = (os.environ.get("GC_RAG_OPENAI_EMBED_MODEL") or "text-embedding-3-small").strip()
    base = (os.environ.get("GC_OPENAI_API_BASE") or "https://api.openai.com/v1").rstrip("/")
    url = f"{base}/embeddings"
    body = json.dumps({"model": model, "input": text}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise ValueError(f"OpenAI embeddings HTTP {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        raise ValueError(f"OpenAI embeddings request failed: {e}") from e
    data = payload.get("data")
    if not isinstance(data, list) or not data:
        raise ValueError("OpenAI embeddings response missing data[]")
    first = data[0]
    if not isinstance(first, dict):
        raise ValueError("OpenAI embeddings invalid data[0]")
    emb = first.get("embedding")
    if not isinstance(emb, list) or not all(isinstance(x, (int, float)) for x in emb):
        raise ValueError("OpenAI embeddings invalid embedding vector")
    return _resize_vector([float(x) for x in emb], dims)


def _embed_sentence_transformers(text: str, dims: int) -> list[float]:
    global _ST_MODEL, _ST_MODEL_NAME
    try:
        from sentence_transformers import SentenceTransformer
    except ImportError as e:
        raise ValueError(
            "GC_RAG_EMBEDDING_BACKEND=sentence_transformers requires sentence-transformers "
            "(pip install 'graph-caster[rag-embed-local]')",
        ) from e
    model_name = (os.environ.get("GC_RAG_SENTENCE_TRANSFORMER_MODEL") or "all-MiniLM-L6-v2").strip()
    if _ST_MODEL is None or _ST_MODEL_NAME != model_name:
        _ST_MODEL = SentenceTransformer(model_name)
        _ST_MODEL_NAME = model_name
    vec = _ST_MODEL.encode(text, convert_to_numpy=True)
    try:
        flat = [float(x) for x in vec.tolist()]  # type: ignore[union-attr]
    except Exception:
        flat = [float(x) for x in list(vec)]
    return _resize_vector(flat, dims)


def rag_embed_chunk(text: str, dims: int) -> list[float]:
    """Return an embedding vector for ``text``, sized to ``dims`` for the vector store."""

    backend = (os.environ.get("GC_RAG_EMBEDDING_BACKEND") or "hash").strip().lower()
    if backend in ("hash", "", "deterministic"):
        return hash_embedding(text, dims=dims)
    if backend == "openai":
        return _embed_openai(text, dims)
    if backend in ("sentence_transformers", "sentence-transformers", "local"):
        return _embed_sentence_transformers(text, dims)
    raise ValueError(f"unknown GC_RAG_EMBEDDING_BACKEND={backend!r}")
