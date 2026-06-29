# Copyright GraphCaster. All Rights Reserved.

"""Common ``Watcher`` Protocol + driver for trigger-source brokers.

The audit found five run-broker variants (poll URLs, FS watch, Redis bus, cron
scheduler, subprocess registry) each shipping its own bespoke ``async def
run()`` loop. The loops share the same shape: reload config → poll/wait for
events → dispatch each → sleep. This module factors that loop into a single
``WatcherRunner`` driving any object that satisfies ``Watcher``.

New broker sources implement the three-method protocol; existing brokers can
migrate incrementally — until then they coexist with their own loops.

MUST NOT
--------
* Import any concrete broker implementation (poller/fs/redis/scheduler).
  Those modules import *this*, not the other way around.
* Touch the run sink directly. Dispatch is handed off via the
  ``dispatch_fn`` callback.
* Spin a thread or process. Pure asyncio/anyio surface — concrete watchers
  may use ``anyio.to_thread`` internally for blocking I/O.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Protocol, runtime_checkable

_LOG = logging.getLogger(__name__)


@dataclass(frozen=True)
class TriggerEvent:
    """A single normalised trigger emitted by a Watcher.

    Watchers translate their source-specific payload (HTTP body, file mtime,
    Redis stream entry, cron firing) into this shape so the dispatcher can be
    transport-agnostic.

    Fields
    ------
    kind:
        Source class — ``"poll"``, ``"fs"``, ``"redis"``, ``"schedule"``, ...
        Used for logging and metrics; the dispatcher should not branch on it.
    graph_id:
        Target graph to start. Empty string means "decline" (watcher kept the
        trigger but isn't ready to fire) — ``WatcherRunner`` skips such events.
    payload:
        Source-specific context object passed to the run as the initial run
        context. Must be JSON-serialisable.
    source_id:
        Stable identifier of the trigger within the watcher (e.g. cron job id,
        watched filesystem path, RSS feed url). Used for de-dup logging.
    """

    kind: str
    graph_id: str
    payload: dict[str, Any] = field(default_factory=dict)
    source_id: str = ""


@runtime_checkable
class Watcher(Protocol):
    """Source-agnostic trigger watcher contract.

    Implementations are expected to be cheap to construct; expensive setup
    (network connections, filesystem scans) belongs in ``reload``.
    """

    #: Cooperative sleep between ticks, in seconds. Watchers that block
    #: internally (Redis ``XREAD`` with a timeout) should set this to ``0.0``.
    poll_interval_seconds: float

    async def reload(self) -> None:
        """Re-read external config (graphs dir, schedule file, etc).

        Called once at startup and again whenever ``WatcherRunner`` decides
        to refresh (currently every tick — concrete watchers gate the work
        themselves on mtime changes).
        """
        ...

    async def tick(self) -> list[TriggerEvent]:
        """Return events fired since the previous ``tick`` (possibly empty).

        Implementations *must not* raise on transient I/O — log + return ``[]``.
        Cancellation (``anyio.get_cancelled_exc_class()``) is propagated by the
        runner; no need to catch it.
        """
        ...


DispatchFn = Callable[[TriggerEvent], Awaitable[None]]


class WatcherRunner:
    """Drive a ``Watcher`` to completion / cancel.

    The shared loop body (reload → tick → dispatch → sleep → handle cancel)
    lives here once instead of once per broker module.

    Usage::

        runner = WatcherRunner(dispatch=my_async_dispatcher)
        await runner.run(my_watcher)  # blocks until stop() or cancel
        runner.stop()                 # cooperative stop

    Public methods
    --------------
    * ``run(watcher)`` — drive a watcher (single one per runner instance).
    * ``stop()``       — request stop; the loop exits after the current tick.
    """

    def __init__(self, dispatch: DispatchFn) -> None:
        self._dispatch = dispatch
        self._running = False

    async def run(self, watcher: Watcher) -> None:
        import anyio

        self._running = True
        try:
            await watcher.reload()
        except Exception:  # noqa: BLE001 — startup reload must not crash the runner
            _LOG.exception("WatcherRunner: initial reload failed; will retry next tick")

        while self._running:
            try:
                events = await watcher.tick()
            except anyio.get_cancelled_exc_class():
                raise
            except Exception:  # noqa: BLE001 — one bad tick must not kill the loop
                _LOG.exception("WatcherRunner: tick failed; continuing")
                events = []

            for ev in events:
                if not ev.graph_id:
                    continue
                try:
                    await self._dispatch(ev)
                except anyio.get_cancelled_exc_class():
                    raise
                except Exception:  # noqa: BLE001
                    _LOG.exception(
                        "WatcherRunner: dispatch failed (kind=%s graph=%s source=%s)",
                        ev.kind,
                        ev.graph_id,
                        ev.source_id,
                    )

            try:
                await watcher.reload()
            except anyio.get_cancelled_exc_class():
                raise
            except Exception:  # noqa: BLE001
                _LOG.exception("WatcherRunner: reload failed; continuing")

            try:
                await anyio.sleep(max(0.0, watcher.poll_interval_seconds))
            except anyio.get_cancelled_exc_class():
                break

        self._running = False

    def stop(self) -> None:
        """Cooperative stop. The loop exits after finishing the current tick."""
        self._running = False
