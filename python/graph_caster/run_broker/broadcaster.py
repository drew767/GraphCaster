# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import queue
import threading
from dataclasses import dataclass
from typing import Literal

FanKind = Literal["out", "err", "exit"]


@dataclass(frozen=True)
class FanOutMsg:
    kind: FanKind
    payload: str | int


class RunBroadcaster:
    def __init__(self) -> None:
        self._subs: list[queue.Queue[FanOutMsg]] = []
        self._lock = threading.Lock()

    def subscribe(self) -> queue.Queue[FanOutMsg]:
        q: queue.Queue[FanOutMsg] = queue.Queue()
        with self._lock:
            self._subs.append(q)
        return q

    def unsubscribe(self, q: queue.Queue[FanOutMsg]) -> None:
        with self._lock:
            if q in self._subs:
                self._subs.remove(q)

    def broadcast(self, msg: FanOutMsg) -> None:
        with self._lock:
            subs = list(self._subs)
        for s in subs:
            s.put(msg)

    async def stream_queue(self, q: queue.Queue[FanOutMsg]):
        try:
            while True:
                msg = await asyncio.to_thread(q.get)
                if msg.kind == "out":
                    line = str(msg.payload)
                    for segment in line.split("\n"):
                        yield f"data: {segment}\n"
                    yield "\n"
                elif msg.kind == "err":
                    yield f"event: err\ndata: {msg.payload}\n\n"
                elif msg.kind == "exit":
                    import json

                    yield f"event: exit\ndata: {json.dumps({'code': msg.payload})}\n\n"
                    break
        finally:
            self.unsubscribe(q)
