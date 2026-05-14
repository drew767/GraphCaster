# Copyright GraphCaster. All Rights Reserved.

"""F43 — Input-signature caching strategies (ComfyUI-style).

Three interchangeable strategies implement the ``CacheStrategy`` protocol:

- ``IdCacheStrategy``     — original behavior: key = node_id + canonical data.
- ``InputSignatureCacheStrategy`` — key = recursive hash of the full ancestor
  input signature, so outputs survive graph restructuring when data is equal.
- ``LRUCacheStrategy(max_entries, inner)`` — wraps any strategy with LRU
  eviction on the *in-process* get/put store (disk store is not evicted).

All strategies also support ``gcCacheControl.fingerprint`` in ``node_data``
(the GC equivalent of ComfyUI's ``IS_CHANGED`` / ``fingerprint_inputs``):
if present, its value is mixed into the key, so an explicit fingerprint
change forces a cache miss regardless of other inputs.

Usage::

    from graph_caster.cache_strategies import (
        IdCacheStrategy,
        InputSignatureCacheStrategy,
        LRUCacheStrategy,
        strategy_from_name,
    )

    strategy = strategy_from_name("input-signature")
    key = strategy.compute_key(node_id, node_data, upstream_outputs, doc_rev)
"""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
from typing import Any, Protocol, runtime_checkable

from graph_caster.node_output_cache import (
    node_data_for_cache_key,
    stable_json,
    upstream_step_cache_fingerprint,
)

__all__ = [
    "CacheStrategy",
    "IdCacheStrategy",
    "InputSignatureCacheStrategy",
    "LRUCacheStrategy",
    "strategy_from_name",
]

_FINGERPRINT_KEY = "gcCacheControl"


def _extract_gc_fingerprint(node_data: dict[str, Any]) -> str | None:
    """Return gcCacheControl.fingerprint from node_data, or None if absent."""
    ctrl = node_data.get(_FINGERPRINT_KEY)
    if not isinstance(ctrl, dict):
        return None
    fp = ctrl.get("fingerprint")
    if fp is None:
        return None
    return str(fp)


@runtime_checkable
class CacheStrategy(Protocol):
    """Protocol every cache strategy must satisfy."""

    def compute_key(
        self,
        node_id: str,
        node_data: dict[str, Any],
        upstream_outputs: dict[str, Any],
        document_revision: str,
    ) -> str:
        """Return a hex-encoded SHA-256 cache key string."""
        ...

    def get(self, key: str) -> Any | None:
        """Return a previously stored value, or None on miss."""
        ...

    def put(self, key: str, value: Any) -> None:
        """Store *value* under *key*."""
        ...


class IdCacheStrategy:
    """Preserve the original GC cache key semantics.

    Key = SHA-256 of {document_revision, node_id, canonical node_data,
    upstream_outputs_fingerprint}.  This is the same formula used by
    ``compute_step_cache_key`` minus graph_id and node_kind (those remain
    handled by the caller in ``node_output_cache``).

    The upstream_outputs fingerprint is *included* in this key, so different
    upstream results do produce different keys — consistent with the original
    implementation.  What makes it an "id" strategy is that the graph
    topology (which nodes are ancestors) is NOT hashed; only the final
    fingerprint of the immediate upstream snapshot is mixed in.

    If ``node_data`` contains ``gcCacheControl.fingerprint``, that value is
    also included in the key.
    """

    def __init__(self) -> None:
        self._store: dict[str, Any] = {}
        self._lock = threading.Lock()

    def compute_key(
        self,
        node_id: str,
        node_data: dict[str, Any],
        upstream_outputs: dict[str, Any],
        document_revision: str,
    ) -> str:
        clean_data = node_data_for_cache_key(node_data)
        up_fp = upstream_step_cache_fingerprint(upstream_outputs)
        payload: dict[str, Any] = {
            "gr": document_revision,
            "nid": node_id,
            "data": clean_data,
            "up_fp": up_fp,
        }
        gc_fp = _extract_gc_fingerprint(node_data)
        if gc_fp is not None:
            payload["gc_fp"] = gc_fp
        return hashlib.sha256(stable_json(payload).encode("utf-8")).hexdigest()

    def get(self, key: str) -> Any | None:
        with self._lock:
            return self._store.get(key)

    def put(self, key: str, value: Any) -> None:
        with self._lock:
            self._store[key] = value


class InputSignatureCacheStrategy:
    """ComfyUI-style input-signature cache key.

    The key is a SHA-256 of the *full ancestor signature*: for each ancestor
    (including the node itself) we hash its data together with a structural
    position token derived from sorted ancestor traversal order.  This means
    two nodes that receive the same effective data produce the same key even
    if the graph is restructured (nodes inserted/deleted elsewhere).

    ``upstream_outputs`` is expected to be a dict mapping node_id → output
    dict (the same shape produced by the runner).  Ancestors are identified
    by the keys present in ``upstream_outputs`` and ordered deterministically
    (sorted by node_id string) so that graph restructuring that does not
    change data produces the same key.

    If ``node_data`` contains ``gcCacheControl.fingerprint``, that value is
    mixed into the root node's signature so an explicit fingerprint change
    forces a miss.
    """

    def __init__(self) -> None:
        self._store: dict[str, Any] = {}
        self._lock = threading.Lock()

    def compute_key(
        self,
        node_id: str,
        node_data: dict[str, Any],
        upstream_outputs: dict[str, Any],
        document_revision: str,
    ) -> str:
        clean_data = node_data_for_cache_key(node_data)
        gc_fp = _extract_gc_fingerprint(node_data)

        # Build root node signature.
        root_sig: dict[str, Any] = {
            "gr": document_revision,
            "nid": node_id,
            "data": clean_data,
        }
        if gc_fp is not None:
            root_sig["gc_fp"] = gc_fp

        # Build sorted ancestor signatures.  Each ancestor contributes its
        # node_id (as a stable position token) and its canonical output blob.
        ancestor_sigs: list[dict[str, Any]] = []
        for anc_id in sorted(upstream_outputs.keys()):
            anc_out = upstream_outputs[anc_id]
            ancestor_sigs.append(
                {
                    "anc": anc_id,
                    "out": anc_out,
                }
            )

        combined: dict[str, Any] = {
            "root": root_sig,
            "ancestors": ancestor_sigs,
        }
        return hashlib.sha256(stable_json(combined).encode("utf-8")).hexdigest()

    def get(self, key: str) -> Any | None:
        with self._lock:
            return self._store.get(key)

    def put(self, key: str, value: Any) -> None:
        with self._lock:
            self._store[key] = value


class LRUCacheStrategy:
    """Wraps any ``CacheStrategy`` with an in-process LRU eviction layer.

    ``max_entries`` controls how many distinct keys the in-process store
    retains.  The oldest entry (by last access) is evicted when a new key
    would exceed the limit.  The underlying ``inner`` strategy's ``get``/
    ``put`` are *not* called through this wrapper; they remain independent
    (useful if the inner strategy also manages a disk store).

    ``compute_key`` is delegated unchanged to *inner*.
    """

    def __init__(self, max_entries: int, inner: CacheStrategy) -> None:
        if max_entries < 1:
            raise ValueError(f"max_entries must be >= 1, got {max_entries}")
        self._max = max_entries
        self._inner = inner
        self._lru: OrderedDict[str, Any] = OrderedDict()
        self._lock = threading.Lock()

    def compute_key(
        self,
        node_id: str,
        node_data: dict[str, Any],
        upstream_outputs: dict[str, Any],
        document_revision: str,
    ) -> str:
        return self._inner.compute_key(node_id, node_data, upstream_outputs, document_revision)

    def get(self, key: str) -> Any | None:
        with self._lock:
            if key not in self._lru:
                return None
            self._lru.move_to_end(key)
            return self._lru[key]

    def put(self, key: str, value: Any) -> None:
        with self._lock:
            if key in self._lru:
                self._lru.move_to_end(key)
            else:
                if len(self._lru) >= self._max:
                    self._lru.popitem(last=False)
            self._lru[key] = value


def strategy_from_name(
    name: str,
    *,
    lru_max: int = 1024,
) -> CacheStrategy:
    """Factory: ``"id"``, ``"input-signature"``, or ``"lru"``.

    ``"lru"`` wraps ``IdCacheStrategy`` with ``LRUCacheStrategy(lru_max)``.
    """
    if name == "id":
        return IdCacheStrategy()
    if name == "input-signature":
        return InputSignatureCacheStrategy()
    if name == "lru":
        return LRUCacheStrategy(lru_max, IdCacheStrategy())
    raise ValueError(f"Unknown cache strategy: {name!r}. Choose 'id', 'input-signature', or 'lru'.")
