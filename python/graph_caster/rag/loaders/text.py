# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from pathlib import Path
from typing import AsyncIterator

from graph_caster.rag.loaders.base import Document, DocumentLoader


class TextLoader(DocumentLoader):
    """Load a plain-text or Markdown file as a single Document."""

    def __init__(self, path: str | Path, *, encoding: str = "utf-8") -> None:
        self._path = Path(path)
        self._encoding = encoding

    async def load(self) -> list[Document]:
        return [doc async for doc in self.lazy_load()]

    async def lazy_load(self) -> AsyncIterator[Document]:
        text = self._path.read_text(encoding=self._encoding)
        yield Document(
            page_content=text,
            metadata={"source": str(self._path), "encoding": self._encoding},
        )
