# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import heapq
import threading
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Generic, TypeVar

T = TypeVar("T")


class MessagePriority(IntEnum):
    """Priority levels for messages. Lower value = higher priority (less droppable)."""

    CRITICAL = 0  # run_started, run_finished - never drop
    HIGH = 1  # node_enter, node_exit, error
    NORMAL = 2  # process_complete, branch_taken
    LOW = 3  # process_output (droppable under load)


@dataclass(order=True)
class _PrioritizedItem(Generic[T]):
    """Internal heap item with priority ordering and FIFO tiebreaker."""

    priority: int
    seq: int
    item: T = field(compare=False)


class PriorityBoundedQueue(Generic[T]):
    """Thread-safe bounded queue with priority-aware eviction.

    When the queue is full and a new item arrives:
    - If the new item has higher priority (lower number) than the lowest priority
      item in the queue, the lowest priority item is evicted and the new item is added.
    - Otherwise, the new item is dropped.

    Items are retrieved in priority order (highest priority first, i.e., lowest number).
    Items with the same priority are retrieved in FIFO order.
    """

    def __init__(self, maxsize: int) -> None:
        if maxsize < 1:
            raise ValueError("maxsize must be at least 1")
        self._maxsize = maxsize
        self._heap: list[_PrioritizedItem[T]] = []
        self._seq = 0
        self._dropped_count = 0
        self._lock = threading.Lock()
        self._not_empty = threading.Condition(self._lock)
        self._not_full = threading.Condition(self._lock)

    @property
    def maxsize(self) -> int:
        return self._maxsize

    @property
    def dropped_count(self) -> int:
        with self._lock:
            return self._dropped_count

    def qsize(self) -> int:
        with self._lock:
            return len(self._heap)

    def empty(self) -> bool:
        with self._lock:
            return len(self._heap) == 0

    def full(self) -> bool:
        with self._lock:
            return len(self._heap) >= self._maxsize

    def _find_lowest_priority_idx(self) -> int:
        """Find index of item with lowest priority (highest number) in heap."""
        if not self._heap:
            return -1
        worst_idx = 0
        worst_prio = self._heap[0].priority
        worst_seq = self._heap[0].seq
        for i, pitem in enumerate(self._heap):
            if pitem.priority > worst_prio or (
                pitem.priority == worst_prio and pitem.seq < worst_seq
            ):
                worst_prio = pitem.priority
                worst_seq = pitem.seq
                worst_idx = i
        return worst_idx

    def try_put(self, item: T, priority: MessagePriority = MessagePriority.NORMAL) -> bool:
        """Non-blocking put. Returns True if item was dropped, False if added.

        When queue is full:
        - If new item has higher priority than lowest priority item, evict lowest
        - Else drop new item
        """
        with self._lock:
            if len(self._heap) < self._maxsize:
                pitem = _PrioritizedItem(priority=priority, seq=self._seq, item=item)
                self._seq += 1
                heapq.heappush(self._heap, pitem)
                self._not_empty.notify()
                return False

            worst_idx = self._find_lowest_priority_idx()
            if worst_idx >= 0 and priority < self._heap[worst_idx].priority:
                self._heap[worst_idx] = self._heap[-1]
                self._heap.pop()
                if self._heap and worst_idx < len(self._heap):
                    heapq.heapify(self._heap)
                pitem = _PrioritizedItem(priority=priority, seq=self._seq, item=item)
                self._seq += 1
                heapq.heappush(self._heap, pitem)
                self._dropped_count += 1
                return False

            self._dropped_count += 1
            return True

    def put(
        self,
        item: T,
        priority: MessagePriority = MessagePriority.NORMAL,
        timeout: float | None = None,
    ) -> None:
        """Blocking put. Waits for space if queue is full.

        For CRITICAL priority items, this will block until space is available
        (either from a get() or natural queue drain).

        For non-CRITICAL items when queue is full, behavior depends on
        whether there's a lower-priority item to evict.

        Args:
            item: The item to add
            priority: Message priority level
            timeout: Maximum seconds to wait (None = wait forever)
        """
        with self._not_full:
            if len(self._heap) < self._maxsize:
                pitem = _PrioritizedItem(priority=priority, seq=self._seq, item=item)
                self._seq += 1
                heapq.heappush(self._heap, pitem)
                self._not_empty.notify()
                return

            if priority == MessagePriority.CRITICAL:
                worst_idx = self._find_lowest_priority_idx()
                if worst_idx >= 0 and self._heap[worst_idx].priority > priority:
                    self._heap[worst_idx] = self._heap[-1]
                    self._heap.pop()
                    if self._heap and worst_idx < len(self._heap):
                        heapq.heapify(self._heap)
                    pitem = _PrioritizedItem(priority=priority, seq=self._seq, item=item)
                    self._seq += 1
                    heapq.heappush(self._heap, pitem)
                    self._dropped_count += 1
                    self._not_empty.notify()
                    return
                if not self._not_full.wait(timeout=timeout):
                    raise TimeoutError("Timed out waiting for queue space")
                pitem = _PrioritizedItem(priority=priority, seq=self._seq, item=item)
                self._seq += 1
                heapq.heappush(self._heap, pitem)
                self._not_empty.notify()
                return

            worst_idx = self._find_lowest_priority_idx()
            if worst_idx >= 0 and priority < self._heap[worst_idx].priority:
                self._heap[worst_idx] = self._heap[-1]
                self._heap.pop()
                if self._heap and worst_idx < len(self._heap):
                    heapq.heapify(self._heap)
                pitem = _PrioritizedItem(priority=priority, seq=self._seq, item=item)
                self._seq += 1
                heapq.heappush(self._heap, pitem)
                self._dropped_count += 1
                self._not_empty.notify()
                return

            self._dropped_count += 1

    def get(self, timeout: float | None = None) -> T:
        """Remove and return the highest priority item (blocking).

        Items are returned in priority order (CRITICAL first, then HIGH, etc.).
        Within the same priority level, items are returned in FIFO order.

        Args:
            timeout: Maximum seconds to wait (None = wait forever)

        Returns:
            The highest priority item

        Raises:
            TimeoutError: If timeout expires before an item is available
        """
        with self._not_empty:
            while not self._heap:
                if not self._not_empty.wait(timeout=timeout):
                    raise TimeoutError("Timed out waiting for item")
            pitem = heapq.heappop(self._heap)
            self._not_full.notify()
            return pitem.item

    def get_nowait(self) -> T:
        """Remove and return the highest priority item (non-blocking).

        Returns:
            The highest priority item

        Raises:
            IndexError: If queue is empty
        """
        with self._lock:
            if not self._heap:
                raise IndexError("Queue is empty")
            pitem = heapq.heappop(self._heap)
            self._not_full.notify_all()
            return pitem.item
