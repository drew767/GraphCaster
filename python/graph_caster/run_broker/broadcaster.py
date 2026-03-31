# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import atexit
import json
import logging
import queue
import threading
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, wait as futures_wait
from dataclasses import dataclass, field
from typing import Literal

from .bounded_queue import MessagePriority, PriorityBoundedQueue
from .sequence_generator import SequenceGenerator

_LOG = logging.getLogger(__name__)

_DELIVER_POOL = ThreadPoolExecutor(max_workers=16, thread_name_prefix="gc_bcast")


def _shutdown_deliver_pool() -> None:
    try:
        _DELIVER_POOL.shutdown(wait=False, cancel_futures=True)
    except TypeError:
        _DELIVER_POOL.shutdown(wait=False)


atexit.register(_shutdown_deliver_pool)

FanKind = Literal["out", "err", "exit"]


@dataclass(frozen=True)
class FanOutMsg:
    kind: FanKind
    payload: str | int


@dataclass
class RunBroadcasterConfig:
    max_sub_queue_depth: int = 8192
    backpressure_emit_interval_sec: float = 0.1
    use_priority_queue: bool = False


SubscriberQueue = queue.Queue[FanOutMsg] | PriorityBoundedQueue[FanOutMsg]


@dataclass
class _SubscriberSlot:
    queue: SubscriberQueue
    dropped_since_emit: int = 0
    last_emit_mono: float = 0.0
    bp_lock: threading.Lock = field(default_factory=threading.Lock)


def _is_droppable_out_line(line: str) -> bool:
    """True for process_output, invalid/unknown stdout lines; False for structured run events."""
    s = line.strip()
    if not s:
        return False
    if not s.startswith("{"):
        return True
    try:
        obj = json.loads(s)
    except json.JSONDecodeError:
        return True
    if not isinstance(obj, dict):
        return True
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


def _out_priority_for_delivery(msg: FanOutMsg, droppable: bool) -> MessagePriority:
    if msg.kind == "exit":
        return MessagePriority.CRITICAL
    if msg.kind == "err":
        return MessagePriority.HIGH
    if msg.kind == "out":
        if droppable:
            return MessagePriority.LOW
        return MessagePriority.NORMAL
    return MessagePriority.NORMAL


class RunBroadcaster:
    _BACKPRESSURE_PUT_TIMEOUT_SEC = 0.35

    def __init__(
        self,
        run_id: str,
        config: RunBroadcasterConfig | None = None,
        *,
        relay_fanout_hook: Callable[[FanOutMsg], None] | None = None,
    ) -> None:
        self._run_id = run_id
        cfg = config if config is not None else RunBroadcasterConfig()
        self._config = RunBroadcasterConfig(
            max_sub_queue_depth=max(1, cfg.max_sub_queue_depth),
            backpressure_emit_interval_sec=cfg.backpressure_emit_interval_sec,
            use_priority_queue=cfg.use_priority_queue,
        )
        self._subs: list[_SubscriberSlot] = []
        self._lock = threading.Lock()
        self._metrics_lock = threading.Lock()
        self._droppable_output_drops = 0
        self._relay_fanout_hook = relay_fanout_hook
        self._seq_gen = SequenceGenerator()

    def _stamp_json_out(self, msg: FanOutMsg) -> FanOutMsg:
        """Attach monotonic ``seq`` to JSON object payloads on the ``out`` channel."""
        if msg.kind != "out" or not isinstance(msg.payload, str):
            return msg
        payload_str = msg.payload.strip()
        if not payload_str.startswith("{"):
            return msg
        try:
            obj = json.loads(payload_str)
        except json.JSONDecodeError:
            return msg
        obj["seq"] = self._seq_gen.next_seq()
        stamped_payload = json.dumps(obj, separators=(",", ":"))
        return FanOutMsg(msg.kind, stamped_payload)

    def subscribe(self) -> SubscriberQueue:
        if self._config.use_priority_queue:
            q: SubscriberQueue = PriorityBoundedQueue(maxsize=self._config.max_sub_queue_depth)
        else:
            q = queue.Queue(maxsize=self._config.max_sub_queue_depth)
        slot = _SubscriberSlot(queue=q)
        with self._lock:
            self._subs.append(slot)
        return q

    def unsubscribe(self, q: SubscriberQueue) -> None:
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
        if isinstance(sub.queue, PriorityBoundedQueue):
            dropped = sub.queue.try_put(warn, MessagePriority.HIGH)
            if dropped:
                try:
                    sub.queue.put(warn, MessagePriority.HIGH, timeout=self._BACKPRESSURE_PUT_TIMEOUT_SEC)
                except TimeoutError:
                    with sub.bp_lock:
                        sub.dropped_since_emit += n
                        sub.last_emit_mono = prev_last
            return
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
        pq = sub.queue
        if isinstance(pq, PriorityBoundedQueue):
            prio = _out_priority_for_delivery(msg, droppable)
            if msg.kind == "out" and droppable:
                dropped = pq.try_put(msg, prio)
                if dropped:
                    with self._metrics_lock:
                        self._droppable_output_drops += 1
                    with sub.bp_lock:
                        sub.dropped_since_emit += 1
                    self._maybe_emit_backpressure(sub)
                return
            pq.try_put(msg, prio)
            return
        if msg.kind != "out" or not droppable:
            pq.put(msg)
            return
        try:
            pq.put_nowait(msg)
        except queue.Full:
            with self._metrics_lock:
                self._droppable_output_drops += 1
            with sub.bp_lock:
                sub.dropped_since_emit += 1
            self._maybe_emit_backpressure(sub)

    def metrics_snapshot(self) -> dict[str, object]:
        """Subscriber count and cumulative droppable stdout line drops (diagnostics)."""
        with self._lock:
            n_subs = len(self._subs)
        with self._metrics_lock:
            drops = self._droppable_output_drops
        return {
            "runId": self._run_id,
            "subscribers": n_subs,
            "droppableOutputDrops": drops,
        }

    def broadcast(self, msg: FanOutMsg) -> None:
        stamped_msg = self._stamp_json_out(msg)
        droppable = False
        if stamped_msg.kind == "out":
            droppable = _is_droppable_out_line(str(stamped_msg.payload))
        with self._lock:
            subs = list(self._subs)
        if len(subs) <= 1:
            for sub in subs:
                self._deliver_to_sub(sub, stamped_msg, droppable)
            if self._relay_fanout_hook is not None:
                try:
                    self._relay_fanout_hook(stamped_msg)
                except Exception:
                    _LOG.debug("relay_fanout_hook failed", exc_info=True)
            return
        futures = [_DELIVER_POOL.submit(self._deliver_to_sub, sub, stamped_msg, droppable) for sub in subs]
        futures_wait(futures)
        if self._relay_fanout_hook is not None:
            try:
                self._relay_fanout_hook(stamped_msg)
            except Exception:
                _LOG.debug("relay_fanout_hook failed", exc_info=True)

    def broadcast_with_priority(
        self,
        msg: FanOutMsg,
        priority: MessagePriority = MessagePriority.NORMAL,
    ) -> None:
        """Broadcast with explicit priority (used when ``use_priority_queue`` is enabled)."""
        stamped_msg = self._stamp_json_out(msg)
        with self._lock:
            subs = list(self._subs)

        for sub in subs:
            if self._config.use_priority_queue and isinstance(sub.queue, PriorityBoundedQueue):
                sub.queue.try_put(stamped_msg, priority)
            else:
                droppable = stamped_msg.kind == "out" and _is_droppable_out_line(str(stamped_msg.payload))
                self._deliver_to_sub(sub, stamped_msg, droppable)

        if self._relay_fanout_hook is not None:
            try:
                self._relay_fanout_hook(stamped_msg)
            except Exception:
                _LOG.debug("relay_fanout_hook failed", exc_info=True)

    async def stream_queue(self, q: SubscriberQueue):
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
