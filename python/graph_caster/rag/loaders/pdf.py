# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from pathlib import Path
from typing import AsyncIterator

from graph_caster.rag.loaders.base import Document, DocumentLoader


class PdfLoader(DocumentLoader):
    """Load a PDF file — one Document per page.

    Requires the optional ``rag-loaders-pdf`` extra::

        pip install "graph-caster[rag-loaders-pdf]"
    """

    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)

    def _get_reader(self):
        try:
            from pypdf import PdfReader  # type: ignore[import-untyped]
        except ImportError as exc:
            raise ImportError(
                "pypdf is required for PdfLoader. "
                'Install it with: pip install "graph-caster[rag-loaders-pdf]"'
            ) from exc
        return PdfReader(str(self._path))

    async def load(self) -> list[Document]:
        return [doc async for doc in self.lazy_load()]

    async def lazy_load(self) -> AsyncIterator[Document]:
        reader = self._get_reader()
        total = len(reader.pages)
        source = str(self._path)
        for page_num, page in enumerate(reader.pages, start=1):
            text = page.extract_text() or ""
            yield Document(
                page_content=text,
                metadata={"source": source, "page": page_num, "total_pages": total},
            )
