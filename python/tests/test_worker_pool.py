# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import threading
import time

from graph_caster.execution.worker_pool import WorkerPool


def test_worker_pool_executes_tasks_in_parallel() -> None:
    results: list[str] = []

    def slow_task(task_id: str) -> dict[str, str]:
        time.sleep(0.1)
        results.append(task_id)
        return {"id": task_id, "status": "done"}

    pool = WorkerPool(max_workers=3)
    pool.start()
    t0 = time.monotonic()
    for i in range(3):
        pool.submit(f"task-{i}", slow_task, f"task-{i}")
    pool.wait_all()
    elapsed = time.monotonic() - t0
    pool.stop()

    assert len(results) == 3
    assert elapsed < 0.2


def test_worker_pool_respects_max_workers() -> None:
    pool = WorkerPool(max_workers=2)
    assert pool.max_workers == 2


def test_worker_pool_in_flight_count() -> None:
    started = threading.Event()
    release = threading.Event()

    def work() -> None:
        started.set()
        assert release.wait(timeout=5.0)

    pool = WorkerPool(max_workers=2)
    pool.start()
    assert pool.in_flight_count() == 0
    pool.submit("a", work)
    assert started.wait(timeout=5.0)
    assert pool.in_flight_count() >= 1
    release.set()
    pool.wait_all()
    assert pool.in_flight_count() == 0
    pool.stop()
