# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import csv
import io
from pathlib import Path
from typing import AsyncIterator

from graph_caster.rag.loaders.base import Document, DocumentLoader


class CsvLoader(DocumentLoader):
    """Load a CSV file — one Document per row.

    Parameters
    ----------
    path:
        Path to the CSV file.
    encoding:
        File encoding (default: ``utf-8``).
    source_column:
        If given, ``page_content`` is set to the value of that column only.
        Otherwise all column values are joined with a comma.
    """

    def __init__(
        self,
        path: str | Path,
        *,
        encoding: str = "utf-8",
        source_column: str | None = None,
    ) -> None:
        self._path = Path(path)
        self._encoding = encoding
        self._source_column = source_column

    async def load(self) -> list[Document]:
        return [doc async for doc in self.lazy_load()]

    async def lazy_load(self) -> AsyncIterator[Document]:
        source = str(self._path)
        raw = self._path.read_text(encoding=self._encoding)
        reader = csv.DictReader(io.StringIO(raw))
        columns: list[str] = list(reader.fieldnames or [])
        for row_idx, row in enumerate(reader):
            if self._source_column and self._source_column in row:
                content = row[self._source_column]
            else:
                content = ", ".join(row.values())
            yield Document(
                page_content=content,
                metadata={"source": source, "row_idx": row_idx, "columns": columns},
            )
