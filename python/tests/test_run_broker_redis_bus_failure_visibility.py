# Copyright GraphCaster. All Rights Reserved.

"""Failure-visibility tests for ``run_broker_redis_bus`` — OSError logging + counter (P1)."""

from __future__ import annotations

import logging

import pytest

from graph_caster.run_broker_redis_bus import (
    RedisEventBus,
    get_redis_relay_failure_count,
    reset_event_bus,
)

pytestmark = pytest.mark.anyio


@pytest.fixture(autouse=True)
def _reset_metrics() -> None:
    reset_event_bus()
    yield
    reset_event_bus()


def _make_failing_bus(exc_factory) -> RedisEventBus:
    bus = RedisEventBus.__new__(RedisEventBus)
    bus._url = "redis://localhost/0"
    bus._prefix = "gc:events"
    bus._ttl = 3600
    bus._closed = False

    class _FailingClient:
        async def publish(self, *a, **kw):
            raise exc_factory()

        async def xadd(self, *a, **kw):
            raise exc_factory()

        async def expire(self, *a, **kw):
            raise exc_factory()

        async def aclose(self):
            pass

    bus._pub_client = _FailingClient()
    bus._new_sub_client = lambda: _FailingClient()
    return bus


async def test_oserror_increments_relay_failure_counter(monkeypatch: pytest.MonkeyPatch) -> None:
    """An ``OSError`` from Redis publish increments the relay-failure counter."""
    # Patch sleep so the retry path is fast.
    import graph_caster.run_broker_redis_bus as bus_mod
    import asyncio as _asyncio

    async def _fast_sleep(_s: float) -> None:
        return None

    monkeypatch.setattr(_asyncio, "sleep", _fast_sleep)

    bus = _make_failing_bus(lambda: OSError("connection refused"))

    before = get_redis_relay_failure_count()
    await bus.publish("run-osfail", {"type": "x"})
    after = get_redis_relay_failure_count()
    assert after == before + 1


async def test_oserror_logs_warn_with_structured_payload(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """The WARN log carries the ``run_id`` and ``error_class`` in extras."""
    import asyncio as _asyncio

    async def _fast_sleep(_s: float) -> None:
        return None

    monkeypatch.setattr(_asyncio, "sleep", _fast_sleep)

    bus = _make_failing_bus(lambda: ConnectionRefusedError("nope"))

    caplog.set_level(logging.WARNING, logger="graph_caster.run_broker_redis_bus")
    await bus.publish("run-warn-001", {"type": "x"})

    relay_records = [r for r in caplog.records if "redis_bus_relay_fanout_failed" in r.getMessage()]
    assert len(relay_records) >= 1
    rec = relay_records[0]
    # Structured extras flatten to attributes on the LogRecord.
    assert getattr(rec, "run_id", None) == "run-warn-001"
    assert getattr(rec, "error_class", None) == "ConnectionRefusedError"


async def test_non_oserror_does_not_increment_relay_counter(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Non-OSError exceptions go through ``record_publish_error`` only, not the relay counter."""
    import asyncio as _asyncio

    async def _fast_sleep(_s: float) -> None:
        return None

    monkeypatch.setattr(_asyncio, "sleep", _fast_sleep)

    bus = _make_failing_bus(lambda: ValueError("not an os-level error"))

    before = get_redis_relay_failure_count()
    await bus.publish("run-non-os", {"type": "x"})
    assert get_redis_relay_failure_count() == before


async def test_retry_three_times_then_record(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The publish path retries OSError up to 3 attempts before giving up + counting."""
    import asyncio as _asyncio

    sleeps: list[float] = []

    async def _record_sleep(s: float) -> None:
        sleeps.append(s)

    monkeypatch.setattr(_asyncio, "sleep", _record_sleep)

    attempts = 0

    class _CountingClient:
        async def publish(self, *a, **kw):
            nonlocal attempts
            attempts += 1
            raise OSError("simulated")

        async def xadd(self, *a, **kw):
            raise OSError("never reached on first failure")

        async def expire(self, *a, **kw):
            raise OSError("never reached on first failure")

        async def aclose(self):
            pass

    bus = RedisEventBus.__new__(RedisEventBus)
    bus._url = "redis://localhost/0"
    bus._prefix = "gc:events"
    bus._ttl = 3600
    bus._closed = False
    bus._pub_client = _CountingClient()
    bus._new_sub_client = lambda: _CountingClient()

    await bus.publish("run-retry", {"type": "x"})

    # 3 attempts total with 2 backoff sleeps between them.
    assert attempts == 3
    assert sleeps == [0.1, 0.5]
    assert get_redis_relay_failure_count() == 1
