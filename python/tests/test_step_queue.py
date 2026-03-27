# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.step_queue import ExecutionFrame, StepQueue


def test_step_queue_fifo() -> None:
    q = StepQueue("a")
    assert q.popleft() == ExecutionFrame("a")
    q.append(ExecutionFrame("b"))
    q.append(ExecutionFrame("c"))
    assert q.popleft().node_id == "b"
    assert q.popleft().node_id == "c"
    assert not q
