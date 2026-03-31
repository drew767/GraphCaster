# Copyright GraphCaster. All Rights Reserved.

"""Roadmap Task 3.2: GraphRunner executes independent fork branches concurrently (wall-time)."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

from graph_caster import GraphRunner
from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument

_ROOT = Path(__file__).resolve().parents[2]


def _cmd_py() -> list[str]:
    return [sys.executable, "-c", "print(1)"]


def test_runner_executes_parallel_branches_concurrently(tmp_path: Path) -> None:
    """Fork branches with subprocess sleeps overlap when ``fork_max_parallel`` is raised."""
    delay = 0.55
    raw = json.loads(
        (_ROOT / "schemas" / "test-fixtures" / "fork-merge-barrier.json").read_text(encoding="utf-8")
    )
    for nid in ("t0", "ta", "tb"):
        n = next(x for x in raw["nodes"] if x["id"] == nid)
        if nid == "t0":
            n["data"] = {"command": _cmd_py(), "cwd": str(tmp_path)}
        else:
            n["data"] = {
                "command": [sys.executable, "-c", f"import time; time.sleep({delay})"],
                "cwd": str(tmp_path),
            }
    fork = next(x for x in raw["nodes"] if x["id"] == "f1")
    fork["data"] = {**(fork.get("data") or {}), "maxParallel": 2}
    doc = GraphDocument.from_dict(raw)
    events_seq: list[dict] = []
    t1 = time.monotonic()
    GraphRunner(
        doc,
        sink=lambda e: events_seq.append(e),
        host=RunHostContext(artifacts_base=tmp_path),
    ).run()
    seq_elapsed = time.monotonic() - t1
    assert events_seq[-1].get("status") == "success"

    events: list[dict] = []
    t0 = time.monotonic()
    GraphRunner(
        doc,
        sink=lambda e: events.append(e),
        host=RunHostContext(artifacts_base=tmp_path),
        fork_max_parallel=8,
    ).run()
    parallel_elapsed = time.monotonic() - t0
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "success"

    assert seq_elapsed > delay * 1.35
    assert parallel_elapsed < seq_elapsed * 0.92
