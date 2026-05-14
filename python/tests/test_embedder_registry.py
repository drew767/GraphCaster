# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import pytest

from graph_caster.rag.embeddings import (
    Embedder,
    EmbedderRegistry,
    HashEmbedder,
    get_default_embedder_registry,
)
from graph_caster.rag.embeddings.openai_embed import OpenAIEmbedder


# ---------------------------------------------------------------------------
# Registry unit tests
# ---------------------------------------------------------------------------

class TestEmbedderRegistry:
    def test_register_and_list(self) -> None:
        reg = EmbedderRegistry()
        reg.register(HashEmbedder)
        assert "hash" in reg.list()

    def test_make_hash(self) -> None:
        reg = EmbedderRegistry()
        reg.register(HashEmbedder)
        e = reg.make("hash")
        assert isinstance(e, HashEmbedder)

    def test_make_openai_with_model(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        reg = EmbedderRegistry()
        reg.register(OpenAIEmbedder)
        e = reg.make("openai", model="text-embedding-3-small")
        assert isinstance(e, OpenAIEmbedder)
        assert e._model == "text-embedding-3-small"
        assert e.dim == 1536

    def test_make_unknown_raises(self) -> None:
        reg = EmbedderRegistry()
        reg.register(HashEmbedder)
        with pytest.raises(KeyError, match="unknown embedder"):
            reg.make("does-not-exist")

    def test_list_sorted(self) -> None:
        reg = EmbedderRegistry()
        reg.register(OpenAIEmbedder)
        reg.register(HashEmbedder)
        names = reg.list()
        assert names == sorted(names)

    def test_register_overwrite(self) -> None:
        class CustomEmbed(Embedder):
            name = "hash"
            dim = 8

            async def embed_texts(self, texts: list[str]) -> list[list[float]]:
                return [[0.0] * 8 for _ in texts]

        reg = EmbedderRegistry()
        reg.register(HashEmbedder)
        reg.register(CustomEmbed)
        e = reg.make("hash")
        assert isinstance(e, CustomEmbed)


# ---------------------------------------------------------------------------
# Default registry
# ---------------------------------------------------------------------------

class TestDefaultRegistry:
    def test_hash_in_default(self) -> None:
        reg = get_default_embedder_registry()
        assert "hash" in reg.list()

    def test_openai_in_default(self) -> None:
        reg = get_default_embedder_registry()
        assert "openai" in reg.list()

    def test_cohere_in_default(self) -> None:
        reg = get_default_embedder_registry()
        assert "cohere" in reg.list()

    def test_ollama_in_default(self) -> None:
        reg = get_default_embedder_registry()
        assert "ollama" in reg.list()

    def test_voyage_in_default(self) -> None:
        reg = get_default_embedder_registry()
        assert "voyage" in reg.list()

    def test_jina_in_default(self) -> None:
        reg = get_default_embedder_registry()
        assert "jina" in reg.list()

    def test_huggingface_in_default(self) -> None:
        reg = get_default_embedder_registry()
        assert "huggingface" in reg.list()

    def test_make_openai_from_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
        reg = get_default_embedder_registry()
        e = reg.make("openai", model="text-embedding-3-small")
        assert isinstance(e, OpenAIEmbedder)
        assert e.dim == 1536

    def test_unknown_raises_keyerror(self) -> None:
        reg = get_default_embedder_registry()
        with pytest.raises(KeyError):
            reg.make("nonexistent-provider")
