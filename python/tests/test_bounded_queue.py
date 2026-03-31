# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import threading
import time
from typing import Any

import pytest

from graph_caster.run_broker.bounded_queue import (
    MessagePriority,
    PriorityBoundedQueue,
)


class TestMessagePriority:
    def test_priority_ordering(self) -> None:
        assert MessagePriority.CRITICAL < MessagePriority.HIGH
        assert MessagePriority.HIGH < MessagePriority.NORMAL
        assert MessagePriority.NORMAL < MessagePriority.LOW

    def test_priority_values(self) -> None:
        assert MessagePriority.CRITICAL == 0
        assert MessagePriority.HIGH == 1
        assert MessagePriority.NORMAL == 2
        assert MessagePriority.LOW == 3


class TestPriorityBoundedQueueBasic:
    def test_constructor_requires_positive_maxsize(self) -> None:
        with pytest.raises(ValueError, match="maxsize must be at least 1"):
            PriorityBoundedQueue[str](0)
        with pytest.raises(ValueError, match="maxsize must be at least 1"):
            PriorityBoundedQueue[str](-1)

    def test_empty_queue_properties(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=10)
        assert q.maxsize == 10
        assert q.qsize() == 0
        assert q.empty() is True
        assert q.full() is False
        assert q.dropped_count == 0

    def test_basic_put_get(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=10)
        q.put("item1")
        assert q.qsize() == 1
        assert q.empty() is False
        result = q.get()
        assert result == "item1"
        assert q.empty() is True

    def test_full_queue(self) -> None:
        q: PriorityBoundedQueue[int] = PriorityBoundedQueue(maxsize=2)
        q.put(1)
        q.put(2)
        assert q.full() is True
        assert q.qsize() == 2


class TestPriorityOrdering:
    def test_items_returned_in_priority_order(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=10)
        q.put("low", MessagePriority.LOW)
        q.put("normal", MessagePriority.NORMAL)
        q.put("critical", MessagePriority.CRITICAL)
        q.put("high", MessagePriority.HIGH)

        assert q.get() == "critical"
        assert q.get() == "high"
        assert q.get() == "normal"
        assert q.get() == "low"

    def test_same_priority_fifo(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=10)
        q.put("first", MessagePriority.NORMAL)
        q.put("second", MessagePriority.NORMAL)
        q.put("third", MessagePriority.NORMAL)

        assert q.get() == "first"
        assert q.get() == "second"
        assert q.get() == "third"

    def test_mixed_priority_interleaved(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=10)
        q.put("low1", MessagePriority.LOW)
        q.put("crit1", MessagePriority.CRITICAL)
        q.put("low2", MessagePriority.LOW)
        q.put("crit2", MessagePriority.CRITICAL)
        q.put("norm1", MessagePriority.NORMAL)

        assert q.get() == "crit1"
        assert q.get() == "crit2"
        assert q.get() == "norm1"
        assert q.get() == "low1"
        assert q.get() == "low2"


class TestEvictionBehavior:
    def test_low_priority_dropped_when_full(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=2)
        q.put("existing1", MessagePriority.LOW)
        q.put("existing2", MessagePriority.LOW)
        assert q.full() is True

        dropped = q.try_put("new_low", MessagePriority.LOW)
        assert dropped is True
        assert q.dropped_count == 1

    def test_high_priority_evicts_low_when_full(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=2)
        q.put("low1", MessagePriority.LOW)
        q.put("low2", MessagePriority.LOW)
        assert q.full() is True

        dropped = q.try_put("high", MessagePriority.HIGH)
        assert dropped is False
        assert q.dropped_count == 1
        assert q.qsize() == 2

        results = [q.get(), q.get()]
        assert "high" in results
        assert results.count("low1") + results.count("low2") == 1

    def test_critical_always_accepted(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=2)
        q.put("normal1", MessagePriority.NORMAL)
        q.put("normal2", MessagePriority.NORMAL)
        assert q.full() is True

        dropped = q.try_put("critical", MessagePriority.CRITICAL)
        assert dropped is False
        assert q.dropped_count == 1
        assert q.qsize() == 2

        assert q.get() == "critical"

    def test_critical_evicts_anything_non_critical(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=3)
        q.put("high1", MessagePriority.HIGH)
        q.put("high2", MessagePriority.HIGH)
        q.put("high3", MessagePriority.HIGH)
        assert q.full() is True

        dropped = q.try_put("critical", MessagePriority.CRITICAL)
        assert dropped is False
        assert q.dropped_count == 1

        assert q.get() == "critical"

    def test_cannot_evict_same_or_higher_priority(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=2)
        q.put("crit1", MessagePriority.CRITICAL)
        q.put("crit2", MessagePriority.CRITICAL)
        assert q.full() is True

        dropped = q.try_put("crit3", MessagePriority.CRITICAL)
        assert dropped is True
        assert q.dropped_count == 1
        assert q.qsize() == 2

        assert q.get() == "crit1"
        assert q.get() == "crit2"

    def test_normal_evicts_low_not_high(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=2)
        q.put("high", MessagePriority.HIGH)
        q.put("low", MessagePriority.LOW)
        assert q.full() is True

        dropped = q.try_put("normal", MessagePriority.NORMAL)
        assert dropped is False
        assert q.dropped_count == 1

        results = [q.get(), q.get()]
        assert "high" in results
        assert "normal" in results
        assert "low" not in results


class TestDroppedCount:
    def test_dropped_count_tracks_correctly(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=1)
        q.put("first", MessagePriority.LOW)
        assert q.dropped_count == 0

        q.try_put("dropped1", MessagePriority.LOW)
        assert q.dropped_count == 1

        q.try_put("dropped2", MessagePriority.LOW)
        assert q.dropped_count == 2

        q.try_put("evicts", MessagePriority.CRITICAL)
        assert q.dropped_count == 3

    def test_dropped_count_includes_evictions(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=2)
        q.put("low1", MessagePriority.LOW)
        q.put("low2", MessagePriority.LOW)

        q.try_put("high1", MessagePriority.HIGH)
        q.try_put("high2", MessagePriority.HIGH)

        assert q.dropped_count == 2


class TestBlockingBehavior:
    def test_get_blocks_on_empty(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=10)
        result: list[str] = []

        def delayed_put() -> None:
            time.sleep(0.05)
            q.put("delayed_item")

        t = threading.Thread(target=delayed_put)
        t.start()

        item = q.get(timeout=2.0)
        result.append(item)
        t.join()

        assert result == ["delayed_item"]

    def test_get_timeout_raises(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=10)
        with pytest.raises(TimeoutError):
            q.get(timeout=0.01)

    def test_get_nowait_raises_on_empty(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=10)
        with pytest.raises(IndexError, match="Queue is empty"):
            q.get_nowait()

    def test_put_critical_blocks_when_all_critical(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=2)
        q.put("crit1", MessagePriority.CRITICAL)
        q.put("crit2", MessagePriority.CRITICAL)

        result: list[bool] = []

        def blocked_put() -> None:
            q.put("crit3", MessagePriority.CRITICAL, timeout=0.5)
            result.append(True)

        t = threading.Thread(target=blocked_put)
        t.start()
        time.sleep(0.05)
        assert not result

        q.get()
        t.join(timeout=1.0)
        assert result == [True]


class TestThreadSafety:
    def test_concurrent_put_get(self) -> None:
        q: PriorityBoundedQueue[int] = PriorityBoundedQueue(maxsize=100)
        num_items = 500
        received: list[int] = []
        stop_event = threading.Event()

        def producer() -> None:
            for i in range(num_items):
                priority = MessagePriority.LOW if i % 4 == 0 else MessagePriority.NORMAL
                q.try_put(i, priority)

        def consumer() -> None:
            while not stop_event.is_set() or not q.empty():
                try:
                    item = q.get(timeout=0.1)
                    received.append(item)
                except TimeoutError:
                    pass

        producers = [threading.Thread(target=producer) for _ in range(4)]
        consumers = [threading.Thread(target=consumer) for _ in range(2)]

        for t in producers + consumers:
            t.start()

        for t in producers:
            t.join()

        time.sleep(0.2)
        stop_event.set()

        for t in consumers:
            t.join(timeout=2.0)

        total_received = len(received)
        total_dropped = q.dropped_count
        expected = num_items * 4
        assert total_received + total_dropped <= expected


class TestTryPut:
    def test_try_put_returns_false_when_space(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=10)
        dropped = q.try_put("item")
        assert dropped is False
        assert q.qsize() == 1

    def test_try_put_returns_true_when_dropped(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=1)
        q.try_put("first", MessagePriority.CRITICAL)
        dropped = q.try_put("second", MessagePriority.CRITICAL)
        assert dropped is True
        assert q.qsize() == 1

    def test_try_put_non_blocking(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=1)
        q.put("block", MessagePriority.CRITICAL)

        start = time.monotonic()
        q.try_put("should_drop", MessagePriority.LOW)
        elapsed = time.monotonic() - start

        assert elapsed < 0.1


class TestEdgeCases:
    def test_single_capacity_queue(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=1)
        q.put("first")
        assert q.full() is True

        dropped = q.try_put("second", MessagePriority.LOW)
        assert dropped is True

        dropped = q.try_put("critical", MessagePriority.CRITICAL)
        assert dropped is False
        assert q.dropped_count == 2

        assert q.get() == "critical"

    def test_repeated_evictions(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=2)
        q.put("low1", MessagePriority.LOW)
        q.put("low2", MessagePriority.LOW)

        for i in range(5):
            q.try_put(f"high{i}", MessagePriority.HIGH)

        assert q.dropped_count == 5
        results = [q.get(), q.get()]
        assert all("high" in r for r in results)

    def test_priority_default_is_normal(self) -> None:
        q: PriorityBoundedQueue[str] = PriorityBoundedQueue(maxsize=3)
        q.put("default_priority")
        q.put("low", MessagePriority.LOW)
        q.put("high", MessagePriority.HIGH)

        assert q.get() == "high"
        assert q.get() == "default_priority"
        assert q.get() == "low"
