# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import threading
import time
from collections.abc import Iterator
from unittest.mock import patch

import pytest

from graph_caster.execution.redis_lock import redis_release_lock_if_token, redis_try_acquire_lock
from graph_caster.execution.worker_coordinator import (
    InMemoryWorkerCoordinator,
    RedisWorkerCoordinator,
    worker_coordinator_from_env,
)
from graph_caster.execution.worker_pool import WorkerPool


class _FakeRedis:
    """Minimal redis-py subset for coordinator tests (decode_responses string values)."""

    def __init__(self) -> None:
        self.kv: dict[str, str] = {}

    def set(self, name: str, value: str, nx: bool = False, ex: int | None = None) -> bool | None:
        if nx and name in self.kv:
            return None
        self.kv[name] = value
        return True

    def eval(self, script: str, numkeys: int, key: str, arg: str) -> int:
        if self.kv.get(key) == arg:
            del self.kv[key]
            return 1
        return 0

    def scan_iter(self, match: str, count: int = 64) -> Iterator[str]:
        base = match[:-1] if match.endswith("*") else match
        for k in self.kv:
            if k.startswith(base):
                yield k


def test_in_memory_acquire_release_and_count() -> None:
    c = InMemoryWorkerCoordinator()
    t1 = c.acquire_slot("a", ttl_sec=60)
    assert t1 is not None
    assert c.get_active_count() == 1
    assert c.acquire_slot("a", ttl_sec=60) is None
    c.release_slot("a", t1)
    assert c.get_active_count() == 0
    t2 = c.acquire_slot("a", ttl_sec=60)
    assert t2 is not None


def test_in_memory_release_wrong_token_no_effect() -> None:
    c = InMemoryWorkerCoordinator()
    tok = c.acquire_slot("x", ttl_sec=60)
    assert tok is not None
    c.release_slot("x", "wrong")
    assert c.get_active_count() == 1


def test_redis_coordinator_with_fake_client() -> None:
    fake = _FakeRedis()
    c = RedisWorkerCoordinator(client=fake, key_prefix="t:coord:")
    t = c.acquire_slot("slot1", ttl_sec=30)
    assert t is not None
    assert c.acquire_slot("slot1", ttl_sec=30) is None
    assert c.get_active_count() == 1
    c.release_slot("slot1", t)
    assert c.get_active_count() == 0


def test_worker_coordinator_from_env_in_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_WORKER_COORDINATOR_REDIS_URL", raising=False)
    c = worker_coordinator_from_env("")
    assert isinstance(c, InMemoryWorkerCoordinator)


def test_worker_coordinator_from_env_uses_env(monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("redis")
    fake = _FakeRedis()
    monkeypatch.setenv("GC_WORKER_COORDINATOR_REDIS_URL", "redis://127.0.0.1:6379/0")
    with patch("redis.Redis.from_url", return_value=fake):
        c = worker_coordinator_from_env()
    assert isinstance(c, RedisWorkerCoordinator)
    assert c.acquire_slot("z1", ttl_sec=10) is not None


def test_redis_try_acquire_and_release() -> None:
    r = _FakeRedis()
    assert redis_try_acquire_lock(r, "k1", "tok", ttl_sec=10) is True
    assert redis_try_acquire_lock(r, "k1", "other", ttl_sec=10) is False
    assert redis_release_lock_if_token(r, "k1", "tok") is True
    assert redis_release_lock_if_token(r, "k1", "tok") is False


def test_worker_pool_with_coordinator_blocks_same_task_id_until_done() -> None:
    coord = InMemoryWorkerCoordinator()
    pool = WorkerPool(2, slot_coordinator=coord, coordinator_slot_ttl_sec=120)
    done = threading.Event()

    def block_until() -> None:
        assert done.wait(timeout=10.0)

    pool.start()
    pool.submit("same", block_until)
    time.sleep(0.05)
    assert coord.get_active_count() == 1
    with pytest.raises(RuntimeError, match="coordinator slot acquire failed"):
        pool.submit("same", lambda: None)
    done.set()
    pool.wait_all()
    assert coord.get_active_count() == 0
    pool.stop()
