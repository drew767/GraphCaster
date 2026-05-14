# Copyright GraphCaster. All Rights Reserved.

"""Pause/Resume checkpoint store for human-in-the-loop nodes (F45)."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import threading
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

_LOG = logging.getLogger(__name__)


@dataclass
class PauseCheckpoint:
    """Snapshot of run state when paused at a human_input node."""

    run_id: str
    graph_id: str
    paused_at_node: str
    node_outputs: dict[str, Any]
    prompt: str
    kind: str
    choices: list[str] | None
    schema: dict[str, Any] | None
    paused_at: str
    timeout_sec: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "graph_id": self.graph_id,
            "paused_at_node": self.paused_at_node,
            "node_outputs": self.node_outputs,
            "prompt": self.prompt,
            "kind": self.kind,
            "choices": self.choices,
            "schema": self.schema,
            "paused_at": self.paused_at,
            "timeout_sec": self.timeout_sec,
            "status": "paused",
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "PauseCheckpoint":
        return cls(
            run_id=str(data["run_id"]),
            graph_id=str(data["graph_id"]),
            paused_at_node=str(data["paused_at_node"]),
            node_outputs=dict(data.get("node_outputs") or {}),
            prompt=str(data.get("prompt") or ""),
            kind=str(data.get("kind") or "text"),
            choices=data.get("choices"),
            schema=data.get("schema"),
            paused_at=str(data.get("paused_at") or datetime.now(UTC).isoformat()),
            timeout_sec=float(data.get("timeout_sec") or 0.0),
        )


# Index file layout: { "version": 1, "entries": { "<run_id>": "<graph_id>" } }.
# Storing graph_id (not the full path) keeps the index portable across moved
# artifact roots; the actual file path is derived deterministically.
_INDEX_RELPATH = Path(".graphcaster") / "pause-checkpoints.json"
_INDEX_VERSION = 1

# Cross-thread coordination for index writes/reads within a single process. The
# OS-level atomic replace (os.replace) protects against torn writes between
# processes; this lock prevents in-process readers from observing a partial
# in-memory update.
_INDEX_LOCKS: dict[str, threading.Lock] = {}
_INDEX_LOCKS_GUARD = threading.Lock()


def _index_lock_for(base: Path) -> threading.Lock:
    key = str(base.resolve())
    with _INDEX_LOCKS_GUARD:
        lock = _INDEX_LOCKS.get(key)
        if lock is None:
            lock = threading.Lock()
            _INDEX_LOCKS[key] = lock
        return lock


class CheckpointStore:
    """File-backed pause checkpoint storage.

    Checkpoints are written as JSON files under::

        <artifacts_base>/runs/<graph_id>/<run_id>/checkpoint.json

    A small JSON index at ``<artifacts_base>/.graphcaster/pause-checkpoints.json``
    provides O(1) ``load()``/``delete()`` lookups by ``run_id``. The index is
    maintained on every successful save/delete, and is transparently rebuilt
    from disk on miss or staleness.
    """

    def __init__(self, artifacts_base: Path) -> None:
        self._base = Path(artifacts_base)
        # Test/debug hook: counts of disk walks performed. Mockable to assert
        # the index is hot.
        self._walk_calls = 0

    # ------------------------------------------------------------------
    # Path helpers
    # ------------------------------------------------------------------

    def _checkpoint_path_for(self, run_id: str, graph_id: str) -> Path:
        return self._base / "runs" / graph_id / run_id / "checkpoint.json"

    def _index_path(self) -> Path:
        return self._base / _INDEX_RELPATH

    def _walk_for(self, run_id: str) -> Path | None:
        """Slow path — scan disk for a checkpoint by run_id."""
        self._walk_calls += 1
        runs_root = self._base / "runs"
        if not runs_root.exists():
            return None
        for candidate in runs_root.glob(f"*/{run_id}/checkpoint.json"):
            if candidate.is_file():
                return candidate
        return None

    def _checkpoint_path(self, run_id: str, graph_id: str | None = None) -> Path | None:
        """Backwards-compatible structural lookup (kept for callers using the
        previous private API). Prefers the index; falls back to a disk walk."""
        if graph_id is not None:
            p = self._checkpoint_path_for(run_id, graph_id)
            return p if p.exists() else None
        # Try index first.
        gid = self._index_lookup(run_id)
        if gid is not None:
            p = self._checkpoint_path_for(run_id, gid)
            if p.is_file():
                return p
            # Stale index entry — fall through to walk.
        return self._walk_for(run_id)

    # ------------------------------------------------------------------
    # Index I/O
    # ------------------------------------------------------------------

    def _index_read(self) -> dict[str, str]:
        path = self._index_path()
        try:
            raw = path.read_text(encoding="utf-8")
        except (FileNotFoundError, OSError):
            return {}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return {}
        if not isinstance(data, dict):
            return {}
        entries = data.get("entries")
        if not isinstance(entries, dict):
            return {}
        # Coerce values to str (defensive).
        return {str(k): str(v) for k, v in entries.items()}

    def _index_write(self, entries: dict[str, str]) -> None:
        path = self._index_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"version": _INDEX_VERSION, "entries": entries}
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        os.replace(tmp, path)

    def _index_lookup(self, run_id: str) -> str | None:
        with _index_lock_for(self._base):
            entries = self._index_read()
        return entries.get(run_id)

    def _index_update(self, mutate: Callable[[dict[str, str]], None]) -> None:
        with _index_lock_for(self._base):
            entries = self._index_read()
            mutate(entries)
            try:
                self._index_write(entries)
            except OSError:
                _LOG.debug("pause_resume: failed to write index file", exc_info=True)

    def _index_rebuild(self) -> dict[str, str]:
        """Rescan disk and rewrite the index. Returns the rebuilt entries."""
        self._walk_calls += 1
        rebuilt: dict[str, str] = {}
        runs_root = self._base / "runs"
        if runs_root.exists():
            for cp in runs_root.glob("*/*/checkpoint.json"):
                if not cp.is_file():
                    continue
                # cp = <base>/runs/<graph_id>/<run_id>/checkpoint.json
                try:
                    run_id = cp.parent.name
                    graph_id = cp.parent.parent.name
                except (AttributeError, IndexError):
                    continue
                if run_id and graph_id:
                    rebuilt[run_id] = graph_id
        with _index_lock_for(self._base):
            try:
                self._index_write(rebuilt)
            except OSError:
                _LOG.debug("pause_resume: failed to rebuild index", exc_info=True)
        return rebuilt

    # ------------------------------------------------------------------
    # Public async API
    # ------------------------------------------------------------------

    async def save(self, checkpoint: PauseCheckpoint) -> None:
        path = self._checkpoint_path_for(checkpoint.run_id, checkpoint.graph_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        loop = asyncio.get_event_loop()
        data = checkpoint.to_dict()

        def _write_both() -> None:
            path.write_text(
                json.dumps(data, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            def _set(entries: dict[str, str]) -> None:
                entries[checkpoint.run_id] = checkpoint.graph_id

            self._index_update(_set)

        await loop.run_in_executor(None, _write_both)

    async def load(self, run_id: str) -> PauseCheckpoint | None:
        loop = asyncio.get_event_loop()

        def _resolve_and_read() -> dict[str, Any] | None:
            # Fast path — index hit, file exists.
            gid = self._index_lookup(run_id)
            if gid is not None:
                cp = self._checkpoint_path_for(run_id, gid)
                if cp.is_file():
                    try:
                        return json.loads(cp.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        return None
                # Stale index entry — drop it.
                def _drop(entries: dict[str, str]) -> None:
                    entries.pop(run_id, None)

                self._index_update(_drop)

            # Slow path — walk and (if found) repair the index.
            cp = self._walk_for(run_id)
            if cp is None:
                return None
            try:
                payload = json.loads(cp.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                return None
            # Repair: cp = .../<graph_id>/<run_id>/checkpoint.json
            try:
                gid = cp.parent.parent.name

                def _set(entries: dict[str, str]) -> None:
                    entries[run_id] = gid

                self._index_update(_set)
            except AttributeError:
                pass
            return payload

        raw = await loop.run_in_executor(None, _resolve_and_read)
        if raw is None:
            return None
        return PauseCheckpoint.from_dict(raw)

    async def list_paused(self) -> list[PauseCheckpoint]:
        loop = asyncio.get_event_loop()

        def _scan() -> list[dict[str, Any]]:
            # Prefer the index for the file list, but verify each file still
            # exists and has status="paused"; if the index is empty, rebuild.
            entries = {}
            with _index_lock_for(self._base):
                entries = self._index_read()

            files: list[Path] = []
            if entries:
                for run_id, graph_id in entries.items():
                    cp = self._checkpoint_path_for(run_id, graph_id)
                    if cp.is_file():
                        files.append(cp)
            else:
                # Either no index yet, or fully stale — fall back to glob
                # (and let _index_rebuild repopulate it on a follow-up).
                runs_dir = self._base / "runs"
                if runs_dir.exists():
                    self._walk_calls += 1
                    files = [
                        p for p in runs_dir.glob("*/*/checkpoint.json") if p.is_file()
                    ]
                    if files:
                        # Repair the index in the background of this call so
                        # subsequent loads/list_paused calls hit the fast path.
                        rebuilt: dict[str, str] = {}
                        for cp in files:
                            try:
                                rebuilt[cp.parent.name] = cp.parent.parent.name
                            except AttributeError:
                                continue
                        with _index_lock_for(self._base):
                            try:
                                self._index_write(rebuilt)
                            except OSError:
                                pass

            results: list[dict[str, Any]] = []
            for cp in files:
                try:
                    data = json.loads(cp.read_text(encoding="utf-8"))
                    if data.get("status") == "paused":
                        results.append(data)
                except (OSError, json.JSONDecodeError):
                    pass
            return results

        raw_list = await loop.run_in_executor(None, _scan)
        return [PauseCheckpoint.from_dict(d) for d in raw_list]

    async def delete(self, run_id: str) -> None:
        loop = asyncio.get_event_loop()

        def _delete() -> None:
            # Resolve via index first.
            cp: Path | None = None
            gid = self._index_lookup(run_id)
            if gid is not None:
                candidate = self._checkpoint_path_for(run_id, gid)
                if candidate.is_file():
                    cp = candidate
            if cp is None:
                cp = self._walk_for(run_id)

            if cp is not None:
                try:
                    cp.unlink()
                except OSError:
                    pass

            def _drop(entries: dict[str, str]) -> None:
                entries.pop(run_id, None)

            self._index_update(_drop)

        await loop.run_in_executor(None, _delete)


class PauseException(Exception):
    """Raised by HumanInputNode.run() to signal the runner to pause execution.

    Attributes:
        checkpoint: The checkpoint data to persist.
    """

    def __init__(self, checkpoint: PauseCheckpoint) -> None:
        self.checkpoint = checkpoint
        super().__init__(f"Run paused at node {checkpoint.paused_at_node!r}")
