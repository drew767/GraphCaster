# Copyright GraphCaster. All Rights Reserved.

"""Tests for run_broker.watcher.WatcherRunner."""

from __future__ import annotations

import asyncio
import pytest

from graph_caster.run_broker.watcher import TriggerEvent, Watcher, WatcherRunner


class _StubWatcher:
    """Watcher stub that emits a fixed event list across a few ticks."""

    poll_interval_seconds = 0.0  # tight loop for tests

    def __init__(self, batches: list[list[TriggerEvent]]) -> None:
        self._batches = batches
        self.reload_calls = 0
        self.tick_calls = 0

    async def reload(self) -> None:
        self.reload_calls += 1

    async def tick(self) -> list[TriggerEvent]:
        i = self.tick_calls
        self.tick_calls += 1
        if i >= len(self._batches):
            return []
        return self._batches[i]


def test_protocol_isinstance_holds_for_stub() -> None:
    w = _StubWatcher([])
    # runtime_checkable Protocol — should accept the stub.
    assert isinstance(w, Watcher)


@pytest.mark.anyio
async def test_runner_dispatches_each_event_until_stopped() -> None:
    dispatched: list[TriggerEvent] = []

    async def _dispatch(ev: TriggerEvent) -> None:
        dispatched.append(ev)

    runner = WatcherRunner(dispatch=_dispatch)
    watcher = _StubWatcher(
        batches=[
            [TriggerEvent(kind="poll", graph_id="g1", source_id="url-1")],
            [
                TriggerEvent(kind="poll", graph_id="g2", source_id="url-2"),
                TriggerEvent(kind="poll", graph_id="g3", source_id="url-3"),
            ],
        ]
    )

    async def _drive() -> None:
        await runner.run(watcher)

    task = asyncio.create_task(_drive())
    # Yield enough ticks for the runner to process both batches.
    for _ in range(10):
        await asyncio.sleep(0)
    runner.stop()
    await asyncio.wait_for(task, timeout=2.0)

    assert [ev.source_id for ev in dispatched] == ["url-1", "url-2", "url-3"]
    assert watcher.reload_calls >= 2  # initial + at least one post-tick reload


@pytest.mark.anyio
async def test_runner_skips_events_without_graph_id() -> None:
    dispatched: list[TriggerEvent] = []

    async def _dispatch(ev: TriggerEvent) -> None:
        dispatched.append(ev)

    runner = WatcherRunner(dispatch=_dispatch)
    watcher = _StubWatcher(
        batches=[
            [
                TriggerEvent(kind="poll", graph_id="", source_id="decline"),
                TriggerEvent(kind="poll", graph_id="g1", source_id="real"),
            ]
        ]
    )

    task = asyncio.create_task(runner.run(watcher))
    for _ in range(10):
        await asyncio.sleep(0)
    runner.stop()
    await asyncio.wait_for(task, timeout=2.0)

    assert [ev.source_id for ev in dispatched] == ["real"]


@pytest.mark.anyio
async def test_runner_survives_failing_dispatch() -> None:
    seen: list[str] = []
    boom_called = False

    async def _dispatch(ev: TriggerEvent) -> None:
        nonlocal boom_called
        if ev.source_id == "boom":
            boom_called = True
            raise RuntimeError("dispatch failure")
        seen.append(ev.source_id)

    runner = WatcherRunner(dispatch=_dispatch)
    watcher = _StubWatcher(
        batches=[
            [
                TriggerEvent(kind="poll", graph_id="g1", source_id="boom"),
                TriggerEvent(kind="poll", graph_id="g1", source_id="ok"),
            ]
        ]
    )

    task = asyncio.create_task(runner.run(watcher))
    for _ in range(10):
        await asyncio.sleep(0)
    runner.stop()
    await asyncio.wait_for(task, timeout=2.0)

    assert boom_called is True
    assert seen == ["ok"]


@pytest.mark.anyio
async def test_runner_survives_failing_tick() -> None:
    dispatched: list[TriggerEvent] = []

    async def _dispatch(ev: TriggerEvent) -> None:
        dispatched.append(ev)

    class _FlakyWatcher(_StubWatcher):
        async def tick(self) -> list[TriggerEvent]:
            i = self.tick_calls
            self.tick_calls += 1
            if i == 0:
                raise OSError("transient")
            return [TriggerEvent(kind="poll", graph_id="g1", source_id="after")]

    runner = WatcherRunner(dispatch=_dispatch)
    watcher = _FlakyWatcher([])

    task = asyncio.create_task(runner.run(watcher))
    for _ in range(10):
        await asyncio.sleep(0)
    runner.stop()
    await asyncio.wait_for(task, timeout=2.0)

    assert any(ev.source_id == "after" for ev in dispatched)


# pytest-anyio fixture: prefer asyncio backend (anyio default in this project).
@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
