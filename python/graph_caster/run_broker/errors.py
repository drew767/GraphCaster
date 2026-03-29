# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations


class PendingQueueFullError(Exception):
    """Raised when the broker pending FIFO is full (`GC_RUN_BROKER_PENDING_MAX`).

    HTTP handlers map this to ``503`` with ``error: pending_queue_full``.
    """

    default_message = "pending queue full"

    def __init__(self) -> None:
        super().__init__(self.default_message)
