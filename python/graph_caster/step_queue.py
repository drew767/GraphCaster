# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from collections import deque
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ExecutionFrame:
    """One node visit scheduled in the synchronous runner loop (Dify-style ready step, single-threaded)."""

    node_id: str


class StepQueue:
    __slots__ = ("_q",)

    def __init__(self, start_node_id: str) -> None:
        self._q: deque[ExecutionFrame] = deque((ExecutionFrame(start_node_id),))

    def __bool__(self) -> bool:
        return bool(self._q)

    def popleft(self) -> ExecutionFrame:
        return self._q.popleft()

    def append(self, frame: ExecutionFrame) -> None:
        self._q.append(frame)
