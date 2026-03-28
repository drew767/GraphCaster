# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import threading

from graph_caster.run_event_sink import (
    CallableRunEventSink,
    NdjsonAppendFileSink,
    NdjsonStdoutSink,
    NullRunEventSink,
    TeeRunEventSink,
    normalize_run_event_sink,
)


def test_ndjson_stdout_sink_two_events() -> None:
    buf: list[str] = []

    def write(s: str) -> None:
        buf.append(s)

    sink = NdjsonStdoutSink(write, flush=None)
    sink.emit({"type": "a", "x": 1})
    sink.emit({"type": "b", "y": 2})
    assert len(buf) == 2
    assert json.loads(buf[0]) == {"type": "a", "x": 1}
    assert json.loads(buf[1]) == {"type": "b", "y": 2}


def test_normalize_callable_wraps() -> None:
    seen: list[dict] = []

    def fn(ev: dict) -> None:
        seen.append(ev)

    s = normalize_run_event_sink(fn)
    s.emit({"type": "t"})
    assert seen == [{"type": "t"}]


def test_callable_run_event_sink() -> None:
    out: list[dict] = []
    CallableRunEventSink(out.append).emit({"k": 1})
    assert out == [{"k": 1}]


def test_normalize_none_yields_null_sink() -> None:
    s = normalize_run_event_sink(None)
    assert isinstance(s, NullRunEventSink)
    s.emit({"type": "x"})


def test_tee_run_event_sink_fanout() -> None:
    a: list[dict] = []
    b: list[dict] = []
    sink = TeeRunEventSink(CallableRunEventSink(a.append), CallableRunEventSink(b.append))
    sink.emit({"type": "x"})
    assert a == [{"type": "x"}]
    assert b == [{"type": "x"}]


def test_tee_concurrent_emit_serializes_writes(tmp_path) -> None:
    p = tmp_path / "events.ndjson"
    primary: list[str] = []

    def write(s: str) -> None:
        primary.append(s)

    file_sink = NdjsonAppendFileSink(p)
    tee = TeeRunEventSink(NdjsonStdoutSink(write, flush=None), file_sink)
    n = 200

    def worker(start: int, end: int) -> None:
        for i in range(start, end):
            tee.emit({"type": "e", "i": i})

    t1 = threading.Thread(target=worker, args=(0, n // 2))
    t2 = threading.Thread(target=worker, args=(n // 2, n))
    t1.start()
    t2.start()
    t1.join()
    t2.join()
    file_sink.close()
    lines = [ln for ln in p.read_text(encoding="utf-8").strip().split("\n") if ln.strip()]
    assert len(lines) == n
    for line in lines:
        json.loads(line)


def test_tee_swallows_secondary_oserror() -> None:
    seen: list[dict] = []

    class Flaky:
        def emit(self, event: dict) -> None:
            _ = event
            raise OSError("disk full")

    sink = TeeRunEventSink(CallableRunEventSink(seen.append), Flaky())
    sink.emit({"k": 1})
    assert seen == [{"k": 1}]


def test_ndjson_append_file_sink_writes_lines(tmp_path) -> None:
    p = tmp_path / "e.ndjson"
    s = NdjsonAppendFileSink(p)
    s.emit({"type": "a"})
    s.emit({"type": "b"})
    s.close()
    lines = p.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 2
    assert json.loads(lines[0]) == {"type": "a"}
    assert json.loads(lines[1]) == {"type": "b"}


def test_ndjson_stdout_sink_invokes_flush_per_emit() -> None:
    buf: list[str] = []
    flushes = 0

    def write(s: str) -> None:
        buf.append(s)

    def flush() -> None:
        nonlocal flushes
        flushes += 1

    sink = NdjsonStdoutSink(write, flush=flush)
    sink.emit({"type": "a"})
    sink.emit({"type": "b"})
    assert flushes == 2
    assert len(buf) == 2
