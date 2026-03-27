# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json

from graph_caster.run_event_sink import (
    CallableRunEventSink,
    NdjsonStdoutSink,
    NullRunEventSink,
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
