# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from graph_caster.run_sessions import RunSession, RunSessionRegistry


def test_reap_stale_running_marks_failed() -> None:
    reg = RunSessionRegistry()
    old = datetime.now(UTC) - timedelta(hours=10)
    s = RunSession(run_id="r1", root_graph_id="g1", started_at=old, status="running")
    reg._sessions["r1"] = s  # type: ignore[attr-defined]
    reaped = reg.reap_stale_running_sessions(max_age_sec=3600.0)
    assert reaped == ["r1"]
    assert s.status == "failed"
    assert s.finished_at is not None


def test_reap_skips_recent_running() -> None:
    reg = RunSessionRegistry()
    s = RunSession(run_id="r2", root_graph_id="g1", status="running")
    reg._sessions["r2"] = s  # type: ignore[attr-defined]
    assert reg.reap_stale_running_sessions(max_age_sec=86_400.0) == []
    assert s.status == "running"
