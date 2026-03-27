# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from collections.abc import Callable
from typing import Any, Protocol, runtime_checkable

RunEventDict = dict[str, Any]


@runtime_checkable
class RunEventSink(Protocol):
    """Receives run events from GraphRunner. Not thread-safe unless the implementation says otherwise."""

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


def normalize_run_event_sink(sink: RunEventSink | Callable[[RunEventDict], None] | None) -> RunEventSink:
    if sink is None:
        return NullRunEventSink()
    if isinstance(sink, RunEventSink):
        return sink
    return CallableRunEventSink(sink)
