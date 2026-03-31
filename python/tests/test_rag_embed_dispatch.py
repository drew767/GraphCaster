# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import json
from unittest import mock

import pytest

from graph_caster.rag.embed_dispatch import rag_embed_chunk


def test_rag_embed_chunk_hash_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_RAG_EMBEDDING_BACKEND", raising=False)
    a = rag_embed_chunk("hello", 64)
    b = rag_embed_chunk("hello", 64)
    assert len(a) == 64
    assert a == b


def test_rag_embed_chunk_unknown_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RAG_EMBEDDING_BACKEND", "nope")
    try:
        with pytest.raises(ValueError, match="unknown"):
            rag_embed_chunk("x", 64)
    finally:
        monkeypatch.delenv("GC_RAG_EMBEDDING_BACKEND", raising=False)


def test_rag_embed_openai_resize(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RAG_EMBEDDING_BACKEND", "openai")
    monkeypatch.setenv("GC_OPENAI_API_KEY", "sk-test")
    payload = json.dumps(
        {"data": [{"embedding": [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]}]},
    ).encode("utf-8")

    class _Resp:
        def __enter__(self) -> _Resp:
            return self

        def __exit__(self, *args: object) -> None:
            return None

        def read(self) -> bytes:
            return payload

    try:
        with mock.patch("graph_caster.rag.embed_dispatch.urllib.request.urlopen", return_value=_Resp()):
            out = rag_embed_chunk("hi", 16)
        assert len(out) == 16
        assert out[:8] == [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
        assert out[8:] == [0.0] * 8
    finally:
        monkeypatch.delenv("GC_RAG_EMBEDDING_BACKEND", raising=False)
        monkeypatch.delenv("GC_OPENAI_API_KEY", raising=False)


def test_rag_embed_openai_requires_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RAG_EMBEDDING_BACKEND", "openai")
    monkeypatch.delenv("GC_OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    try:
        with pytest.raises(ValueError, match="API_KEY"):
            rag_embed_chunk("x", 64)
    finally:
        monkeypatch.delenv("GC_RAG_EMBEDDING_BACKEND", raising=False)
