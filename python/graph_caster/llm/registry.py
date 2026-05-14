# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.llm.provider import ModelProvider


class ProviderRegistry:
    """Singleton-style registry mapping provider names to ModelProvider instances."""

    def __init__(self) -> None:
        self._providers: dict[str, ModelProvider] = {}

    def register(self, provider: ModelProvider) -> None:
        self._providers[provider.name] = provider

    def get(self, name: str) -> ModelProvider:
        try:
            return self._providers[name]
        except KeyError:
            available = ", ".join(self._providers) or "<none>"
            raise KeyError(f"Provider {name!r} not registered. Available: {available}") from None

    def list_providers(self) -> list[str]:
        return list(self._providers)

    def unregister(self, name: str) -> None:
        self._providers.pop(name, None)

    def clear(self) -> None:
        self._providers.clear()


_default_registry = ProviderRegistry()


def get_default_registry() -> ProviderRegistry:
    return _default_registry
