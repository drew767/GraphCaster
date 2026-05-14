# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import hashlib
import os
from collections import OrderedDict
from typing import Optional


def _default_max_entries() -> int:
    try:
        return int(os.environ.get("GC_EMBED_CACHE_MAX_ENTRIES") or "10000")
    except ValueError:
        return 10000


def _cache_enabled() -> bool:
    return (os.environ.get("GC_EMBED_CACHE") or "on").strip().lower() != "off"


class EmbedCache:
    """In-process LRU cache keyed by (provider, model, text_hash)."""

    def __init__(self, max_entries: int = 10_000) -> None:
        self._max = max_entries
        self._store: OrderedDict[tuple[str, str, str], list[float]] = OrderedDict()

    @staticmethod
    def _key(provider: str, model: str, text: str) -> tuple[str, str, str]:
        h = hashlib.sha256(text.encode("utf-8")).hexdigest()
        return (provider, model, h)

    def get(self, provider: str, model: str, text: str) -> Optional[list[float]]:
        if not _cache_enabled():
            return None
        k = self._key(provider, model, text)
        if k not in self._store:
            return None
        self._store.move_to_end(k)
        return self._store[k]

    def put(self, provider: str, model: str, text: str, vec: list[float]) -> None:
        if not _cache_enabled():
            return
        k = self._key(provider, model, text)
        self._store[k] = vec
        self._store.move_to_end(k)
        while len(self._store) > self._max:
            self._store.popitem(last=False)

    def clear(self) -> None:
        self._store.clear()

    def __len__(self) -> int:
        return len(self._store)


_DEFAULT_CACHE: EmbedCache | None = None


def get_default_embed_cache() -> EmbedCache:
    global _DEFAULT_CACHE
    if _DEFAULT_CACHE is None:
        _DEFAULT_CACHE = EmbedCache(max_entries=_default_max_entries())
    return _DEFAULT_CACHE
