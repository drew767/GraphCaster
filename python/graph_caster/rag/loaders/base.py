# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator


@dataclass
class Document:
    page_content: str
    metadata: dict[str, Any] = field(default_factory=dict)


class DocumentLoader(ABC):
    @abstractmethod
    async def load(self) -> list[Document]:
        """Load all documents eagerly."""
        raise NotImplementedError

    @abstractmethod
    async def lazy_load(self) -> AsyncIterator[Document]:
        """Load documents one at a time (preferred for large inputs)."""
        raise NotImplementedError
