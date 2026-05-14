# Copyright GraphCaster. All Rights Reserved.

"""Auto-reap on ``RunSessionRegistry.register`` (P1)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from graph_caster.run_sessions import RunSession, RunSessionRegistry


def test_register_auto_reaps_session_with_stale_heartbeat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A second ``register`` call reaps a sibling whose heartbeat went silent."""
    monkeypatch.setenv("GC_RUN_SESSION_HEARTBEAT_STALE_SEC", "1")
    reg = RunSessionRegistry()
    stale = RunSession(run_id="r-stale", root_graph_id="g")
    # Pretend the last heartbeat happened five minutes ago.
    stale.last_heartbeat = datetime.now(UTC) - timedelta(seconds=300)
    reg._sessions["r-stale"] = stale  # type: ignore[attr-defined]

    fresh = RunSession(run_id="r-fresh", root_graph_id="g")
    reg.register(fresh)

    assert stale.status == "failed"
    assert stale.finished_at is not None
    # New session admitted normally.
    assert reg.get("r-fresh") is fresh


def test_register_does_not_reap_recently_heartbeating_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GC_RUN_SESSION_HEARTBEAT_STALE_SEC", "300")
    reg = RunSessionRegistry()
    recent = RunSession(run_id="r-live", root_graph_id="g")
    recent.last_heartbeat = datetime.now(UTC)  # right now
    reg._sessions["r-live"] = recent  # type: ignore[attr-defined]

    new = RunSession(run_id="r-new", root_graph_id="g")
    reg.register(new)
    assert recent.status == "running"


def test_touch_heartbeat_updates_timestamp() -> None:
    s = RunSession(run_id="r1", root_graph_id="g")
    before = s.last_heartbeat
    # Travel forward in time minimally via monotonic-equivalent: set then touch.
    s.last_heartbeat = datetime.now(UTC) - timedelta(seconds=100)
    assert s.last_heartbeat < before or s.last_heartbeat <= before
    s.touch_heartbeat()
    assert s.last_heartbeat > before - timedelta(microseconds=1)


def test_reap_use_heartbeat_arg_respects_threshold() -> None:
    reg = RunSessionRegistry()
    a = RunSession(run_id="a", root_graph_id="g")
    a.last_heartbeat = datetime.now(UTC) - timedelta(seconds=120)
    reg._sessions["a"] = a  # type: ignore[attr-defined]
    b = RunSession(run_id="b", root_graph_id="g")
    b.last_heartbeat = datetime.now(UTC) - timedelta(seconds=10)
    reg._sessions["b"] = b  # type: ignore[attr-defined]

    reaped = reg.reap_stale_running_sessions(max_age_sec=60.0, use_heartbeat=True)
    assert reaped == ["a"]
    assert a.status == "failed"
    assert b.status == "running"
