# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.execution.ready_queue import ExecutionFrame, ReadyQueue
from graph_caster.step_queue import ExecutionFrame as EF2, StepQueue


def test_ready_queue_is_step_queue_alias() -> None:
    assert ReadyQueue is StepQueue
    assert ExecutionFrame is EF2
    q = ReadyQueue("n0")
    assert q.popleft() == ExecutionFrame("n0")
