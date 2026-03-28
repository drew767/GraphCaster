# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json
import queue
import threading
import time
from dataclasses import dataclass, field
from typing import Literal

FanKind = Literal["out", "err", "exit"]


@dataclass(frozen=True)
class FanOutMsg:
    kind: FanKind
    payload: str | int


@dataclass
class RunBroadcasterConfig:
    max_sub_queue_depth: int = 8192
    backpressure_emit_interval_sec: float = 0.1


@dataclass
class _SubscriberSlot:
    queue: queue.Queue[FanOutMsg]
    dropped_since_emit: int = 0
    last_emit_mono: float = 0.0
    bp_lock: threading.Lock = field(default_factory=threading.Lock)


def _is_droppable_out_line(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    if "process_output" not in s:
        return False
    try:
        obj = json.loads(s)
    except json.JSONDecodeError:
        return False
    if not isinstance(obj, dict):
        return False
    return obj.get("type") == "process_output"


def _stream_backpressure_line(run_id: str, dropped: int) -> str:
    return json.dumps(
        {
            "type": "stream_backpressure",
            "runId": run_id,
            "droppedOutputLines": dropped,
            "reason": "subscriber_queue_full",
        },
        separators=(",", ":"),
    )


class RunBroadcaster:
    _BACKPRESSURE_PUT_TIMEOUT_SEC = 0.35

    def __init__(self, run_id: str, config: RunBroadcasterConfig | None = None) -> None:
        self._run_id = run_id
        cfg = config if config is not None else RunBroadcasterConfig()
        self._config = RunBroadcasterConfig(
            max_sub_queue_depth=max(1, cfg.max_sub_queue_depth),
            backpressure_emit_interval_sec=cfg.backpressure_emit_interval_sec,
        )
        self._subs: list[_SubscriberSlot] = []
        self._lock = threading.Lock()

    def subscribe(self) -> queue.Queue[FanOutMsg]:
        q: queue.Queue[FanOutMsg] = queue.Queue(maxsize=self._config.max_sub_queue_depth)
        slot = _SubscriberSlot(queue=q)
        with self._lock:
            self._subs.append(slot)
        return q

    def unsubscribe(self, q: queue.Queue[FanOutMsg]) -> None:
        with self._lock:
            for i, slot in enumerate(self._subs):
                if slot.queue is q:
                    self._subs.pop(i)
                    return

    def _maybe_emit_backpressure(self, sub: _SubscriberSlot) -> None:
        with sub.bp_lock:
            if sub.dropped_since_emit <= 0:
                return
            now = time.monotonic()
            ival = self._config.backpressure_emit_interval_sec
            if ival > 0.0 and now - sub.last_emit_mono < ival:
                return
            n = sub.dropped_since_emit
            sub.dropped_since_emit = 0
            prev_last = sub.last_emit_mono
            sub.last_emit_mono = now
            warn = FanOutMsg("out", _stream_backpressure_line(self._run_id, n))
        try:
            sub.queue.put_nowait(warn)
        except queue.Full:
            try:
                sub.queue.put(warn, timeout=self._BACKPRESSURE_PUT_TIMEOUT_SEC)
            except queue.Full:
                with sub.bp_lock:
                    sub.dropped_since_emit += n
                    sub.last_emit_mono = prev_last

    def _deliver_to_sub(self, sub: _SubscriberSlot, msg: FanOutMsg, droppable: bool) -> None:
        if msg.kind != "out" or not droppable:
            sub.queue.put(msg)
            return
        try:
            sub.queue.put_nowait(msg)
        except queue.Full:
            with sub.bp_lock:
                sub.dropped_since_emit += 1
            self._maybe_emit_backpressure(sub)

    def broadcast(self, msg: FanOutMsg) -> None:
        droppable = False
        if msg.kind == "out":
            droppable = _is_droppable_out_line(str(msg.payload))
        with self._lock:
            subs = list(self._subs)
        if len(subs) <= 1:
            for sub in subs:
                self._deliver_to_sub(sub, msg, droppable)
            return
        threads: list[threading.Thread] = []
        for sub in subs:
            t = threading.Thread(
                target=self._deliver_to_sub,
                args=(sub, msg, droppable),
                daemon=False,
            )
            t.start()
            threads.append(t)
        for t in threads:
            t.join()

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
                    yield f"event: exit\ndata: {json.dumps({'code': msg.payload})}\n\n"
                    break
        finally:
            self.unsubscribe(q)
