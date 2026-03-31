# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import threading
import time

from graph_caster.scaling.concurrency import RunConcurrencyGate


def test_concurrency_gate_serializes_global_limit() -> None:
    gate = RunConcurrencyGate(global_limit=1, per_graph_limit=2)
    out: list[int] = []
    lock = threading.Lock()

    def worker(tag: int) -> None:
        with gate.acquire("g1"):
            with lock:
                out.append(tag)
            time.sleep(0.05)

    t1 = threading.Thread(target=worker, args=(1,))
    t2 = threading.Thread(target=worker, args=(2,))
    t1.start()
    time.sleep(0.01)
    t2.start()
    t1.join()
    t2.join()
    assert out == [1, 2]
