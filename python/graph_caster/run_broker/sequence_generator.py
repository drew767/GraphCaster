# Copyright GraphCaster. All Rights Reserved.

"""Thread-safe monotonic sequence generator for event ordering."""

from __future__ import annotations

import threading
from typing import Final


class SequenceGenerator:
    """
    Thread-safe monotonic sequence generator.

    Each event gets a globally unique sequence number when it enters the broker.
    Consumers can reorder by ``seq`` while the broker may apply priority-based eviction.
    """

    __slots__ = ("_counter", "_lock")

    def __init__(self, start: int = 0) -> None:
        self._counter: int = start
        self._lock: Final[threading.Lock] = threading.Lock()

    def next_seq(self) -> int:
        """Return the next sequence number (thread-safe)."""
        with self._lock:
            self._counter += 1
            return self._counter

    def current(self) -> int:
        """Return the last issued sequence without incrementing."""
        with self._lock:
            return self._counter
