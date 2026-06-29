# Copyright GraphCaster. All Rights Reserved.

"""Sequence-aware reconnect: server-side ring buffer + since_seq replay."""

from __future__ import annotations

import json

from graph_caster.run_broker.broadcaster import (
    FanOutMsg,
    RunBroadcaster,
    RunBroadcasterConfig,
)


def _out_line(seq_value: int) -> str:
    return json.dumps(
        {
            "type": "process_output",
            "runId": "rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr",
            "nodeId": "n1",
            "graphId": "gggggggg-gggg-4ggg-8ggg-gggggggggggg",
            "stream": "stdout",
            "text": f"line {seq_value}",
        },
        separators=(",", ":"),
    )


def _parse_seq(payload: str) -> int:
    return int(json.loads(payload)["seq"])


def test_replay_returns_messages_after_since_seq() -> None:
    """After broadcasting N messages, replay_since(k) yields seq > k in order."""
    cfg = RunBroadcasterConfig(max_sub_queue_depth=64, replay_buffer_size=32)
    b = RunBroadcaster(run_id="rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr", config=cfg)

    # Broadcast 5 messages; they get stamped seq=1..5.
    for i in range(5):
        b.broadcast(FanOutMsg("out", _out_line(i)))

    # Late subscriber asks for seq > 2 → expects 3, 4, 5.
    replay = b.replay_since(2)
    assert len(replay) == 3
    assert [_parse_seq(str(m.payload)) for m in replay] == [3, 4, 5]


def test_replay_buffer_caps_oldest_eviction() -> None:
    """When the ring buffer caps out, oldest entries fall off but the rest are intact."""
    cfg = RunBroadcasterConfig(max_sub_queue_depth=64, replay_buffer_size=4)
    b = RunBroadcaster(run_id="rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr", config=cfg)

    for i in range(10):  # seq 1..10
        b.broadcast(FanOutMsg("out", _out_line(i)))

    # Buffer holds only the last 4 (seq 7..10).
    replay_all = b.replay_since(0)
    assert [_parse_seq(str(m.payload)) for m in replay_all] == [7, 8, 9, 10]

    # Asking from since_seq=8 should drop 7..8 and keep 9, 10.
    replay_late = b.replay_since(8)
    assert [_parse_seq(str(m.payload)) for m in replay_late] == [9, 10]


def test_subscribe_with_replay_atomic_snapshot() -> None:
    """Reconnect after delivery of seq=1..5 sees missed events 4..5 then live 6.

    Critically: the snapshot is captured atomically with subscriber registration
    so we don't double-deliver events that arrive between the two ops.
    """
    cfg = RunBroadcasterConfig(max_sub_queue_depth=64, replay_buffer_size=32)
    b = RunBroadcaster(run_id="rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr", config=cfg)

    # Initial subscriber processes 1..3 then disconnects with lastSeq=3.
    q_initial = b.subscribe()
    for i in range(3):  # seq 1..3
        b.broadcast(FanOutMsg("out", _out_line(i)))
    drained = [_parse_seq(str(q_initial.get(timeout=1.0).payload)) for _ in range(3)]
    assert drained == [1, 2, 3]
    b.unsubscribe(q_initial)

    # Server keeps broadcasting (seq 4..5) while client is offline.
    for i in range(3, 5):  # seq 4..5
        b.broadcast(FanOutMsg("out", _out_line(i)))

    # Reconnect: snapshot replay (4..5), then live seq=6.
    q_new, replay = b.subscribe_with_replay(since_seq=3)
    replay_seqs = [_parse_seq(str(m.payload)) for m in replay]
    assert replay_seqs == [4, 5]

    b.broadcast(FanOutMsg("out", _out_line(5)))  # seq 6
    live = q_new.get(timeout=1.0)
    assert _parse_seq(str(live.payload)) == 6


def test_replay_disabled_returns_empty() -> None:
    """When replay buffer size = 0, replay APIs return empty lists (feature off)."""
    cfg = RunBroadcasterConfig(max_sub_queue_depth=64, replay_buffer_size=0)
    b = RunBroadcaster(run_id="rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr", config=cfg)
    for i in range(5):
        b.broadcast(FanOutMsg("out", _out_line(i)))
    assert b.replay_since(0) == []
    _, replay = b.subscribe_with_replay(since_seq=0)
    assert replay == []


def test_backpressure_payload_includes_dropped_since_last_notify() -> None:
    """The stream_backpressure JSON must carry droppedSinceLastNotify."""
    import queue as _queue
    import threading
    import time

    cfg = RunBroadcasterConfig(
        max_sub_queue_depth=4,
        backpressure_emit_interval_sec=0.0,
        replay_buffer_size=0,
    )
    b = RunBroadcaster(run_id="rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrrr", config=cfg)
    q = b.subscribe()

    received: list[FanOutMsg] = []
    stop = threading.Event()

    def slow_consumer() -> None:
        while not stop.is_set():
            try:
                m = q.get(timeout=0.1)
            except _queue.Empty:
                continue
            received.append(m)
            time.sleep(0.02)

    th = threading.Thread(target=slow_consumer, daemon=True)
    th.start()
    try:
        for i in range(120):
            b.broadcast(FanOutMsg("out", _out_line(i)))
        deadline = time.monotonic() + 4.0
        while time.monotonic() < deadline:
            if any(
                m.kind == "out" and "stream_backpressure" in str(m.payload)
                for m in received
            ):
                break
            time.sleep(0.02)
    finally:
        stop.set()
        th.join(timeout=2.0)

    bp = next(
        (m for m in received if m.kind == "out" and "stream_backpressure" in str(m.payload)),
        None,
    )
    assert bp is not None, "backpressure notification not delivered"
    obj = json.loads(str(bp.payload))
    assert obj["type"] == "stream_backpressure"
    assert obj["droppedSinceLastNotify"] >= 1
    assert obj["droppedOutputLines"] == obj["droppedSinceLastNotify"]
