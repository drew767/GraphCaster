# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import threading
from collections.abc import Callable
from pathlib import Path
from typing import IO, Any, Protocol, runtime_checkable

RunEventDict = dict[str, Any]


@runtime_checkable
class RunEventSink(Protocol):
    """Receives run events from GraphRunner.

    Implementations are not thread-safe unless stated otherwise; ``TeeRunEventSink`` serializes ``emit`` with a lock.
    """

    def emit(self, event: RunEventDict) -> None:
        ...


class NullRunEventSink:
    __slots__ = ()

    def emit(self, event: RunEventDict) -> None:
        _ = event


class CallableRunEventSink:
    __slots__ = ("_fn",)

    def __init__(self, fn: Callable[[RunEventDict], None]) -> None:
        self._fn = fn

    def emit(self, event: RunEventDict) -> None:
        self._fn(event)


class NdjsonStdoutSink:
    __slots__ = ("_write", "_flush")

    def __init__(
        self,
        write: Callable[[str], None],
        flush: Callable[[], None] | None = None,
    ) -> None:
        self._write = write
        self._flush = flush

    def emit(self, event: RunEventDict) -> None:
        self._write(json.dumps(event, ensure_ascii=False) + "\n")
        if self._flush is not None:
            self._flush()


class NodeExecutePublicStreamSink:
    """Strip ``data`` from ``node_execute`` events before forwarding (untrusted SSE/WebSocket viewers).

    Does not mutate the incoming ``event`` dict. Full events are still emitted on other sinks (e.g. run
    artifact ``events.ndjson`` via :class:`TeeRunEventSink`) when the runner passes the same object to
    both legs — only the stream leg should be wrapped with this class."""

    __slots__ = ("_inner", "_omit")

    def __init__(self, inner: RunEventSink, *, omit_node_execute_payload: bool) -> None:
        self._inner = inner
        self._omit = bool(omit_node_execute_payload)

    def emit(self, event: RunEventDict) -> None:
        if (
            self._omit
            and event.get("type") == "node_execute"
            and "data" in event
        ):
            public_ev = {k: v for k, v in event.items() if k != "data"}
            self._inner.emit(public_ev)
            return
        self._inner.emit(event)


class TeeRunEventSink:
    """Fan-out: ``a`` is primary (e.g. stdout). ``b`` is best-effort: ``OSError`` from ``b`` is swallowed so a disk
    failure cannot abort the run after ``a`` already received the event.

    ``emit`` is serialized with a lock so concurrent callers (e.g. nested ``graph_ref`` subprocess pump thread vs
    main ``GraphRunner`` thread) cannot interleave writes to ``b`` (e.g. ``NdjsonAppendFileSink``)."""

    __slots__ = ("_a", "_b", "_lock")

    def __init__(self, a: RunEventSink, b: RunEventSink) -> None:
        self._a = a
        self._b = b
        self._lock = threading.Lock()

    def emit(self, event: RunEventDict) -> None:
        with self._lock:
            self._a.emit(event)
            try:
                self._b.emit(event)
            except OSError:
                return


class NdjsonAppendFileSink:
    __slots__ = ("_path", "_encoding", "_file")

    def __init__(self, path: Path, encoding: str = "utf-8") -> None:
        self._path = Path(path)
        self._encoding = encoding
        self._file: IO[str] | None = None

    def emit(self, event: RunEventDict) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(event, ensure_ascii=False) + "\n"
        if self._file is None:
            self._file = self._path.open("a", encoding=self._encoding, newline="\n")
        self._file.write(line)
        self._file.flush()

    def close(self) -> None:
        if self._file is not None:
            self._file.close()
            self._file = None


def normalize_run_event_sink(sink: RunEventSink | Callable[[RunEventDict], None] | None) -> RunEventSink:
    if sink is None:
        return NullRunEventSink()
    if isinstance(sink, RunEventSink):
        return sink
    return CallableRunEventSink(sink)
