# Copyright GraphCaster. All Rights Reserved.

"""Tests for the escalating ProcessHeartbeatSupervisor (soft/term/kill levels)."""

from __future__ import annotations

import threading

import pytest

from graph_caster.run_broker.heartbeat import ProcessHeartbeatSupervisor


class _MockProcess:
    """In-memory ``Popen``-like stub. Tracks terminate/kill calls; ``poll()`` returns the value set
    via :meth:`set_exit`."""

    def __init__(self) -> None:
        self.pid = 99999
        self._exit_code: int | None = None
        self.terminate_calls = 0
        self.kill_calls = 0
        self._lock = threading.Lock()

    def poll(self) -> int | None:
        with self._lock:
            return self._exit_code

    def terminate(self) -> None:
        with self._lock:
            self.terminate_calls += 1

    def kill(self) -> None:
        with self._lock:
            self.kill_calls += 1

    def set_exit(self, code: int) -> None:
        with self._lock:
            self._exit_code = code


class _Clock:
    """Manually advanced monotonic clock for deterministic tests."""

    def __init__(self) -> None:
        self.t = 1000.0

    def now(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += dt


def _make_supervisor(
    proc: _MockProcess,
    clock: _Clock,
    *,
    emitted: list[dict] | None = None,
    soft: float = 5.0,
    term: float = 10.0,
    kill: float = 20.0,
) -> ProcessHeartbeatSupervisor:
    return ProcessHeartbeatSupervisor(
        proc,
        run_id="run-test",
        emit_event=(emitted.append if emitted is not None else None),
        soft_sec=soft,
        term_sec=term,
        kill_sec=kill,
        time_fn=clock.now,
    )


def test_below_soft_no_action() -> None:
    proc = _MockProcess()
    clock = _Clock()
    emitted: list[dict] = []
    sup = _make_supervisor(proc, clock, emitted=emitted)
    clock.advance(4.0)
    sup.tick()
    assert not sup.soft_fired
    assert not sup.term_fired
    assert not sup.kill_fired
    assert emitted == []
    assert proc.terminate_calls == 0
    assert proc.kill_calls == 0


def test_soft_fires_once_and_emits_stalled_event() -> None:
    proc = _MockProcess()
    clock = _Clock()
    emitted: list[dict] = []
    sup = _make_supervisor(proc, clock, emitted=emitted)
    clock.advance(5.0)
    sup.tick()
    assert sup.soft_fired
    assert not sup.term_fired
    assert not sup.kill_fired
    assert len(emitted) == 1
    ev = emitted[0]
    assert ev["type"] == "run.heartbeat.stalled"
    assert ev["runId"] == "run-test"
    assert ev["elapsedSec"] >= 5.0

    # Idempotency: re-ticking at the same elapsed does not re-emit.
    sup.tick()
    assert len(emitted) == 1


def test_term_level_calls_terminate() -> None:
    proc = _MockProcess()
    clock = _Clock()
    sup = _make_supervisor(proc, clock)
    clock.advance(10.0)
    sup.tick()
    # The supervisor fires the highest-applicable level on a single tick. Soft is skipped when the
    # observed gap already exceeds the term threshold.
    assert not sup.soft_fired
    assert sup.term_fired
    assert proc.terminate_calls == 1
    assert proc.kill_calls == 0
    # Another tick before kill threshold must not double-terminate.
    sup.tick()
    assert proc.terminate_calls == 1


def test_kill_level_calls_kill() -> None:
    proc = _MockProcess()
    clock = _Clock()
    sup = _make_supervisor(proc, clock)
    clock.advance(20.0)
    sup.tick()
    assert sup.kill_fired
    assert proc.kill_calls == 1
    assert proc.terminate_calls == 0  # tick skipped to kill directly


def test_heartbeat_resets_timer() -> None:
    proc = _MockProcess()
    clock = _Clock()
    emitted: list[dict] = []
    sup = _make_supervisor(proc, clock, emitted=emitted)
    clock.advance(4.0)
    sup.heartbeat()
    clock.advance(4.0)
    sup.tick()
    assert not sup.soft_fired
    assert emitted == []


def test_no_action_when_process_already_exited() -> None:
    proc = _MockProcess()
    proc.set_exit(0)
    clock = _Clock()
    sup = _make_supervisor(proc, clock)
    clock.advance(60.0)
    sup.tick()
    assert not sup.soft_fired
    assert not sup.term_fired
    assert not sup.kill_fired


def test_invalid_timeouts_rejected() -> None:
    proc = _MockProcess()
    with pytest.raises(ValueError):
        ProcessHeartbeatSupervisor(proc, soft_sec=10.0, term_sec=5.0, kill_sec=20.0)
    with pytest.raises(ValueError):
        ProcessHeartbeatSupervisor(proc, soft_sec=1.0, term_sec=2.0, kill_sec=2.0)


def test_env_overrides_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_HEARTBEAT_SOFT_SEC", "2.0")
    monkeypatch.setenv("GC_HEARTBEAT_TERM_SEC", "4.0")
    monkeypatch.setenv("GC_HEARTBEAT_KILL_SEC", "8.0")
    proc = _MockProcess()
    clock = _Clock()
    sup = ProcessHeartbeatSupervisor(proc, time_fn=clock.now)
    clock.advance(2.0)
    sup.tick()
    assert sup.soft_fired
    clock.advance(2.0)  # total 4
    sup.tick()
    assert sup.term_fired
    clock.advance(4.0)  # total 8
    sup.tick()
    assert sup.kill_fired


def test_background_thread_observes_stall_and_terminates() -> None:
    """Real thread + short timeouts: verifies the supervisor's polling loop drives escalation."""
    proc = _MockProcess()
    sup = ProcessHeartbeatSupervisor(
        proc,
        run_id="run-bg",
        soft_sec=0.05,
        term_sec=0.10,
        kill_sec=0.20,
        poll_interval_sec=0.01,
    )
    sup.start()
    # Wait long enough for kill to fire.
    for _ in range(200):
        if sup.kill_fired:
            break
        threading.Event().wait(0.01)
    sup.stop(timeout=1.0)
    assert sup.soft_fired
    assert sup.term_fired
    assert sup.kill_fired
    assert proc.kill_calls == 1
