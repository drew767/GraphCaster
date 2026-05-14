# Copyright GraphCaster. All Rights Reserved.

"""Loader for the unified node-types catalog at ``schemas/node-types.json``.

The catalog is the single source of truth for node-type metadata shared by the
Python runner and the TypeScript UI. Drift between Python's ``node_registry``
and the UI's ``nodeKinds.ts`` is detected by
``python/tests/test_node_types_catalog.py`` and
``ui/src/graph/nodeTypesCatalog.test.ts``.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

__all__ = [
    "NodeTypeInfo",
    "load_node_types_catalog",
    "is_idempotent",
    "supports_step_cache",
    "get_catalog_path",
]


@dataclass(frozen=True)
class NodeTypeInfo:
    """Metadata for a single node type drawn from ``schemas/node-types.json``."""

    type: str
    title: str
    category: str
    supports_step_cache: bool
    is_idempotent: bool
    implemented_in: frozenset[str]
    drift: str | None = None

    @property
    def implemented_in_python(self) -> bool:
        return "python" in self.implemented_in

    @property
    def implemented_in_ui(self) -> bool:
        return "ui" in self.implemented_in


def get_catalog_path() -> Path:
    """Return the absolute path to ``schemas/node-types.json``.

    Walks up from this module's location to find the repo's ``schemas`` directory.
    """
    here = Path(__file__).resolve()
    # python/graph_caster/node_types_catalog.py -> repo root is parents[2]
    repo_root = here.parents[2]
    return repo_root / "schemas" / "node-types.json"


@lru_cache(maxsize=1)
def load_node_types_catalog() -> dict[str, NodeTypeInfo]:
    """Return the catalog as a dict keyed by node-type string.

    Result is memoised; call ``load_node_types_catalog.cache_clear()`` in tests
    after mutating the JSON.
    """
    path = get_catalog_path()
    with path.open("r", encoding="utf-8") as fh:
        raw = json.load(fh)
    entries: list[dict] = list(raw.get("nodeTypes", []))
    out: dict[str, NodeTypeInfo] = {}
    for entry in entries:
        type_name = str(entry["type"])
        out[type_name] = NodeTypeInfo(
            type=type_name,
            title=str(entry.get("title", type_name)),
            category=str(entry.get("category", "core")),
            supports_step_cache=bool(entry.get("supportsStepCache", False)),
            is_idempotent=bool(entry.get("isIdempotent", False)),
            implemented_in=frozenset(
                str(x) for x in entry.get("implementedIn", [])
            ),
            drift=(str(entry["drift"]) if entry.get("drift") else None),
        )
    return out


def is_idempotent(node_type: str) -> bool:
    """Return ``True`` if *node_type* is marked idempotent in the catalog.

    Unknown types default to ``False`` (the safe choice for replay guards).
    """
    info = load_node_types_catalog().get(node_type)
    return bool(info and info.is_idempotent)


def supports_step_cache(node_type: str) -> bool:
    """Return ``True`` if *node_type* may be cached by the step-cache layer.

    Unknown types default to ``False``.
    """
    info = load_node_types_catalog().get(node_type)
    return bool(info and info.supports_step_cache)
