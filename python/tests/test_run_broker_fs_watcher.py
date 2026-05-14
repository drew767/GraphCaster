# Copyright GraphCaster. All Rights Reserved.

"""Tests for run_broker_fs_watcher (F71 — filesystem watcher daemon)."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest

from graph_caster.run_broker_fs_watcher import (
    FilesystemWatcher,
    WatchedTrigger,
    _parse_trigger_filesystem_nodes,
    _scan_path,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_graph_doc(
    graph_id: str,
    watch_path: str,
    node_id: str = "fsnode1",
    glob: str | None = None,
    events: list[str] | None = None,
    recursive: bool = False,
    stable_for_sec: float = 0.0,
    poll_interval_sec: float = 0.5,
) -> dict[str, Any]:
    data: dict[str, Any] = {
        "path": watch_path,
        "stableForSec": stable_for_sec,
        "pollIntervalSec": poll_interval_sec,
        "recursive": recursive,
    }
    if glob is not None:
        data["glob"] = glob
    if events is not None:
        data["events"] = events
    return {
        "graphId": graph_id,
        "nodes": [
            {
                "id": node_id,
                "type": "trigger_filesystem",
                "data": data,
            }
        ],
        "edges": [],
    }


def _write_graph(tmp_path: Path, name: str, doc: dict[str, Any]) -> Path:
    p = tmp_path / name
    p.write_text(json.dumps(doc), encoding="utf-8")
    return p


@dataclass
class MockBrokerClient:
    calls: list[dict[str, Any]] = field(default_factory=list)
    raise_on_next: Exception | None = None

    async def start_run(
        self,
        graph_id: str,
        start_node_id: str,
        source: str = "filesystem",
        payload: dict | None = None,
    ) -> None:
        if self.raise_on_next is not None:
            exc = self.raise_on_next
            self.raise_on_next = None
            raise exc
        self.calls.append(
            {
                "graph_id": graph_id,
                "start_node_id": start_node_id,
                "source": source,
                "payload": payload,
            }
        )


# ---------------------------------------------------------------------------
# Unit: _parse_trigger_filesystem_nodes
# ---------------------------------------------------------------------------

class TestParseTriggerFilesystemNodes:
    def test_basic(self, tmp_path: Path) -> None:
        doc = _make_graph_doc("g1", str(tmp_path))
        specs = _parse_trigger_filesystem_nodes(doc)
        assert len(specs) == 1
        gid, nid, path, glob_pat, events, recursive, stable, poll = specs[0]
        assert gid == "g1"
        assert nid == "fsnode1"
        assert path == Path(str(tmp_path))
        assert glob_pat is None
        assert "created" in events
        assert "modified" in events
        assert recursive is False
        assert stable == 0.0
        assert poll == 0.5

    def test_with_glob(self, tmp_path: Path) -> None:
        doc = _make_graph_doc("g2", str(tmp_path), glob="*.json")
        specs = _parse_trigger_filesystem_nodes(doc)
        assert specs[0][3] == "*.json"

    def test_events_override(self, tmp_path: Path) -> None:
        doc = _make_graph_doc("g3", str(tmp_path), events=["deleted"])
        specs = _parse_trigger_filesystem_nodes(doc)
        assert specs[0][4] == {"deleted"}

    def test_ignores_other_types(self) -> None:
        doc = {
            "graphId": "g4",
            "nodes": [{"id": "n1", "type": "trigger_schedule", "data": {"cron": "* * * * *"}}],
            "edges": [],
        }
        assert _parse_trigger_filesystem_nodes(doc) == []

    def test_missing_path_skipped(self) -> None:
        doc = {
            "graphId": "g5",
            "nodes": [{"id": "n1", "type": "trigger_filesystem", "data": {}}],
            "edges": [],
        }
        assert _parse_trigger_filesystem_nodes(doc) == []


# ---------------------------------------------------------------------------
# Unit: _scan_path
# ---------------------------------------------------------------------------

class TestScanPath:
    def test_nonexistent_returns_empty(self, tmp_path: Path) -> None:
        result = _scan_path(tmp_path / "nope", None, False)
        assert result == {}

    def test_file_watch(self, tmp_path: Path) -> None:
        f = tmp_path / "a.txt"
        f.write_text("hello")
        result = _scan_path(f, None, False)
        assert f in result

    def test_glob_filter(self, tmp_path: Path) -> None:
        (tmp_path / "a.txt").write_text("x")
        (tmp_path / "b.json").write_text("y")
        result = _scan_path(tmp_path, "*.json", False)
        assert len(result) == 1
        assert tmp_path / "b.json" in result

    def test_recursive(self, tmp_path: Path) -> None:
        sub = tmp_path / "sub"
        sub.mkdir()
        (sub / "deep.txt").write_text("d")
        shallow = _scan_path(tmp_path, None, recursive=False)
        deep = _scan_path(tmp_path, None, recursive=True)
        assert (sub / "deep.txt") not in shallow
        assert (sub / "deep.txt") in deep


# ---------------------------------------------------------------------------
# Integration: FilesystemWatcher via reload + _poll_all
# ---------------------------------------------------------------------------

class TestFilesystemWatcherReload:
    @pytest.mark.anyio
    async def test_reload_loads_trigger(self, tmp_path: Path) -> None:
        graphs_dir = tmp_path / "graphs"
        graphs_dir.mkdir()
        watch_dir = tmp_path / "inbox"
        watch_dir.mkdir()

        _write_graph(graphs_dir, "g.json", _make_graph_doc("g1", str(watch_dir)))

        client = MockBrokerClient()
        watcher = FilesystemWatcher(graphs_dir, client, default_poll_sec=0.1)
        await watcher.reload()

        triggers = watcher.list_triggers()
        assert len(triggers) == 1
        assert triggers[0].graph_id == "g1"
        assert triggers[0].path == watch_dir

    @pytest.mark.anyio
    async def test_created_fires(self, tmp_path: Path) -> None:
        graphs_dir = tmp_path / "graphs"
        graphs_dir.mkdir()
        watch_dir = tmp_path / "inbox"
        watch_dir.mkdir()

        _write_graph(graphs_dir, "g.json", _make_graph_doc("g1", str(watch_dir)))

        client = MockBrokerClient()
        watcher = FilesystemWatcher(graphs_dir, client, default_poll_sec=0.1)
        await watcher.reload()

        # First poll — establish baseline (empty dir)
        await watcher._poll_all()
        assert client.calls == []

        # Create a file
        (watch_dir / "new.txt").write_text("hello")

        # Second poll — should detect creation
        await watcher._poll_all()
        assert len(client.calls) == 1
        call = client.calls[0]
        assert call["graph_id"] == "g1"
        assert call["source"] == "filesystem"
        assert call["payload"]["event"] == "created"
        assert "new.txt" in call["payload"]["path"]

    @pytest.mark.anyio
    async def test_deleted_fires(self, tmp_path: Path) -> None:
        graphs_dir = tmp_path / "graphs"
        graphs_dir.mkdir()
        watch_dir = tmp_path / "inbox"
        watch_dir.mkdir()
        f = watch_dir / "existing.txt"
        f.write_text("data")

        doc = _make_graph_doc("gd", str(watch_dir), events=["deleted"])
        _write_graph(graphs_dir, "g.json", doc)

        client = MockBrokerClient()
        watcher = FilesystemWatcher(graphs_dir, client, default_poll_sec=0.1)
        await watcher.reload()

        # Baseline: file exists
        await watcher._poll_all()
        assert client.calls == []

        # Delete the file
        f.unlink()

        # Poll again
        await watcher._poll_all()
        assert len(client.calls) == 1
        assert client.calls[0]["payload"]["event"] == "deleted"

    @pytest.mark.anyio
    async def test_modified_fires_after_stable_period(self, tmp_path: Path) -> None:
        """Modified fires only after stable_for_sec has elapsed."""
        graphs_dir = tmp_path / "graphs"
        graphs_dir.mkdir()
        watch_dir = tmp_path / "inbox"
        watch_dir.mkdir()
        f = watch_dir / "changing.txt"
        f.write_text("v1")

        # Use a manual clock we control
        fake_time = [0.0]

        def clock() -> float:
            return fake_time[0]

        doc = _make_graph_doc("gm", str(watch_dir), events=["modified"], stable_for_sec=5.0)
        _write_graph(graphs_dir, "g.json", doc)

        client = MockBrokerClient()
        watcher = FilesystemWatcher(graphs_dir, client, default_poll_sec=0.1, clock=clock)
        await watcher.reload()

        # Baseline snapshot (t=0)
        await watcher._poll_all()
        assert client.calls == []

        # Modify the file (change mtime artificially by rewriting)
        f.write_text("v2")

        # Poll at t=2 — stable_for_sec=5.0 not elapsed yet
        fake_time[0] = 2.0
        await watcher._poll_all()
        assert client.calls == []

        # Poll at t=8 — stable_for_sec=5.0 elapsed since first detection at t=2
        fake_time[0] = 8.0
        await watcher._poll_all()
        assert len(client.calls) == 1
        assert client.calls[0]["payload"]["event"] == "modified"

    @pytest.mark.anyio
    async def test_glob_filter_excludes_non_matching(self, tmp_path: Path) -> None:
        graphs_dir = tmp_path / "graphs"
        graphs_dir.mkdir()
        watch_dir = tmp_path / "inbox"
        watch_dir.mkdir()

        doc = _make_graph_doc("gg", str(watch_dir), glob="*.json")
        _write_graph(graphs_dir, "g.json", doc)

        client = MockBrokerClient()
        watcher = FilesystemWatcher(graphs_dir, client)
        await watcher.reload()

        await watcher._poll_all()

        # Create non-matching file
        (watch_dir / "readme.txt").write_text("ignore me")
        await watcher._poll_all()
        assert client.calls == []

        # Create matching file
        (watch_dir / "data.json").write_text("{}")
        await watcher._poll_all()
        assert len(client.calls) == 1
        assert "data.json" in client.calls[0]["payload"]["path"]

    @pytest.mark.anyio
    async def test_recursive_picks_up_nested(self, tmp_path: Path) -> None:
        graphs_dir = tmp_path / "graphs"
        graphs_dir.mkdir()
        watch_dir = tmp_path / "inbox"
        watch_dir.mkdir()
        sub = watch_dir / "sub"
        sub.mkdir()

        doc = _make_graph_doc("gr", str(watch_dir), recursive=True)
        _write_graph(graphs_dir, "g.json", doc)

        client = MockBrokerClient()
        watcher = FilesystemWatcher(graphs_dir, client)
        await watcher.reload()

        await watcher._poll_all()  # baseline

        (sub / "deep.txt").write_text("d")
        await watcher._poll_all()

        assert len(client.calls) == 1
        assert "deep.txt" in client.calls[0]["payload"]["path"]

    @pytest.mark.anyio
    async def test_reload_after_adding_new_graph(self, tmp_path: Path) -> None:
        graphs_dir = tmp_path / "graphs"
        graphs_dir.mkdir()
        watch_dir = tmp_path / "inbox"
        watch_dir.mkdir()

        client = MockBrokerClient()
        watcher = FilesystemWatcher(graphs_dir, client)
        await watcher.reload()
        assert watcher.list_triggers() == []

        # Add a new graph file
        _write_graph(graphs_dir, "new.json", _make_graph_doc("gnew", str(watch_dir)))
        await watcher.reload()

        triggers = watcher.list_triggers()
        assert len(triggers) == 1
        assert triggers[0].graph_id == "gnew"

    @pytest.mark.anyio
    async def test_invalid_path_does_not_crash(self, tmp_path: Path) -> None:
        graphs_dir = tmp_path / "graphs"
        graphs_dir.mkdir()
        missing_dir = tmp_path / "does_not_exist"

        doc = _make_graph_doc("gbad", str(missing_dir))
        _write_graph(graphs_dir, "g.json", doc)

        client = MockBrokerClient()
        watcher = FilesystemWatcher(graphs_dir, client)
        await watcher.reload()

        # Should not raise
        await watcher._poll_all()
        assert client.calls == []

    @pytest.mark.anyio
    async def test_broker_error_does_not_crash_loop(self, tmp_path: Path) -> None:
        graphs_dir = tmp_path / "graphs"
        graphs_dir.mkdir()
        watch_dir = tmp_path / "inbox"
        watch_dir.mkdir()

        doc = _make_graph_doc("gerr", str(watch_dir))
        _write_graph(graphs_dir, "g.json", doc)

        client = MockBrokerClient()
        client.raise_on_next = RuntimeError("broker down")

        watcher = FilesystemWatcher(graphs_dir, client)
        await watcher.reload()
        await watcher._poll_all()  # baseline

        (watch_dir / "boom.txt").write_text("x")
        # Should not raise even though broker raises
        await watcher._poll_all()
        assert client.calls == []  # call was attempted but error was swallowed


# ---------------------------------------------------------------------------
# WatchedTrigger.to_dict
# ---------------------------------------------------------------------------

class TestWatchedTriggerToDict:
    def test_to_dict(self, tmp_path: Path) -> None:
        t = WatchedTrigger(
            graph_id="g1",
            node_id="n1",
            path=tmp_path,
            glob_pattern="*.json",
            events={"created", "modified"},
            recursive=True,
            stable_for_sec=2.5,
            poll_interval_sec=1.0,
        )
        d = t.to_dict()
        assert d["graphId"] == "g1"
        assert d["nodeId"] == "n1"
        assert d["glob"] == "*.json"
        assert set(d["events"]) == {"created", "modified"}
        assert d["recursive"] is True
        assert d["stableForSec"] == 2.5
