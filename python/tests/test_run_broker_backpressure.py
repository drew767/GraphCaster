# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import queue
import threading
import time

from graph_caster.run_broker.broadcaster import (
    FanOutMsg,
    RunBroadcaster,
    RunBroadcasterConfig,
)


def _process_out_line(seq: int) -> str:
    return json.dumps(
        {
            "type": "process_output",
            "runId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            "nodeId": "t1",
            "graphId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            "stream": "stdout",
            "text": f"x{seq}\n",
            "seq": seq,
        },
        separators=(",", ":"),
    )


def test_broadcaster_drops_process_output_and_emits_stream_backpressure() -> None:
    cfg = RunBroadcasterConfig(max_sub_queue_depth=8, backpressure_emit_interval_sec=0.0)
    b = RunBroadcaster(run_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", config=cfg)
    q = b.subscribe()
    received: list[FanOutMsg] = []
    stop = threading.Event()

    def slow_consumer() -> None:
        while not stop.is_set():
            try:
                m = q.get(timeout=0.1)
            except queue.Empty:
                continue
            received.append(m)
            time.sleep(0.05)

    th = threading.Thread(target=slow_consumer, daemon=True)
    th.start()
    try:
        for i in range(200):
            b.broadcast(FanOutMsg("out", _process_out_line(i)))
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            if any(
                m.kind == "out"
                and "stream_backpressure" in str(m.payload)
                for m in received
            ):
                break
            time.sleep(0.02)
    finally:
        stop.set()
        th.join(timeout=2.0)

    bp_payloads = [
        str(m.payload)
        for m in received
        if m.kind == "out" and "stream_backpressure" in str(m.payload)
    ]
    assert bp_payloads, "expected stream_backpressure in subscriber stream"
    obj = json.loads(bp_payloads[0])
    assert obj["type"] == "stream_backpressure"
    assert obj["runId"] == "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    assert int(obj["droppedOutputLines"]) >= 1


def test_critical_out_line_not_dropped_when_queue_full() -> None:
    cfg = RunBroadcasterConfig(max_sub_queue_depth=2, backpressure_emit_interval_sec=0.0)
    b = RunBroadcaster(run_id="dddddddd-dddd-4ddd-8ddd-dddddddddddd", config=cfg)
    q = b.subscribe()
    crit = json.dumps(
        {
            "type": "run_finished",
            "runId": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            "rootGraphId": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            "status": "success",
            "finishedAt": "2026-03-28T00:00:00+00:00",
        },
        separators=(",", ":"),
    )
    b.broadcast(FanOutMsg("out", _process_out_line(0)))
    b.broadcast(FanOutMsg("out", _process_out_line(1)))
    assert q.full()

    done = threading.Event()

    def blocked_put() -> None:
        b.broadcast(FanOutMsg("out", crit))
        done.set()

    t1 = threading.Thread(target=blocked_put, daemon=True)
    t1.start()
    time.sleep(0.05)
    assert not done.is_set()

    m0 = q.get(timeout=2.0)
    assert "process_output" in str(m0.payload)
    assert done.wait(timeout=2.0)

    m1 = q.get(timeout=2.0)
    m2 = q.get(timeout=2.0)
    assert m1.kind == "out" and "process_output" in str(m1.payload)
    assert m2.kind == "out" and "run_finished" in str(m2.payload)
    t1.join(timeout=2.0)


def test_plain_text_stdout_line_is_droppable_when_queue_full() -> None:
    cfg = RunBroadcasterConfig(max_sub_queue_depth=1, backpressure_emit_interval_sec=0.0)
    b = RunBroadcaster(run_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", config=cfg)
    q = b.subscribe()
    b.broadcast(FanOutMsg("out", _process_out_line(0)))
    assert q.full()
    done = threading.Event()

    def send_plain() -> None:
        b.broadcast(FanOutMsg("out", "plain log line without json"))
        done.set()

    th = threading.Thread(target=send_plain, daemon=True)
    th.start()
    assert done.wait(timeout=2.0)
    th.join(timeout=2.0)


def test_malformed_json_stdout_line_is_droppable_when_queue_full() -> None:
    cfg = RunBroadcasterConfig(max_sub_queue_depth=1, backpressure_emit_interval_sec=0.0)
    b = RunBroadcaster(run_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", config=cfg)
    q = b.subscribe()
    b.broadcast(FanOutMsg("out", _process_out_line(0)))
    assert q.full()
    done = threading.Event()

    def send_bad() -> None:
        b.broadcast(FanOutMsg("out", '{"type":'))
        done.set()

    th = threading.Thread(target=send_bad, daemon=True)
    th.start()
    assert done.wait(timeout=2.0)
    th.join(timeout=2.0)


def test_sub_queue_depth_zero_uses_minimum_bounded_queue() -> None:
    cfg = RunBroadcasterConfig(max_sub_queue_depth=0, backpressure_emit_interval_sec=0.0)
    b = RunBroadcaster(run_id="00000000-0000-4000-8000-000000000000", config=cfg)
    q = b.subscribe()
    assert getattr(q, "maxsize", None) == 1


def test_critical_out_reaches_second_subscriber_while_first_blocks() -> None:
    cfg = RunBroadcasterConfig(max_sub_queue_depth=2, backpressure_emit_interval_sec=0.0)
    b = RunBroadcaster(run_id="ffffffff-ffff-4fff-8fff-ffffffffffff", config=cfg)
    q_block = b.subscribe()
    q_clear = b.subscribe()
    b.broadcast(FanOutMsg("out", _process_out_line(0)))
    b.broadcast(FanOutMsg("out", _process_out_line(1)))
    assert q_block.full() and q_clear.full()
    q_clear.get(timeout=2.0)
    q_clear.get(timeout=2.0)
    assert q_clear.empty()
    b.broadcast(FanOutMsg("out", _process_out_line(2)))
    crit = json.dumps(
        {
            "type": "run_finished",
            "runId": "ffffffff-ffff-4fff-8fff-ffffffffffff",
            "rootGraphId": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            "status": "success",
            "finishedAt": "2026-03-28T00:00:00+00:00",
        },
        separators=(",", ":"),
    )

    done = threading.Event()

    def broadcast_crit() -> None:
        b.broadcast(FanOutMsg("out", crit))
        done.set()

    th = threading.Thread(target=broadcast_crit, daemon=True)
    th.start()
    time.sleep(0.05)
    m_po = q_clear.get(timeout=2.0)
    assert "process_output" in str(m_po.payload)
    m_fin = q_clear.get(timeout=2.0)
    assert "run_finished" in str(m_fin.payload)
    q_block.get(timeout=2.0)
    q_block.get(timeout=2.0)
    m_fin_b = q_block.get(timeout=2.0)
    assert "run_finished" in str(m_fin_b.payload)
    assert done.wait(timeout=2.0)
    th.join(timeout=2.0)
