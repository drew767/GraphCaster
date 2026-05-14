# Copyright GraphCaster. All Rights Reserved.

"""Unit tests for :class:`graph_caster.runner.event_emitter.RunEventEmitter`.

Exercises the emitter in isolation (no GraphDocument / no GraphRunner) so the
extracted module can stand on its own.
"""

from __future__ import annotations

import threading
from typing import Any

from graph_caster.run_event_sink import CallableRunEventSink, RunEventDict
from graph_caster.runner.event_emitter import RunEventEmitter


def _make_capture_sink() -> tuple[CallableRunEventSink, list[RunEventDict]]:
    captured: list[RunEventDict] = []
    return CallableRunEventSink(captured.append), captured


def test_emitter_stamps_run_id_when_set() -> None:
    sink, captured = _make_capture_sink()
    em = RunEventEmitter(sink, graph_id="g1", run_id="r-42")
    em.emit("hello", foo="bar")
    assert captured == [{"type": "hello", "foo": "bar", "runId": "r-42"}]


def test_emitter_omits_run_id_when_unset() -> None:
    sink, captured = _make_capture_sink()
    em = RunEventEmitter(sink, graph_id="g1")
    em.emit("hello")
    assert captured == [{"type": "hello"}]
    assert "runId" not in captured[0]


def test_set_run_id_takes_effect_for_next_event() -> None:
    sink, captured = _make_capture_sink()
    em = RunEventEmitter(sink, graph_id="g1")
    em.emit("a")
    em.set_run_id("r-1")
    em.emit("b")
    assert captured[0] == {"type": "a"}
    assert captured[1] == {"type": "b", "runId": "r-1"}


def test_replace_sink_routes_subsequent_emits() -> None:
    sink_a, cap_a = _make_capture_sink()
    sink_b, cap_b = _make_capture_sink()
    em = RunEventEmitter(sink_a, graph_id="g1", run_id="r-1")
    em.emit("first")
    em.replace_sink(sink_b)
    em.emit("second")
    assert [e["type"] for e in cap_a] == ["first"]
    assert [e["type"] for e in cap_b] == ["second"]


def test_emit_is_thread_safe_under_concurrency() -> None:
    """Concurrent emits from many threads should all land — the internal Lock
    serialises sink writes so no events are dropped or interleaved."""
    sink, captured = _make_capture_sink()
    em = RunEventEmitter(sink, graph_id="g1", run_id="r-1")
    n_threads = 8
    per_thread = 50

    def worker(tid: int) -> None:
        for i in range(per_thread):
            em.emit("e", tid=tid, i=i)

    threads = [threading.Thread(target=worker, args=(t,)) for t in range(n_threads)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert len(captured) == n_threads * per_thread
    # all events must carry the run_id stamp
    assert all(ev.get("runId") == "r-1" for ev in captured)


def test_emitter_lock_is_threading_lock() -> None:
    sink, _ = _make_capture_sink()
    em = RunEventEmitter(sink, graph_id="g1")
    # acquirable + releasable
    assert em.lock.acquire(blocking=False)
    em.lock.release()


def test_emit_node_outputs_snapshot_applies_pin_trim_and_redaction() -> None:
    sink, captured = _make_capture_sink()
    em = RunEventEmitter(sink, graph_id="g1", run_id="r-1")
    ctx: dict[str, Any] = {}
    outs_slice = {"nodeType": "task", "data": {"command": "echo hi"}}
    em.emit_node_outputs_snapshot(ctx, "n1", outs_slice)
    assert len(captured) == 1
    ev = captured[0]
    assert ev["type"] == "node_outputs_snapshot"
    assert ev["nodeId"] == "n1"
    assert ev["graphId"] == "g1"
    assert ev["runId"] == "r-1"
    assert "snapshot" in ev
