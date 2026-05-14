# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar


class ConfigError(ValueError):
    """Raised when a required config value (e.g. API key) is missing."""


class Embedder(ABC):
    name: ClassVar[str]
    dim: ClassVar[int]

    @abstractmethod
    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Return one embedding vector per text."""

    async def embed_text(self, text: str) -> list[float]:
        result = await self.embed_texts([text])
        return result[0]
