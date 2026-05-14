# Copyright GraphCaster. All Rights Reserved.

"""F78 Templates marketplace — catalog, listing, and instantiation."""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class TemplateMeta:
    id: str
    title: str
    description: str
    badge: str | None
    frameworks: list[str]
    usecases: list[str]
    author: str
    tags: list[str]
    preview_image: str | None


def _parse_meta(doc: dict[str, Any]) -> TemplateMeta | None:
    """Extract TemplateMeta from a marketplace graph document. Returns None if invalid."""
    meta = doc.get("meta")
    if not isinstance(meta, dict):
        return None
    graph_id = meta.get("graphId")
    if not graph_id:
        return None
    mp = meta.get("marketplace")
    if not isinstance(mp, dict):
        return None
    return TemplateMeta(
        id=str(graph_id),
        title=str(meta.get("title") or graph_id),
        description=str(meta.get("description") or mp.get("description") or ""),
        badge=mp.get("badge") or None,
        frameworks=list(mp.get("frameworks") or []),
        usecases=list(mp.get("usecases") or []),
        author=str(mp.get("author") or ""),
        tags=list(mp.get("tags") or []),
        preview_image=mp.get("preview_image") or None,
    )


class MarketplaceCatalog:
    """Loads and serves marketplace templates from a directory of JSON files."""

    def __init__(self, marketplace_dir: Path) -> None:
        self._dir = marketplace_dir

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load_all(self) -> list[tuple[TemplateMeta, dict[str, Any]]]:
        """Load all valid marketplace templates. Returns (meta, doc) pairs."""
        if not self._dir.is_dir():
            return []
        results: list[tuple[TemplateMeta, dict[str, Any]]] = []
        for path in sorted(self._dir.glob("*.json")):
            try:
                doc = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if not isinstance(doc, dict):
                continue
            meta = _parse_meta(doc)
            if meta is None:
                continue
            results.append((meta, doc))
        return results

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def list(
        self,
        *,
        framework: str | None = None,
        usecase: str | None = None,
        tag: str | None = None,
    ) -> list[TemplateMeta]:
        """Return filtered list of TemplateMeta objects."""
        items = self._load_all()
        out: list[TemplateMeta] = []
        for meta, _doc in items:
            if framework and framework.lower() not in [f.lower() for f in meta.frameworks]:
                continue
            if usecase and usecase.lower() not in [u.lower() for u in meta.usecases]:
                continue
            if tag and tag.lower() not in [t.lower() for t in meta.tags]:
                continue
            out.append(meta)
        return out

    async def get(self, template_id: str) -> dict[str, Any] | None:
        """Return the full graph JSON for the given template id, or None."""
        if not template_id or ".." in template_id or "/" in template_id or "\\" in template_id:
            return None
        path = self._dir / f"{template_id}.json"
        if not path.is_file():
            return None
        try:
            doc = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None
        if not isinstance(doc, dict):
            return None
        # Verify it's actually a marketplace template
        if _parse_meta(doc) is None:
            return None
        return doc

    async def instantiate(
        self, template_id: str, target_graph_id: str, target_dir: Path
    ) -> Path:
        """Copy template to target_dir/<target_graph_id>.json with updated graphId in meta.

        Returns the path of the new graph file.
        Raises FileNotFoundError if template_id does not exist.
        Raises ValueError if target_graph_id is unsafe.
        """
        if not target_graph_id or ".." in target_graph_id or "/" in target_graph_id or "\\" in target_graph_id:
            raise ValueError(f"Unsafe target_graph_id: {target_graph_id!r}")

        doc = await self.get(template_id)
        if doc is None:
            raise FileNotFoundError(f"Template not found: {template_id!r}")

        # Deep-copy and update graphId in meta
        import copy
        new_doc = copy.deepcopy(doc)
        meta = new_doc.setdefault("meta", {})
        meta["graphId"] = target_graph_id

        target_dir.mkdir(parents=True, exist_ok=True)
        target_path = target_dir / f"{target_graph_id}.json"
        target_path.write_text(
            json.dumps(new_doc, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return target_path
