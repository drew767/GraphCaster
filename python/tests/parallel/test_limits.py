# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import threading
import time

import pytest

from graph_caster.parallel.limits import ConcurrencyLimiter, LimitExceededError, ResourceLimits


class TestConcurrencyLimiter:
    def test_acquire_and_release(self):
        limiter = ConcurrencyLimiter(max_concurrent=2)
        token1 = limiter.acquire("resource1")
        token2 = limiter.acquire("resource2")
        assert limiter.active_count == 2
        limiter.release(token1)
        assert limiter.active_count == 1
        limiter.release(token2)

    def test_blocks_when_limit_reached(self):
        limiter = ConcurrencyLimiter(max_concurrent=1, timeout=0.1)
        token = limiter.acquire("resource1")
        with pytest.raises(LimitExceededError):
            limiter.acquire("resource2")
        limiter.release(token)

    def test_context_manager(self):
        limiter = ConcurrencyLimiter(max_concurrent=2)
        with limiter.slot("resource1"):
            assert limiter.active_count == 1
            with limiter.slot("resource2"):
                assert limiter.active_count == 2
            assert limiter.active_count == 1
        assert limiter.active_count == 0

    def test_concurrent_access(self):
        limiter = ConcurrencyLimiter(max_concurrent=5)
        lock = threading.Lock()
        cur = [0]
        peak = [0]

        def worker() -> None:
            with limiter.slot("w"):
                with lock:
                    cur[0] += 1
                    peak[0] = max(peak[0], cur[0])
                time.sleep(0.05)
                with lock:
                    cur[0] -= 1

        threads = [threading.Thread(target=worker) for _ in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert peak[0] <= 5


class TestResourceLimits:
    def test_combined_limits(self):
        limits = ResourceLimits(
            max_parallel_graphs=2,
            max_parallel_nodes_per_graph=4,
        )
        g1 = limits.acquire_graph("graph1")
        g2 = limits.acquire_graph("graph2")
        with pytest.raises(LimitExceededError):
            limits.acquire_graph("graph3", timeout=0.1)
        limits.release_graph(g1)
        g3 = limits.acquire_graph("graph3")
        limits.release_graph(g3)
        limits.release_graph(g2)
