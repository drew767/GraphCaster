# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from typing import Any

from graph_caster.rag.embeddings.base import ConfigError, Embedder
from graph_caster.rag.embeddings.cache import EmbedCache, get_default_embed_cache
from graph_caster.rag.embeddings.hash_embed import HashEmbedder


class EmbedderRegistry:
    def __init__(self) -> None:
        self._registry: dict[str, type[Embedder]] = {}

    def register(self, embedder_cls: type[Embedder]) -> None:
        self._registry[embedder_cls.name] = embedder_cls

    def make(self, name: str, **kwargs: Any) -> Embedder:
        cls = self._registry.get(name)
        if cls is None:
            available = sorted(self._registry)
            raise KeyError(f"unknown embedder {name!r}; available: {available}")
        return cls(**kwargs)

    def list(self) -> list[str]:
        return sorted(self._registry)


_DEFAULT_REGISTRY: EmbedderRegistry | None = None


def get_default_embedder_registry() -> EmbedderRegistry:
    global _DEFAULT_REGISTRY
    if _DEFAULT_REGISTRY is None:
        _DEFAULT_REGISTRY = _build_default_registry()
    return _DEFAULT_REGISTRY


def _reset_default_registry() -> None:
    """Reset the cached default registry (for test isolation only)."""
    global _DEFAULT_REGISTRY
    _DEFAULT_REGISTRY = None


def _build_default_registry() -> EmbedderRegistry:
    reg = EmbedderRegistry()
    reg.register(HashEmbedder)

    try:
        from graph_caster.rag.embeddings.openai_embed import OpenAIEmbedder
        reg.register(OpenAIEmbedder)
    except ImportError:
        pass

    try:
        from graph_caster.rag.embeddings.cohere_embed import CohereEmbedder
        reg.register(CohereEmbedder)
    except ImportError:
        pass

    try:
        from graph_caster.rag.embeddings.ollama_embed import OllamaEmbedder
        reg.register(OllamaEmbedder)
    except ImportError:
        pass

    try:
        from graph_caster.rag.embeddings.bedrock_embed import BedrockEmbedder
        reg.register(BedrockEmbedder)
    except ImportError:
        pass

    try:
        from graph_caster.rag.embeddings.voyage_embed import VoyageEmbedder
        reg.register(VoyageEmbedder)
    except ImportError:
        pass

    try:
        from graph_caster.rag.embeddings.jina_embed import JinaEmbedder
        reg.register(JinaEmbedder)
    except ImportError:
        pass

    try:
        from graph_caster.rag.embeddings.huggingface_embed import HuggingFaceEmbedder
        reg.register(HuggingFaceEmbedder)
    except ImportError:
        pass

    return reg


__all__ = [
    "Embedder",
    "ConfigError",
    "EmbedderRegistry",
    "EmbedCache",
    "HashEmbedder",
    "get_default_embedder_registry",
    "get_default_embed_cache",
]
