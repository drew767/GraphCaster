# Copyright Aura. All Rights Reserved.

"""Tests for WebSocket heartbeat manager."""

from __future__ import annotations

import asyncio

import pytest

from graph_caster.run_broker.heartbeat import HeartbeatManager


@pytest.mark.anyio
async def test_heartbeat_sends_pings_at_interval() -> None:
    """Heartbeat sends pings at configured interval."""
    ping_count = 0

    async def mock_ping() -> None:
        nonlocal ping_count
        ping_count += 1

    hb = HeartbeatManager(interval_sec=0.05, send_ping=mock_ping)
    await hb.start()
    await asyncio.sleep(0.18)
    await hb.stop()

    assert ping_count >= 3, f"Expected at least 3 pings, got {ping_count}"


@pytest.mark.anyio
async def test_heartbeat_stops_cleanly() -> None:
    """Heartbeat stops cleanly on stop()."""
    ping_count = 0

    async def mock_ping() -> None:
        nonlocal ping_count
        ping_count += 1

    hb = HeartbeatManager(interval_sec=0.05, send_ping=mock_ping)
    await hb.start()
    await asyncio.sleep(0.08)
    await hb.stop()

    count_at_stop = ping_count
    await asyncio.sleep(0.1)

    assert ping_count == count_at_stop, "Pings continued after stop"
    assert hb._task is None, "Task should be None after stop"


@pytest.mark.anyio
async def test_heartbeat_handles_send_errors_gracefully() -> None:
    """Heartbeat handles send errors gracefully and continues."""
    ping_count = 0
    error_count = 0

    async def failing_ping() -> None:
        nonlocal ping_count, error_count
        ping_count += 1
        if ping_count <= 2:
            error_count += 1
            raise RuntimeError("Simulated ping failure")

    hb = HeartbeatManager(interval_sec=0.03, send_ping=failing_ping)
    await hb.start()
    await asyncio.sleep(0.15)
    await hb.stop()

    assert ping_count >= 4, f"Expected at least 4 ping attempts, got {ping_count}"
    assert error_count == 2, f"Expected 2 errors, got {error_count}"


@pytest.mark.anyio
async def test_heartbeat_no_send_ping_provided() -> None:
    """Heartbeat works when no send_ping callback is provided."""
    hb = HeartbeatManager(interval_sec=0.03)
    await hb.start()
    await asyncio.sleep(0.1)
    await hb.stop()

    assert hb._task is None


@pytest.mark.anyio
async def test_heartbeat_start_is_idempotent() -> None:
    """Calling start() multiple times doesn't create multiple tasks."""
    ping_count = 0

    async def mock_ping() -> None:
        nonlocal ping_count
        ping_count += 1

    hb = HeartbeatManager(interval_sec=0.05, send_ping=mock_ping)
    await hb.start()
    task1 = hb._task
    await hb.start()
    task2 = hb._task

    assert task1 is task2, "start() should be idempotent"

    await hb.stop()


@pytest.mark.anyio
async def test_heartbeat_stop_when_not_started() -> None:
    """Calling stop() when not started is a no-op."""
    hb = HeartbeatManager(interval_sec=0.05)
    await hb.stop()
    assert hb._task is None
