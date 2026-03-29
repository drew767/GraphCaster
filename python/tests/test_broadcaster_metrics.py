# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.run_broker.broadcaster import FanOutMsg, RunBroadcaster, RunBroadcasterConfig


def test_broadcaster_metrics_count_subscribers_and_drops() -> None:
    bc = RunBroadcaster("run-x", config=RunBroadcasterConfig(max_sub_queue_depth=2))
    q1 = bc.subscribe()
    q2 = bc.subscribe()
    m0 = bc.metrics_snapshot()
    assert m0["subscribers"] == 2
    assert m0["droppableOutputDrops"] == 0
    # Fill both queues with droppable stdout lines
    for _ in range(3):
        bc.broadcast(FanOutMsg("out", "plain line\n"))
    m1 = bc.metrics_snapshot()
    assert m1["droppableOutputDrops"] >= 1
    bc.unsubscribe(q1)
    bc.unsubscribe(q2)
    assert bc.metrics_snapshot()["subscribers"] == 0
