# Copyright Aura. All Rights Reserved.

"""Cross-process / cross-host **slot** coordination for worker pools (optional Redis)."""

from __future__ import annotations

import logging
import os
import threading
import time
import uuid
from abc import ABC, abstractmethod
from typing import Any

from graph_caster.execution.redis_lock import redis_release_lock_if_token, redis_try_acquire_lock

_LOG = logging.getLogger(__name__)


class WorkerCoordinator(ABC):
    """Lease a named **slot** with TTL; holder must :meth:`release_slot` with the returned token."""

    @abstractmethod
    def acquire_slot(self, slot_id: str, *, ttl_sec: int = 300) -> str | None:
        """
        Try to take **slot_id**. Returns an opaque **token** if acquired, else ``None``.
        The same **slot_id** cannot be held twice until released or TTL expires.
        """

    @abstractmethod
    def release_slot(self, slot_id: str, token: str) -> None:
        """Release **slot_id** only if **token** matches the lease (no-op if mismatch / missing)."""

    @abstractmethod
    def get_active_count(self) -> int:
        """Number of slots currently held (best-effort for Redis after TTL expiry)."""


class InMemoryWorkerCoordinator(WorkerCoordinator):
    """Process-local coordinator (development / single-host)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        # slot_id -> (token, expiry monotonic)
        self._leases: dict[str, tuple[str, float]] = {}

    def _purge_unlocked(self, now: float) -> None:
        dead = [k for k, (_, exp) in self._leases.items() if exp <= now]
        for k in dead:
            del self._leases[k]

    def acquire_slot(self, slot_id: str, *, ttl_sec: int = 300) -> str | None:
        if not slot_id.strip():
            raise ValueError("slot_id required")
        if ttl_sec < 1:
            raise ValueError("ttl_sec must be >= 1")
        now = time.monotonic()
        token = str(uuid.uuid4())
        with self._lock:
            self._purge_unlocked(now)
            if slot_id in self._leases:
                return None
            self._leases[slot_id] = (token, now + float(ttl_sec))
            return token

    def release_slot(self, slot_id: str, token: str) -> None:
        with self._lock:
            row = self._leases.get(slot_id)
            if row is None:
                return
            held_tok, _ = row
            if held_tok == token:
                del self._leases[slot_id]

    def get_active_count(self) -> int:
        now = time.monotonic()
        with self._lock:
            self._purge_unlocked(now)
            return len(self._leases)


class RedisWorkerCoordinator(WorkerCoordinator):
    """
    Redis **SET NX EX** per slot. Requires ``pip install redis`` and a reachable server.
    Each slot is stored under ``{key_prefix}slot:{slot_id}``.
    """

    def __init__(
        self,
        redis_url: str | None = None,
        *,
        key_prefix: str = "graph_caster:worker_coord:",
        client: Any | None = None,
    ) -> None:
        try:
            import redis  # type: ignore[import-untyped]
        except ImportError as e:
            raise RuntimeError(
                "RedisWorkerCoordinator requires redis; pip install -e \".[redis]\""
            ) from e
        p = key_prefix.strip()
        if not p.endswith(":"):
            p = p + ":"
        self._prefix = p
        if client is not None:
            self._r = client
        else:
            if not (redis_url or "").strip():
                raise ValueError("redis_url required when client is not provided")
            self._r = redis.Redis.from_url(redis_url.strip(), decode_responses=True)

    def _key(self, slot_id: str) -> str:
        return f"{self._prefix}slot:{slot_id}"

    def acquire_slot(self, slot_id: str, *, ttl_sec: int = 300) -> str | None:
        if not slot_id.strip():
            raise ValueError("slot_id required")
        if ttl_sec < 1:
            raise ValueError("ttl_sec must be >= 1")
        token = str(uuid.uuid4())
        try:
            ok = redis_try_acquire_lock(self._r, self._key(slot_id), token, ttl_sec=int(ttl_sec))
        except Exception as e:
            _LOG.warning("RedisWorkerCoordinator.acquire_slot failed: %s", e)
            return None
        return token if ok else None

    def release_slot(self, slot_id: str, token: str) -> None:
        try:
            redis_release_lock_if_token(self._r, self._key(slot_id), token)
        except Exception:
            _LOG.debug("RedisWorkerCoordinator.release_slot failed", exc_info=True)

    def get_active_count(self) -> int:
        """Count existing slot keys under **key_prefix** (``SCAN``; ignores TTL staleness window)."""
        pattern = f"{self._prefix}slot:*"
        n = 0
        try:
            for _k in self._r.scan_iter(match=pattern, count=64):
                n += 1
        except Exception as e:
            _LOG.warning("RedisWorkerCoordinator.get_active_count failed: %s", e)
            return 0
        return n


def worker_coordinator_from_env(redis_url: str | None = None) -> WorkerCoordinator:
    """
    **InMemory** when no URL; else :class:`RedisWorkerCoordinator`.

    URL order: **redis_url** argument, then env **``GC_WORKER_COORDINATOR_REDIS_URL``**.
    """
    u = (redis_url if redis_url is not None else os.environ.get("GC_WORKER_COORDINATOR_REDIS_URL", ""))
    u = str(u).strip()
    if not u:
        return InMemoryWorkerCoordinator()
    return RedisWorkerCoordinator(u)
