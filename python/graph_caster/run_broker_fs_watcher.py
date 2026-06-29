# Copyright GraphCaster. All Rights Reserved.

"""Run-broker filesystem watcher daemon (F71).

Scans a graphs directory for JSON files containing ``trigger_filesystem`` nodes,
polls the configured paths for created/modified/deleted file events, and calls a
broker client's ``start_run`` coroutine when an event fires.

Enable: set ``GC_RUN_BROKER_FS_WATCHER=on`` (or ``1`` / ``true`` / ``yes``).
"""

from __future__ import annotations

import fnmatch
import json
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Literal, NamedTuple

from graph_caster.run_broker.watcher import TriggerEvent, WatcherRunner

logger = logging.getLogger(__name__)


def _fs_watcher_enabled() -> bool:
    v = (os.environ.get("GC_RUN_BROKER_FS_WATCHER") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

EventKind = Literal["created", "modified", "deleted"]


@dataclass
class WatchedTrigger:
    """A single filesystem watch entry derived from a trigger_filesystem node."""

    graph_id: str
    node_id: str
    path: Path
    glob_pattern: str | None
    events: set[EventKind]
    recursive: bool
    stable_for_sec: float
    poll_interval_sec: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "graphId": self.graph_id,
            "nodeId": self.node_id,
            "path": str(self.path),
            "glob": self.glob_pattern,
            "events": sorted(self.events),
            "recursive": self.recursive,
            "stableForSec": self.stable_for_sec,
            "pollIntervalSec": self.poll_interval_sec,
        }


class _FileEntry(NamedTuple):
    path: Path
    mtime: float
    size: int


# ---------------------------------------------------------------------------
# Graph document parsing
# ---------------------------------------------------------------------------

def _parse_trigger_filesystem_nodes(
    doc: dict[str, Any],
) -> list[tuple[str, str, Path, str | None, set[EventKind], bool, float, float]]:
    """Return trigger_filesystem node specs from *doc*.

    Each entry is:
        (graph_id, node_id, path, glob_pattern, events, recursive,
         stable_for_sec, poll_interval_sec)
    """
    graph_id = (
        doc.get("graphId")
        or doc.get("graph_id")
        or doc.get("meta", {}).get("graphId")
        or ""
    )
    nodes = doc.get("nodes") or []
    results = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("type") != "trigger_filesystem":
            continue
        node_id = str(node.get("id") or "").strip()
        if not node_id:
            continue
        data = node.get("data") or {}
        raw_path = str(data.get("path") or "").strip()
        if not raw_path:
            continue
        watch_path = Path(raw_path)

        glob_pattern: str | None = data.get("glob") or None
        if glob_pattern is not None:
            glob_pattern = str(glob_pattern).strip() or None

        raw_events = data.get("events") or ["created", "modified"]
        valid: set[EventKind] = set()
        for ev in raw_events:
            if ev in ("created", "modified", "deleted"):
                valid.add(ev)  # type: ignore[arg-type]
        if not valid:
            valid = {"created", "modified"}

        recursive = bool(data.get("recursive", False))
        stable_for_sec = float(data.get("stableForSec", data.get("stable_for_sec", 1.0)))
        poll_interval_sec = float(
            data.get("pollIntervalSec", data.get("poll_interval_sec", 2.0))
        )

        results.append(
            (
                str(graph_id),
                node_id,
                watch_path,
                glob_pattern,
                valid,
                recursive,
                stable_for_sec,
                poll_interval_sec,
            )
        )
    return results


# ---------------------------------------------------------------------------
# Per-trigger poll state
# ---------------------------------------------------------------------------

@dataclass
class _TriggerPollState:
    """Mutable poll state for one WatchedTrigger."""

    trigger: WatchedTrigger
    last_snapshot: dict[Path, _FileEntry] = field(default_factory=dict)
    # path -> timestamp when change was first detected (for debounce)
    pending_modified: dict[Path, float] = field(default_factory=dict)
    fire_count: int = 0
    error_count: int = 0


# ---------------------------------------------------------------------------
# Prometheus metrics (pure text exposition, no external lib)
# ---------------------------------------------------------------------------

class _Metrics:
    def __init__(self) -> None:
        self._triggers: int = 0
        self._fires: dict[tuple[str, str, str], int] = {}
        self._errors: dict[str, int] = {}

    def set_trigger_count(self, n: int) -> None:
        self._triggers = n

    def inc_fire(self, graph_id: str, node_id: str, event: str) -> None:
        key = (graph_id, node_id, event)
        self._fires[key] = self._fires.get(key, 0) + 1

    def inc_error(self, graph_id: str) -> None:
        self._errors[graph_id] = self._errors.get(graph_id, 0) + 1

    def prometheus_text(self) -> str:
        lines = [
            "# HELP gc_fs_watcher_triggers_total Number of filesystem watch triggers currently loaded.",
            "# TYPE gc_fs_watcher_triggers_total gauge",
            f"gc_fs_watcher_triggers_total {self._triggers}",
            "# HELP gc_fs_watcher_fires_total Total event fires per trigger.",
            "# TYPE gc_fs_watcher_fires_total counter",
        ]
        for (gid, nid, ev), cnt in sorted(self._fires.items()):
            lines.append(
                f'gc_fs_watcher_fires_total{{graphId="{gid}",nodeId="{nid}",event="{ev}"}} {cnt}'
            )
        lines += [
            "# HELP gc_fs_watcher_errors_total Total per-trigger poll errors.",
            "# TYPE gc_fs_watcher_errors_total counter",
        ]
        for gid, cnt in sorted(self._errors.items()):
            lines.append(f'gc_fs_watcher_errors_total{{graphId="{gid}"}} {cnt}')
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Filesystem snapshot helpers
# ---------------------------------------------------------------------------

def _scan_path(
    watch_path: Path,
    glob_pattern: str | None,
    recursive: bool,
) -> dict[Path, _FileEntry]:
    """Return a snapshot mapping Path -> _FileEntry for *watch_path*.

    Non-existent paths return an empty dict (caller logs a warning).
    """
    if not watch_path.exists():
        return {}

    if watch_path.is_file():
        try:
            st = watch_path.stat()
            if glob_pattern is None or fnmatch.fnmatch(watch_path.name, glob_pattern):
                return {watch_path: _FileEntry(watch_path, st.st_mtime, st.st_size)}
        except OSError:
            pass
        return {}

    # Directory
    entries: dict[Path, _FileEntry] = {}
    try:
        pattern = "**/*" if recursive else "*"
        for p in watch_path.glob(pattern):
            if not p.is_file():
                continue
            if glob_pattern is not None and not fnmatch.fnmatch(p.name, glob_pattern):
                continue
            try:
                st = p.stat()
                entries[p] = _FileEntry(p, st.st_mtime, st.st_size)
            except OSError:
                continue
    except OSError:
        pass
    return entries


# ---------------------------------------------------------------------------
# FilesystemWatcher
# ---------------------------------------------------------------------------

class FilesystemWatcher:
    """Polling-based filesystem watcher daemon.

    Args:
        graphs_dir: Directory containing graph JSON files.
        broker_client: Object with ``async start_run(graph_id, start_node_id,
            source, payload)`` coroutine.
        default_poll_sec: Fallback poll interval when a trigger does not
            specify ``pollIntervalSec``.
        clock: Injectable time source (``time.monotonic`` by default).
    """

    def __init__(
        self,
        graphs_dir: Path,
        broker_client: Any,
        *,
        default_poll_sec: float = 2.0,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._graphs_dir = Path(graphs_dir)
        self._broker_client = broker_client
        self._default_poll_sec = default_poll_sec
        self._clock: Callable[[], float] = clock or time.monotonic
        self._states: dict[str, _TriggerPollState] = {}
        self._running = False
        self._dir_mtime: float = 0.0
        self._file_mtimes: dict[Path, float] = {}
        self._metrics = _Metrics()

    @property
    def poll_interval_seconds(self) -> float:
        """Cooperative sleep between ticks — minimum across loaded triggers."""
        if self._states:
            return max(0.1, min(s.trigger.poll_interval_sec for s in self._states.values()))
        return self._default_poll_sec

    def list_triggers(self) -> list[WatchedTrigger]:
        """Return a snapshot of currently loaded watched triggers."""
        return [s.trigger for s in self._states.values()]

    def prometheus_metrics_text(self) -> str:
        """Return Prometheus text exposition for fs-watcher metrics."""
        return self._metrics.prometheus_text()

    async def reload(self) -> None:
        """Re-scan graphs_dir for trigger_filesystem nodes."""
        import anyio

        new_states: dict[str, _TriggerPollState] = {}

        try:
            entries = list(self._graphs_dir.glob("*.json"))
        except OSError as exc:
            logger.warning(
                "FsWatcher: cannot list graphs_dir %s: %s", self._graphs_dir, exc
            )
            return

        for path in entries:
            try:
                raw = await anyio.to_thread.run_sync(path.read_text, "utf-8")
                doc = json.loads(raw)
            except Exception as exc:
                logger.warning("FsWatcher: skip %s (parse error: %s)", path.name, exc)
                continue

            if not isinstance(doc, dict):
                continue

            try:
                node_specs = _parse_trigger_filesystem_nodes(doc)
            except Exception as exc:
                logger.warning(
                    "FsWatcher: error extracting nodes from %s: %s", path.name, exc
                )
                continue

            for graph_id, node_id, watch_path, glob_pat, events, recursive, stable_sec, poll_sec in node_specs:
                if not graph_id:
                    logger.warning(
                        "FsWatcher: graph in %s has no graphId, skipping node %s",
                        path.name,
                        node_id,
                    )
                    continue

                trigger = WatchedTrigger(
                    graph_id=graph_id,
                    node_id=node_id,
                    path=watch_path,
                    glob_pattern=glob_pat,
                    events=events,
                    recursive=recursive,
                    stable_for_sec=stable_sec,
                    poll_interval_sec=poll_sec,
                )
                trigger_key = f"{graph_id}::{node_id}"

                existing = self._states.get(trigger_key)
                if existing is not None and existing.trigger.path == watch_path:
                    # Preserve poll state (snapshot + pending) across reload
                    existing.trigger = trigger
                    new_states[trigger_key] = existing
                else:
                    new_states[trigger_key] = _TriggerPollState(trigger=trigger)
                    logger.debug(
                        "FsWatcher: loaded trigger %s/%s path=%s",
                        graph_id,
                        node_id,
                        watch_path,
                    )

        added = set(new_states) - set(self._states)
        removed = set(self._states) - set(new_states)
        if added:
            logger.info(
                "FsWatcher: +%d triggers loaded: %s", len(added), ", ".join(sorted(added))
            )
        if removed:
            logger.info(
                "FsWatcher: -%d triggers removed: %s",
                len(removed),
                ", ".join(sorted(removed)),
            )

        self._states = new_states
        self._metrics.set_trigger_count(len(self._states))

    async def _compute_fires(
        self, state: _TriggerPollState
    ) -> list[tuple[EventKind, Path, float]]:
        """Scan one trigger; mutate state.last_snapshot; return pending fires (no dispatch)."""
        trigger = state.trigger

        if not trigger.path.exists():
            logger.warning(
                "FsWatcher: watched path does not exist: %s (trigger %s/%s) — skipping",
                trigger.path,
                trigger.graph_id,
                trigger.node_id,
            )
            return []

        now = self._clock()
        try:
            import anyio

            snapshot = await anyio.to_thread.run_sync(
                lambda: _scan_path(trigger.path, trigger.glob_pattern, trigger.recursive)
            )
        except Exception as exc:
            logger.error(
                "FsWatcher: scan error for %s/%s: %s",
                trigger.graph_id,
                trigger.node_id,
                exc,
            )
            state.error_count += 1
            self._metrics.inc_error(trigger.graph_id)
            return []

        prev = state.last_snapshot
        fires: list[tuple[EventKind, Path, float]] = []
        # Build the new stable snapshot incrementally — only update entries
        # that have settled (not still changing) so pending files keep their
        # original baseline for the debounce comparison.
        new_snapshot = dict(prev)

        # Detect created / modified
        for path, entry in snapshot.items():
            if path not in prev:
                # New file
                if "created" in trigger.events:
                    fires.append(("created", path, entry.mtime))
                # Add to stable snapshot regardless of event filter
                new_snapshot[path] = entry
                # If only "modified" in events, first-seen files are
                # added to baseline silently — no fire on appearance.
            else:
                old = prev[path]
                if entry.mtime != old.mtime or entry.size != old.size:
                    if "modified" in trigger.events:
                        # Debounce: record first-seen-changed timestamp.
                        if path not in state.pending_modified:
                            state.pending_modified[path] = now
                        # Check if stable window has elapsed.
                        if now - state.pending_modified[path] >= trigger.stable_for_sec:
                            fires.append(("modified", path, entry.mtime))
                            del state.pending_modified[path]
                            # Update baseline to the settled mtime.
                            new_snapshot[path] = entry
                        # else: still changing — keep old baseline in snapshot
                    else:
                        # Not watching modified: accept new state as baseline.
                        new_snapshot[path] = entry
                else:
                    # File is unchanged since last stable snapshot.
                    state.pending_modified.pop(path, None)
                    new_snapshot[path] = entry

        # Detect deleted
        for path, entry in prev.items():
            if path not in snapshot:
                state.pending_modified.pop(path, None)
                if "deleted" in trigger.events:
                    fires.append(("deleted", path, entry.mtime))
                del new_snapshot[path]

        state.last_snapshot = new_snapshot
        return fires

    async def _dispatch_fire(
        self,
        state: _TriggerPollState,
        event_kind: EventKind,
        fired_path: Path,
        mtime: float,
    ) -> None:
        trigger = state.trigger
        logger.info(
            "FsWatcher: firing %s/%s event=%s path=%s",
            trigger.graph_id,
            trigger.node_id,
            event_kind,
            fired_path,
        )
        try:
            await self._broker_client.start_run(
                graph_id=trigger.graph_id,
                start_node_id=trigger.node_id,
                source="filesystem",
                payload={
                    "event": event_kind,
                    "path": str(fired_path),
                    "mtime": mtime,
                },
            )
            state.fire_count += 1
            self._metrics.inc_fire(trigger.graph_id, trigger.node_id, event_kind)
        except Exception as exc:
            logger.error(
                "FsWatcher: start_run failed for %s/%s: %s",
                trigger.graph_id,
                trigger.node_id,
                exc,
            )
            state.error_count += 1
            self._metrics.inc_error(trigger.graph_id)

    async def _poll_trigger(self, state: _TriggerPollState) -> None:
        """Single poll tick for one trigger — scan + dispatch via broker_client."""
        fires = await self._compute_fires(state)
        for event_kind, fired_path, mtime in fires:
            await self._dispatch_fire(state, event_kind, fired_path, mtime)

    async def _poll_all(self) -> None:
        """Poll every loaded trigger once."""
        for state in list(self._states.values()):
            try:
                await self._poll_trigger(state)
            except Exception as exc:
                logger.error(
                    "FsWatcher: unexpected error in poll for %s/%s: %s",
                    state.trigger.graph_id,
                    state.trigger.node_id,
                    exc,
                )
                state.error_count += 1
                self._metrics.inc_error(state.trigger.graph_id)

    async def tick(self) -> list[TriggerEvent]:
        """Watcher protocol: poll all triggers + reload-if-changed; events fire inline."""
        await self._poll_all()
        await self._maybe_reload()
        return []

    async def _maybe_reload(self) -> None:
        """Reload triggers if graphs_dir mtime or any graph file mtime changed."""
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

    async def run(self) -> None:
        """Thin wrapper: drive self via shared WatcherRunner.

        Events fire inline through ``broker_client.start_run`` (see ``_dispatch_fire``),
        so the runner's dispatch is a no-op.
        """
        if not _fs_watcher_enabled():
            logger.info(
                "FsWatcher: disabled (set GC_RUN_BROKER_FS_WATCHER=on to enable)."
            )
            return

        async def _noop(_ev: TriggerEvent) -> None:
            return

        self._runner = WatcherRunner(dispatch=_noop)
        self._running = True
        logger.info("FsWatcher: starting, graphs_dir=%s", self._graphs_dir)
        try:
            await self._runner.run(self)
        finally:
            self._running = False
            logger.info("FsWatcher: stopped.")

    def stop(self) -> None:
        """Signal the run loop to stop after the current tick."""
        self._running = False
        runner = getattr(self, "_runner", None)
        if runner is not None:
            runner.stop()
