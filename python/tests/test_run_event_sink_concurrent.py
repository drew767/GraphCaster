# Copyright GraphCaster. All Rights Reserved.

"""Concurrency tests for run-event-sink classes."""

from __future__ import annotations

import json
import threading

from graph_caster.run_event_sink import NdjsonAppendFileSink


def test_ndjson_append_file_sink_concurrent_8_threads(tmp_path) -> None:
    """8 threads x 100 events = 800 well-formed JSON lines, no partials, no truncations."""
    p = tmp_path / "events.ndjson"
    sink = NdjsonAppendFileSink(p)

    n_threads = 8
    per_thread = 100
    barrier = threading.Barrier(n_threads)

    def worker(tid: int) -> None:
        barrier.wait()
        for i in range(per_thread):
            sink.emit({"type": "e", "tid": tid, "i": i})

    threads = [threading.Thread(target=worker, args=(t,)) for t in range(n_threads)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()

    sink.close()

    text = p.read_text(encoding="utf-8")
    lines = [ln for ln in text.split("\n") if ln]
    assert len(lines) == n_threads * per_thread

    by_tid: dict[int, set[int]] = {}
    for ln in lines:
        obj = json.loads(ln)
        assert obj["type"] == "e"
        by_tid.setdefault(obj["tid"], set()).add(obj["i"])

    assert len(by_tid) == n_threads
    for tid, seen in by_tid.items():
        assert seen == set(range(per_thread)), f"tid={tid} missing or duplicated entries"


def test_ndjson_append_file_sink_close_is_thread_safe(tmp_path) -> None:
    """close() while another thread is mid-emit should not crash; either the late emit completes or
    re-opens the file (any safe outcome) and the file remains a valid NDJSON stream."""
    p = tmp_path / "events.ndjson"
    sink = NdjsonAppendFileSink(p)
    sink.emit({"type": "warmup"})

    n = 64
    started = threading.Event()
    closed = threading.Event()

    def emitter() -> None:
        started.set()
        for i in range(n):
            try:
                sink.emit({"type": "x", "i": i})
            except ValueError:
                # File closed beneath us — acceptable, lock still serializes calls.
                return

    def closer() -> None:
        started.wait()
        sink.close()
        closed.set()

    th_e = threading.Thread(target=emitter)
    th_c = threading.Thread(target=closer)
    th_e.start()
    th_c.start()
    th_e.join()
    th_c.join()

    assert closed.is_set()
    # File must still be parseable line-by-line.
    for ln in p.read_text(encoding="utf-8").split("\n"):
        if not ln:
            continue
        json.loads(ln)
