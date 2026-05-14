# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from typing import Any
from unittest import mock

import httpx
import pytest

from graph_caster.rag.embeddings.base import ConfigError
from graph_caster.rag.embeddings.cache import EmbedCache


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_openai_response(vectors: list[list[float]]) -> dict[str, Any]:
    return {
        "data": [{"index": i, "embedding": vec} for i, vec in enumerate(vectors)],
        "model": "text-embedding-3-small",
        "usage": {"prompt_tokens": 10, "total_tokens": 10},
    }


def _make_cohere_response(vectors: list[list[float]]) -> dict[str, Any]:
    return {
        "id": "abc",
        "embeddings": {"float": vectors},
        "texts": ["t"] * len(vectors),
    }


def _make_voyage_response(vectors: list[list[float]]) -> dict[str, Any]:
    return {
        "data": [{"index": i, "embedding": vec} for i, vec in enumerate(vectors)],
        "model": "voyage-2",
        "usage": {"total_tokens": 10},
    }


def _make_jina_response(vectors: list[list[float]]) -> dict[str, Any]:
    return {
        "data": [{"index": i, "embedding": vec} for i, vec in enumerate(vectors)],
        "model": "jina-embeddings-v2-base-en",
        "usage": {"total_tokens": 10},
    }


def _make_fake_vectors(n: int, dim: int) -> list[list[float]]:
    return [[float(i * dim + j) / 1000.0 for j in range(dim)] for i in range(n)]


def _httpx_response(url: str, body_bytes: bytes, status_code: int = 200) -> httpx.Response:
    """Build an httpx.Response with a dummy request attached (required for raise_for_status)."""
    req = httpx.Request("POST", url)
    return httpx.Response(status_code, content=body_bytes, request=req)


class _MockAsyncClientFactory:
    """Factory that builds a mock httpx.AsyncClient class for a given handler."""

    def __init__(
        self,
        response_body: Any,
        status_code: int = 200,
        capture: list[httpx.Request] | None = None,
    ) -> None:
        self._body_bytes = json.dumps(response_body).encode()
        self._status = status_code
        self._captured: list[httpx.Request] = capture if capture is not None else []

    @property
    def captured(self) -> list[httpx.Request]:
        return self._captured

    def make_class(self) -> type:
        body_bytes = self._body_bytes
        status = self._status
        captured = self._captured

        class _Client:
            def __init__(self, **kwargs: Any) -> None:
                pass

            async def __aenter__(self) -> "_Client":
                return self

            async def __aexit__(self, *args: Any) -> None:
                pass

            async def post(self, url: str, **kwargs: Any) -> httpx.Response:
                req = httpx.Request(
                    "POST",
                    url,
                    content=kwargs.get("content", b""),
                    headers=kwargs.get("headers", {}),
                )
                captured.append(req)
                return _httpx_response(url, body_bytes, status)

        return _Client


def _mock_client_for(module_path: str, response_body: Any, status_code: int = 200):
    """Return (patcher, captured_requests)."""
    captured: list[httpx.Request] = []
    factory = _MockAsyncClientFactory(response_body, status_code, captured)
    patcher = mock.patch(f"{module_path}.httpx.AsyncClient", factory.make_class())
    return patcher, captured


# ---------------------------------------------------------------------------
# HashEmbedder
# ---------------------------------------------------------------------------

class TestHashEmbedder:
    def test_basic(self) -> None:
        import asyncio
        from graph_caster.rag.embeddings.hash_embed import HashEmbedder
        e = HashEmbedder(dims=64)
        vecs = asyncio.run(e.embed_texts(["hello", "world"]))
        assert len(vecs) == 2
        for v in vecs:
            assert len(v) == 64

    def test_deterministic(self) -> None:
        import asyncio
        from graph_caster.rag.embeddings.hash_embed import HashEmbedder
        e = HashEmbedder()
        v1 = asyncio.run(e.embed_text("test"))
        v2 = asyncio.run(e.embed_text("test"))
        assert v1 == v2

    def test_embed_text_convenience(self) -> None:
        import asyncio
        from graph_caster.rag.embeddings.hash_embed import HashEmbedder
        e = HashEmbedder(dims=32)
        v = asyncio.run(e.embed_text("single"))
        assert isinstance(v, list)
        assert len(v) == 32


# ---------------------------------------------------------------------------
# OpenAIEmbedder
# ---------------------------------------------------------------------------

class TestOpenAIEmbedder:
    def test_request_shape(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        from graph_caster.rag.embeddings import openai_embed

        texts = ["hello", "world"]
        vectors = _make_fake_vectors(2, 1536)
        patcher, captured = _mock_client_for(
            "graph_caster.rag.embeddings.openai_embed",
            _make_openai_response(vectors),
        )

        with patcher:
            result = asyncio.run(openai_embed.OpenAIEmbedder().embed_texts(texts))

        assert len(captured) == 1
        req = captured[0]
        assert "/v1/embeddings" in str(req.url)
        body = json.loads(req.content)
        assert body["model"] == "text-embedding-3-small"
        assert body["input"] == texts
        assert req.headers.get("authorization") == "Bearer sk-test"
        assert len(result) == 2
        assert len(result[0]) == 1536

    def test_result_shape_5(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        from graph_caster.rag.embeddings import openai_embed

        texts = ["a"] * 5
        vectors = _make_fake_vectors(5, 1536)
        patcher, _ = _mock_client_for(
            "graph_caster.rag.embeddings.openai_embed",
            _make_openai_response(vectors),
        )

        with patcher:
            result = asyncio.run(openai_embed.OpenAIEmbedder().embed_texts(texts))
        assert len(result) == 5
        assert all(len(v) == 1536 for v in result)

    def test_batching_100(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        from graph_caster.rag.embeddings import openai_embed

        texts = [f"text-{i}" for i in range(100)]
        vectors = _make_fake_vectors(100, 1536)
        call_count = 0

        class _Client:
            def __init__(self, **kwargs: Any) -> None:
                pass
            async def __aenter__(self) -> "_Client":
                return self
            async def __aexit__(self, *args: Any) -> None:
                pass
            async def post(self, url: str, **kwargs: Any) -> httpx.Response:
                nonlocal call_count
                call_count += 1
                body = json.loads(kwargs.get("content", b"{}"))
                assert len(body["input"]) == 100
                return _httpx_response(url, json.dumps(_make_openai_response(vectors)).encode())

        with mock.patch("graph_caster.rag.embeddings.openai_embed.httpx.AsyncClient", _Client):
            result = asyncio.run(openai_embed.OpenAIEmbedder().embed_texts(texts))

        assert call_count == 1
        assert len(result) == 100

    def test_missing_key_raises(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.delenv("GC_OPENAI_API_KEY", raising=False)
        from graph_caster.rag.embeddings.openai_embed import OpenAIEmbedder
        e = OpenAIEmbedder()
        with pytest.raises(ConfigError, match="OPENAI_API_KEY"):
            asyncio.run(e.embed_texts(["x"]))

    def test_large_model_dim(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        from graph_caster.rag.embeddings.openai_embed import OpenAIEmbedder
        e = OpenAIEmbedder(model="text-embedding-3-large")
        assert e.dim == 3072


# ---------------------------------------------------------------------------
# CohereEmbedder
# ---------------------------------------------------------------------------

class TestCohereEmbedder:
    def test_request_shape(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio
        monkeypatch.setenv("COHERE_API_KEY", "co-test")
        from graph_caster.rag.embeddings import cohere_embed

        texts = ["hello", "world"]
        vectors = _make_fake_vectors(2, 1024)
        patcher, captured = _mock_client_for(
            "graph_caster.rag.embeddings.cohere_embed",
            _make_cohere_response(vectors),
        )

        with patcher:
            result = asyncio.run(cohere_embed.CohereEmbedder().embed_texts(texts))

        req = captured[0]
        assert "/v1/embed" in str(req.url)
        body = json.loads(req.content)
        assert body["model"] == "embed-english-v3.0"
        assert body["texts"] == texts
        assert req.headers.get("authorization") == "Bearer co-test"
        assert len(result) == 2
        assert len(result[0]) == 1024

    def test_missing_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio
        monkeypatch.delenv("COHERE_API_KEY", raising=False)
        from graph_caster.rag.embeddings.cohere_embed import CohereEmbedder
        with pytest.raises(ConfigError, match="COHERE_API_KEY"):
            asyncio.run(CohereEmbedder().embed_texts(["x"]))

    def test_multilingual_model_dim(self) -> None:
        from graph_caster.rag.embeddings.cohere_embed import CohereEmbedder
        e = CohereEmbedder(model="embed-multilingual-v3.0")
        assert e.dim == 1024


# ---------------------------------------------------------------------------
# OllamaEmbedder
# ---------------------------------------------------------------------------

class TestOllamaEmbedder:
    def test_request_shape(self) -> None:
        import asyncio
        from graph_caster.rag.embeddings import ollama_embed

        texts = ["hello", "world"]
        call_count = 0
        captured_bodies: list[dict] = []

        class _Client:
            def __init__(self, **kwargs: Any) -> None:
                pass
            async def __aenter__(self) -> "_Client":
                return self
            async def __aexit__(self, *args: Any) -> None:
                pass
            async def post(self, url: str, **kwargs: Any) -> httpx.Response:
                nonlocal call_count
                call_count += 1
                body = json.loads(kwargs.get("content", b"{}"))
                captured_bodies.append(body)
                return _httpx_response(url, json.dumps({"embedding": [0.1] * 768}).encode())

        with mock.patch("graph_caster.rag.embeddings.ollama_embed.httpx.AsyncClient", _Client):
            result = asyncio.run(ollama_embed.OllamaEmbedder().embed_texts(texts))

        assert call_count == 2
        assert all(b["model"] == "nomic-embed-text" for b in captured_bodies)
        assert len(result) == 2
        assert len(result[0]) == 768

    def test_no_auth_header(self) -> None:
        import asyncio
        from graph_caster.rag.embeddings import ollama_embed

        class _Client:
            def __init__(self, **kwargs: Any) -> None:
                pass
            async def __aenter__(self) -> "_Client":
                return self
            async def __aexit__(self, *args: Any) -> None:
                pass
            async def post(self, url: str, **kwargs: Any) -> httpx.Response:
                headers = kwargs.get("headers", {})
                assert "authorization" not in {k.lower() for k in headers}
                return _httpx_response(url, json.dumps({"embedding": [0.0] * 768}).encode())

        with mock.patch("graph_caster.rag.embeddings.ollama_embed.httpx.AsyncClient", _Client):
            asyncio.run(ollama_embed.OllamaEmbedder().embed_texts(["test"]))


# ---------------------------------------------------------------------------
# BedrockEmbedder
# ---------------------------------------------------------------------------

try:
    import boto3 as _boto3_check
    _BOTO3_AVAILABLE = True
except ImportError:
    _BOTO3_AVAILABLE = False


@pytest.mark.skipif(not _BOTO3_AVAILABLE, reason="boto3 not installed")
class TestBedrockEmbedder:
    def _make_mock_client(self, vec: list[float]) -> Any:
        import io
        client = mock.MagicMock()
        body_bytes = json.dumps({"embedding": vec}).encode()
        client.invoke_model.return_value = {"body": io.BytesIO(body_bytes)}
        return client

    def test_titan_embed(self) -> None:
        import asyncio
        from graph_caster.rag.embeddings.bedrock_embed import BedrockEmbedder

        vec = [0.1] * 1536
        mock_client = self._make_mock_client(vec)
        e = BedrockEmbedder(model="amazon.titan-embed-text-v1", boto3_client=mock_client)
        result = asyncio.run(e.embed_texts(["hello"]))
        assert len(result) == 1
        assert len(result[0]) == 1536
        mock_client.invoke_model.assert_called_once()
        call_kwargs = mock_client.invoke_model.call_args
        assert call_kwargs.kwargs.get("modelId") == "amazon.titan-embed-text-v1"

    def test_cohere_bedrock(self) -> None:
        import asyncio, io
        from graph_caster.rag.embeddings.bedrock_embed import BedrockEmbedder

        vecs = [[0.2] * 1024, [0.3] * 1024]
        client = mock.MagicMock()
        body_bytes = json.dumps({"embeddings": vecs}).encode()
        client.invoke_model.return_value = {"body": io.BytesIO(body_bytes)}
        e = BedrockEmbedder(model="cohere.embed-multilingual-v3", boto3_client=client)
        result = asyncio.run(e.embed_texts(["a", "b"]))
        assert len(result) == 2
        assert len(result[0]) == 1024

    def test_missing_boto3(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio, builtins
        from graph_caster.rag.embeddings.bedrock_embed import BedrockEmbedder

        real_import = builtins.__import__

        def fake_import(name: str, *args: Any, **kwargs: Any) -> Any:
            if name == "boto3":
                raise ImportError("no boto3")
            return real_import(name, *args, **kwargs)

        e = BedrockEmbedder()
        with monkeypatch.context() as m:
            m.setattr(builtins, "__import__", fake_import)
            with pytest.raises(ImportError, match="boto3"):
                asyncio.run(e.embed_texts(["x"]))


# ---------------------------------------------------------------------------
# VoyageEmbedder
# ---------------------------------------------------------------------------

class TestVoyageEmbedder:
    def test_request_shape(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio
        monkeypatch.setenv("VOYAGE_API_KEY", "pa-test")
        from graph_caster.rag.embeddings import voyage_embed

        texts = ["a", "b", "c"]
        vectors = _make_fake_vectors(3, 1024)
        patcher, captured = _mock_client_for(
            "graph_caster.rag.embeddings.voyage_embed",
            _make_voyage_response(vectors),
        )

        with patcher:
            result = asyncio.run(voyage_embed.VoyageEmbedder().embed_texts(texts))

        req = captured[0]
        assert "voyageai.com" in str(req.url)
        body = json.loads(req.content)
        assert body["model"] == "voyage-2"
        assert body["input"] == texts
        assert req.headers.get("authorization") == "Bearer pa-test"
        assert len(result) == 3
        assert len(result[0]) == 1024

    def test_missing_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio
        monkeypatch.delenv("VOYAGE_API_KEY", raising=False)
        from graph_caster.rag.embeddings.voyage_embed import VoyageEmbedder
        with pytest.raises(ConfigError, match="VOYAGE_API_KEY"):
            asyncio.run(VoyageEmbedder().embed_texts(["x"]))

    def test_large_model_dim(self) -> None:
        from graph_caster.rag.embeddings.voyage_embed import VoyageEmbedder
        e = VoyageEmbedder(model="voyage-large-2")
        assert e.dim == 1536


# ---------------------------------------------------------------------------
# JinaEmbedder
# ---------------------------------------------------------------------------

class TestJinaEmbedder:
    def test_request_shape(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio
        monkeypatch.setenv("JINA_API_KEY", "jina-test")
        from graph_caster.rag.embeddings import jina_embed

        texts = ["hello", "world"]
        vectors = _make_fake_vectors(2, 768)
        patcher, captured = _mock_client_for(
            "graph_caster.rag.embeddings.jina_embed",
            _make_jina_response(vectors),
        )

        with patcher:
            result = asyncio.run(jina_embed.JinaEmbedder().embed_texts(texts))

        req = captured[0]
        assert "jina.ai" in str(req.url)
        body = json.loads(req.content)
        assert body["model"] == "jina-embeddings-v2-base-en"
        assert body["input"] == texts
        assert req.headers.get("authorization") == "Bearer jina-test"
        assert len(result) == 2
        assert len(result[0]) == 768

    def test_missing_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio
        monkeypatch.delenv("JINA_API_KEY", raising=False)
        from graph_caster.rag.embeddings.jina_embed import JinaEmbedder
        with pytest.raises(ConfigError, match="JINA_API_KEY"):
            asyncio.run(JinaEmbedder().embed_texts(["x"]))


# ---------------------------------------------------------------------------
# HuggingFaceEmbedder
# ---------------------------------------------------------------------------

class TestHuggingFaceEmbedder:
    def test_request_shape(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio
        monkeypatch.setenv("HUGGINGFACE_API_KEY", "hf-test")
        from graph_caster.rag.embeddings import huggingface_embed

        texts = ["hello", "world"]
        vectors = _make_fake_vectors(2, 384)
        patcher, captured = _mock_client_for(
            "graph_caster.rag.embeddings.huggingface_embed",
            vectors,
        )

        with patcher:
            result = asyncio.run(
                huggingface_embed.HuggingFaceEmbedder(
                    model="sentence-transformers/all-MiniLM-L6-v2"
                ).embed_texts(texts)
            )

        req = captured[0]
        assert "huggingface.co" in str(req.url)
        assert "sentence-transformers/all-MiniLM-L6-v2" in str(req.url)
        body = json.loads(req.content)
        assert body["inputs"] == texts
        assert req.headers.get("authorization") == "Bearer hf-test"
        assert len(result) == 2
        assert len(result[0]) == 384

    def test_missing_key(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio
        monkeypatch.delenv("HUGGINGFACE_API_KEY", raising=False)
        from graph_caster.rag.embeddings.huggingface_embed import HuggingFaceEmbedder
        with pytest.raises(ConfigError, match="HUGGINGFACE_API_KEY"):
            asyncio.run(HuggingFaceEmbedder().embed_texts(["x"]))


# ---------------------------------------------------------------------------
# EmbedCache
# ---------------------------------------------------------------------------

class TestEmbedCache:
    def test_cache_miss_then_hit(self) -> None:
        cache = EmbedCache(max_entries=100)
        assert cache.get("openai", "m", "hello") is None
        vec = [0.1, 0.2, 0.3]
        cache.put("openai", "m", "hello", vec)
        result = cache.get("openai", "m", "hello")
        assert result == vec

    def test_lru_eviction(self) -> None:
        cache = EmbedCache(max_entries=3)
        for i in range(3):
            cache.put("p", "m", f"text-{i}", [float(i)])
        assert len(cache) == 3
        cache.put("p", "m", "text-new", [99.0])
        assert len(cache) == 3
        assert cache.get("p", "m", "text-0") is None

    def test_cache_disabled(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("GC_EMBED_CACHE", "off")
        cache = EmbedCache(max_entries=100)
        cache.put("p", "m", "hello", [1.0])
        assert cache.get("p", "m", "hello") is None

    def test_different_providers_separate(self) -> None:
        cache = EmbedCache(max_entries=100)
        cache.put("openai", "m", "hello", [1.0])
        cache.put("cohere", "m", "hello", [2.0])
        assert cache.get("openai", "m", "hello") == [1.0]
        assert cache.get("cohere", "m", "hello") == [2.0]

    def test_same_text_twice_cache_hit(self, monkeypatch: pytest.MonkeyPatch) -> None:
        import asyncio
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        monkeypatch.setenv("GC_EMBED_CACHE", "on")
        from graph_caster.rag.embeddings import openai_embed
        from graph_caster.rag.embeddings.cache import EmbedCache

        call_count = 0
        vec = [0.5] * 1536

        class _Client:
            def __init__(self, **kwargs: Any) -> None:
                pass
            async def __aenter__(self) -> "_Client":
                return self
            async def __aexit__(self, *args: Any) -> None:
                pass
            async def post(self, url: str, **kwargs: Any) -> httpx.Response:
                nonlocal call_count
                call_count += 1
                return _httpx_response(url, json.dumps(_make_openai_response([vec])).encode())

        cache = EmbedCache(max_entries=1000)
        e = openai_embed.OpenAIEmbedder()

        with mock.patch("graph_caster.rag.embeddings.openai_embed.httpx.AsyncClient", _Client):
            async def run() -> None:
                v1 = (await e.embed_texts(["hello"]))[0]
                cache.put("openai", "text-embedding-3-small", "hello", v1)
                cached = cache.get("openai", "text-embedding-3-small", "hello")
                assert cached is not None and cached == v1
                v2_cached = cache.get("openai", "text-embedding-3-small", "hello")
                assert v2_cached == v1

            asyncio.run(run())

        assert call_count == 1
