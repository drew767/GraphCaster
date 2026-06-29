# Copyright GraphCaster. All Rights Reserved.

"""Run-broker built-in cron scheduler daemon (F68).

Scans a graphs directory for JSON files containing ``trigger_schedule`` nodes,
computes next-fire times via croniter, and calls a broker client's
``start_run`` coroutine when a fire time is reached.

Enable: set ``GC_RUN_BROKER_SCHEDULER=on`` (or ``1`` / ``true`` / ``yes``).
Tick interval: ``GC_SCHEDULER_TICK_SEC`` (float, default 5.0).
"""

from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Coroutine

from graph_caster.run_broker.watcher import TriggerEvent, WatcherRunner

logger = logging.getLogger(__name__)

try:
    from croniter import croniter as _croniter
except ImportError:  # pragma: no cover
    _croniter = None  # type: ignore[assignment]


def _scheduler_enabled() -> bool:
    v = (os.environ.get("GC_RUN_BROKER_SCHEDULER") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _tick_interval() -> float:
    raw = (os.environ.get("GC_SCHEDULER_TICK_SEC") or "").strip()
    try:
        val = float(raw)
    except (ValueError, TypeError):
        val = 5.0
    return max(0.1, val)


@dataclass
class ScheduledJob:
    """A single scheduler job derived from a trigger_schedule node in a graph."""

    graph_id: str
    node_id: str
    cron: str
    timezone: str = "UTC"
    last_fire_at: datetime | None = None
    next_fire_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    fire_count: int = 0
    missed_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "graphId": self.graph_id,
            "nodeId": self.node_id,
            "cron": self.cron,
            "timezone": self.timezone,
            "lastFireAt": self.last_fire_at.isoformat() if self.last_fire_at else None,
            "nextFireAt": self.next_fire_at.isoformat(),
            "fireCount": self.fire_count,
            "missedCount": self.missed_count,
        }


BrokerClientT = Callable[
    [str, str, str],
    Coroutine[Any, Any, Any],
]


class _BrokerClientProtocol:
    """Minimal interface expected from broker_client."""

    async def start_run(
        self,
        graph_id: str,
        start_node_id: str,
        source: str = "schedule",
    ) -> Any:
        raise NotImplementedError


def _parse_trigger_schedule_nodes(
    doc: dict[str, Any],
) -> list[tuple[str, str, str]]:
    """Return list of (graph_id, node_id, cron, timezone) from a graph document.

    Reads ``data.cron`` / ``data.cronExpression`` / ``data.cron_expression``
    and ``data.timezone`` / ``data.timeZone`` from nodes with
    ``type == "trigger_schedule"``.
    """
    graph_id = (
        doc.get("graphId")
        or doc.get("graph_id")
        or doc.get("meta", {}).get("graphId")
        or ""
    )
    nodes = doc.get("nodes") or []
    results: list[tuple[str, str, str, str]] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("type") != "trigger_schedule":
            continue
        node_id = str(node.get("id") or "").strip()
        if not node_id:
            continue
        data = node.get("data") or {}
        cron = (
            data.get("cron")
            or data.get("cronExpression")
            or data.get("cron_expression")
            or ""
        )
        cron = str(cron).strip()
        tz = (
            data.get("timezone")
            or data.get("timeZone")
            or "UTC"
        )
        tz = str(tz).strip() or "UTC"
        results.append((str(graph_id), node_id, cron, tz))
    return results  # type: ignore[return-value]


def _compute_next_fire(cron: str, tz_name: str, base: datetime) -> datetime:
    """Return next fire datetime (UTC) after *base* for the given cron expression."""
    try:
        from zoneinfo import ZoneInfo
    except ImportError:  # pragma: no cover
        from backports.zoneinfo import ZoneInfo  # type: ignore[import-not-found,no-redef]

    try:
        tz = ZoneInfo(tz_name)
    except Exception:
        tz = timezone.utc  # type: ignore[assignment]

    base_local = base.astimezone(tz)
    it = _croniter(cron, base_local)
    nxt = it.get_next(datetime)
    if nxt.tzinfo is None:
        nxt = nxt.replace(tzinfo=tz)
    return nxt.astimezone(timezone.utc)


class Scheduler:
    """Built-in run-broker cron scheduler daemon.

    Scans ``graphs_dir`` for ``*.json`` graph files, finds nodes with
    ``type == "trigger_schedule"``, computes next-fire times, and fires
    runs via *broker_client* when the time is reached.

    Hot-reloads schedule definitions by polling directory mtime and
    individual file mtime every ``tick_interval_sec`` seconds.

    Args:
        graphs_dir: Directory containing graph JSON files.
        broker_client: Object exposing ``async start_run(graph_id, start_node_id, source)``.
        tick_interval_sec: Polling interval in seconds (default 5.0;
            overridden by ``GC_SCHEDULER_TICK_SEC``).
        clock: Callable returning current UTC datetime (injectable for tests).
    """

    def __init__(
        self,
        graphs_dir: Path,
        broker_client: Any,
        *,
        tick_interval_sec: float | None = None,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._graphs_dir = Path(graphs_dir)
        self._broker_client = broker_client
        self._tick = tick_interval_sec if tick_interval_sec is not None else _tick_interval()
        self._clock: Callable[[], datetime] = clock or (
            lambda: datetime.now(timezone.utc)
        )
        self._jobs: dict[str, ScheduledJob] = {}
        self._running = False
        self._file_mtimes: dict[Path, float] = {}
        self._dir_mtime: float = 0.0

        self._fires_total: dict[str, int] = {}
        self._missed_total: dict[str, int] = {}

    @property
    def poll_interval_seconds(self) -> float:
        """Cooperative sleep between ticks (env-configurable, default 5.0s)."""
        return self._tick

    def list_jobs(self) -> list[ScheduledJob]:
        """Return a snapshot of currently loaded scheduled jobs."""
        return list(self._jobs.values())

    async def reload(self) -> None:
        """Re-scan graphs_dir for trigger_schedule nodes."""
        import anyio

        new_jobs: dict[str, ScheduledJob] = {}

        try:
            entries = list(self._graphs_dir.glob("*.json"))
        except OSError as exc:
            logger.warning("Scheduler: cannot list graphs_dir %s: %s", self._graphs_dir, exc)
            return

        for path in entries:
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue
            try:
                raw = await anyio.to_thread.run_sync(path.read_text, "utf-8")
                doc = json.loads(raw)
            except Exception as exc:
                logger.warning("Scheduler: skip %s (parse error: %s)", path.name, exc)
                continue

            if not isinstance(doc, dict):
                continue

            try:
                node_specs = _parse_trigger_schedule_nodes(doc)
            except Exception as exc:
                logger.warning("Scheduler: error extracting nodes from %s: %s", path.name, exc)
                continue

            for graph_id, node_id, cron, tz in node_specs:
                if not graph_id:
                    logger.warning(
                        "Scheduler: graph in %s has no graphId, skipping node %s",
                        path.name,
                        node_id,
                    )
                    continue
                if not cron:
                    logger.warning(
                        "Scheduler: graph %s node %s has no cron expression, skipping",
                        graph_id,
                        node_id,
                    )
                    continue

                if _croniter is None:
                    logger.warning(
                        "Scheduler: croniter not installed; cannot schedule %s/%s",
                        graph_id,
                        node_id,
                    )
                    continue

                try:
                    _croniter(cron)
                except Exception as exc:
                    logger.warning(
                        "Scheduler: invalid cron %r for %s/%s: %s — skipping",
                        cron,
                        graph_id,
                        node_id,
                        exc,
                    )
                    continue

                job_key = f"{graph_id}::{node_id}"
                existing = self._jobs.get(job_key)
                now = self._clock()
                if existing is not None and existing.cron == cron and existing.timezone == tz:
                    new_jobs[job_key] = existing
                else:
                    next_fire = _compute_next_fire(cron, tz, now)
                    job = ScheduledJob(
                        graph_id=graph_id,
                        node_id=node_id,
                        cron=cron,
                        timezone=tz,
                        last_fire_at=None,
                        next_fire_at=next_fire,
                    )
                    new_jobs[job_key] = job
                    logger.debug(
                        "Scheduler: loaded job %s/%s cron=%r next=%s",
                        graph_id,
                        node_id,
                        cron,
                        next_fire.isoformat(),
                    )

        added = set(new_jobs) - set(self._jobs)
        removed = set(self._jobs) - set(new_jobs)
        if added:
            logger.info("Scheduler: +%d jobs loaded: %s", len(added), ", ".join(sorted(added)))
        if removed:
            logger.info("Scheduler: -%d jobs removed: %s", len(removed), ", ".join(sorted(removed)))

        self._jobs = new_jobs

    def _jobs_metric_text(self) -> str:
        n = len(self._jobs)
        fires_lines = []
        missed_lines = []
        for key, job in self._jobs.items():
            gid = job.graph_id
            nid = job.node_id
            fires_lines.append(
                f'gc_scheduler_fires_total{{graphId="{gid}",nodeId="{nid}"}} {job.fire_count}'
            )
            missed_lines.append(
                f'gc_scheduler_missed_fires_total{{graphId="{gid}"}} {job.missed_count}'
            )
        lines = [
            "# HELP gc_scheduler_jobs_total Number of scheduler jobs currently loaded.",
            "# TYPE gc_scheduler_jobs_total gauge",
            f"gc_scheduler_jobs_total {n}",
            "# HELP gc_scheduler_fires_total Total fires per schedule job.",
            "# TYPE gc_scheduler_fires_total counter",
            *fires_lines,
            "# HELP gc_scheduler_missed_fires_total Fires that failed to start a run.",
            "# TYPE gc_scheduler_missed_fires_total counter",
            *missed_lines,
        ]
        return "\n".join(lines)

    def prometheus_metrics_text(self) -> str:
        """Return Prometheus text exposition for scheduler metrics."""
        return self._jobs_metric_text()

    async def _tick_once(self) -> None:
        """Single scheduler tick: check fire times and fire due jobs."""
        now = self._clock()
        for job_key, job in list(self._jobs.items()):
            if now < job.next_fire_at:
                continue
            gid, nid = job.graph_id, job.node_id
            logger.info(
                "Scheduler: firing %s/%s (cron=%r, scheduled=%s)",
                gid,
                nid,
                job.cron,
                job.next_fire_at.isoformat(),
            )
            try:
                await self._broker_client.start_run(
                    graph_id=gid,
                    start_node_id=nid,
                    source="schedule",
                )
                job.fire_count += 1
                job.last_fire_at = now
            except Exception as exc:
                logger.error(
                    "Scheduler: start_run failed for %s/%s: %s",
                    gid,
                    nid,
                    exc,
                )
                job.missed_count += 1

            try:
                job.next_fire_at = _compute_next_fire(job.cron, job.timezone, now)
            except Exception as exc:
                logger.warning(
                    "Scheduler: cannot recompute next fire for %s/%s: %s",
                    gid,
                    nid,
                    exc,
                )

    async def tick(self) -> list[TriggerEvent]:
        """Watcher protocol: check fire times + reload-if-changed; jobs fire inline."""
        await self._tick_once()
        await self._maybe_reload()
        return []

    async def run(self) -> None:
        """Thin wrapper: drive self via shared WatcherRunner."""
        if not _scheduler_enabled():
            logger.info(
                "Scheduler: disabled (set GC_RUN_BROKER_SCHEDULER=on to enable)."
            )
            return

        if _croniter is None:
            logger.warning(
                "Scheduler: croniter not installed; install pip install -e '.[scheduler]'."
            )
            return

        async def _noop(_ev: TriggerEvent) -> None:
            return

        self._runner = WatcherRunner(dispatch=_noop)
        self._running = True
        logger.info(
            "Scheduler: starting, graphs_dir=%s, tick=%.1fs",
            self._graphs_dir,
            self._tick,
        )
        try:
            await self._runner.run(self)
        finally:
            self._running = False
            logger.info("Scheduler: stopped.")

    async def _maybe_reload(self) -> None:
        """Reload schedule if graphs_dir mtime or any file mtime changed."""
        try:
            dir_mtime = self._graphs_dir.stat().st_mtime
        except OSError:
            return
        if dir_mtime != self._dir_mtime:
            self._dir_mtime = dir_mtime
            await self.reload()
            return

        for path in self._graphs_dir.glob("*.json"):
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue
            if self._file_mtimes.get(path) != mtime:
                self._file_mtimes[path] = mtime
                await self.reload()
                return

    def stop(self) -> None:
        """Signal the run loop to stop after the current tick."""
        self._running = False
        runner = getattr(self, "_runner", None)
        if runner is not None:
            runner.stop()
