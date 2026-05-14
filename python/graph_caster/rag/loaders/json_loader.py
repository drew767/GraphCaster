# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, AsyncIterator

from graph_caster.rag.loaders.base import Document, DocumentLoader


def _apply_jq(data: Any, jq_schema: str) -> Any:
    """Apply a trivial jq-style path like ``.key`` or ``.key.subkey``."""
    if not jq_schema or jq_schema.strip() == ".":
        return data
    parts = jq_schema.lstrip(".").split(".")
    result = data
    for part in parts:
        if not part:
            continue
        if isinstance(result, dict):
            result = result.get(part)
        else:
            result = None
            break
    return result


class JsonLoader(DocumentLoader):
    """Load a ``.json`` or ``.jsonl`` file.

    - ``.jsonl`` (one JSON object per line): one Document per non-empty line.
    - ``.json`` with a list at root (or after ``jq_schema``): one Document per element.
    - ``.json`` with a non-list root: one Document for the whole content.

    Parameters
    ----------
    path:
        Path to the file.
    jq_schema:
        A simple dot-path selector applied to each loaded JSON object before
        wrapping in a Document, e.g. ``".body"`` extracts ``obj["body"]``.
        Only supports ``.<key>.<subkey>`` style (no arrays, pipes, or filters).
    """

    def __init__(self, path: str | Path, *, jq_schema: str | None = None) -> None:
        self._path = Path(path)
        self._jq_schema = jq_schema

    def _make_doc(self, data: Any, source: str, idx: int | None = None) -> Document:
        selected = _apply_jq(data, self._jq_schema or ".")
        if isinstance(selected, str):
            content = selected
        else:
            content = json.dumps(selected, ensure_ascii=False)
        meta: dict[str, Any] = {"source": source, "path": self._jq_schema or "."}
        if idx is not None:
            meta["index"] = idx
        return Document(page_content=content, metadata=meta)

    async def load(self) -> list[Document]:
        return [doc async for doc in self.lazy_load()]

    async def lazy_load(self) -> AsyncIterator[Document]:
        source = str(self._path)
        suffix = self._path.suffix.lower()

        if suffix == ".jsonl":
            for line_idx, line in enumerate(
                self._path.read_text(encoding="utf-8").splitlines()
            ):
                line = line.strip()
                if not line:
                    continue
                data = json.loads(line)
                yield self._make_doc(data, source, line_idx)
        else:
            data = json.loads(self._path.read_text(encoding="utf-8"))
            if isinstance(data, list):
                for idx, item in enumerate(data):
                    yield self._make_doc(item, source, idx)
            else:
                yield self._make_doc(data, source)
