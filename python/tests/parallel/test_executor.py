# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import time
from concurrent.futures import TimeoutError as FuturesTimeoutError

import pytest

from graph_caster.parallel.executor import ExecutorConfig, ParallelExecutor


class TestParallelExecutor:
    def test_execute_single_task(self):
        executor = ParallelExecutor()

        def task():
            return 42

        assert executor.submit(task).result() == 42
        executor.shutdown()

    def test_execute_multiple_tasks_parallel(self):
        executor = ParallelExecutor(max_workers=4)
        start_times: list[float] = []

        def task(i):
            start_times.append(time.monotonic())
            time.sleep(0.1)
            return i * 2

        futures = [executor.submit(task, i) for i in range(4)]
        results = [f.result() for f in futures]
        assert results == [0, 2, 4, 6]
        assert max(start_times) - min(start_times) < 0.15
        executor.shutdown()

    def test_respects_max_workers(self):
        executor = ParallelExecutor(max_workers=2)
        execution_order: list[tuple[str, int]] = []

        def task(i):
            execution_order.append(("start", i))
            time.sleep(0.1)
            execution_order.append(("end", i))
            return i

        futures = [executor.submit(task, i) for i in range(4)]
        [f.result() for f in futures]
        starts = [x[1] for x in execution_order if x[0] == "start"]
        assert set(starts[:2]) == {0, 1}
        executor.shutdown()

    def test_handles_exception(self):
        executor = ParallelExecutor()

        def failing_task():
            raise ValueError("Test error")

        future = executor.submit(failing_task)
        with pytest.raises(ValueError, match="Test error"):
            future.result()
        executor.shutdown()

    def test_timeout(self):
        executor = ParallelExecutor()

        def slow_task():
            time.sleep(1.0)
            return "done"

        future = executor.submit(slow_task)
        with pytest.raises(FuturesTimeoutError):
            future.result(timeout=0.1)
        executor.shutdown(wait=False)

    def test_shutdown(self):
        executor = ParallelExecutor()
        executor.submit(lambda: 1).result()
        executor.shutdown()
        with pytest.raises(RuntimeError):
            executor.submit(lambda: 2)

    def test_context_manager(self):
        with ParallelExecutor() as executor:
            assert executor.submit(lambda: 42).result() == 42
        with pytest.raises(RuntimeError):
            executor.submit(lambda: 1)
