# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import TYPE_CHECKING

from .base import EventRelay, RelayMessage

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

logger = logging.getLogger(__name__)

# Configurable defaults
DEFAULT_QUEUE_MAXSIZE = 4096


class MemoryRelay(EventRelay):
    """In-memory event relay for single-instance deployments.
    
    Uses asyncio queues to distribute messages to subscribers.
    Supports multiple subscribers per run_id.
    """

    def __init__(self, queue_maxsize: int = DEFAULT_QUEUE_MAXSIZE) -> None:
        self._subscribers: dict[str, list[asyncio.Queue[RelayMessage]]] = defaultdict(list)
        self._connected = False
        self._queue_maxsize = queue_maxsize
        self._dropped_count = 0

    async def connect(self) -> None:
        """Initialize the relay."""
        self._connected = True

    async def disconnect(self) -> None:
        """Disconnect and clear all subscribers."""
        self._connected = False
        self._subscribers.clear()

    async def publish(self, message: RelayMessage) -> int:
        """Publish message to all subscribers for the run.
        
        Returns the number of subscribers that received the message.
        Messages are dropped (not queued) if a subscriber's queue is full.
        """
        if not self._connected:
            return 0
        run_id = message.run_id
        queues = self._subscribers.get(run_id, [])
        count = 0
        for q in queues:
            try:
                q.put_nowait(message)
                count += 1
            except asyncio.QueueFull:
                self._dropped_count += 1
                logger.warning(
                    "Dropped message for run %s (queue full, total dropped: %d)",
                    run_id,
                    self._dropped_count,
                )
        return count

    async def subscribe(self, run_id: str) -> AsyncIterator[RelayMessage]:
        """Subscribe to messages for a run.
        
        Yields RelayMessage objects as they arrive.
        The subscription is cleaned up when the iterator exits.
        """
        q: asyncio.Queue[RelayMessage] = asyncio.Queue(maxsize=self._queue_maxsize)
        self._subscribers[run_id].append(q)
        try:
            while True:
                msg = await q.get()
                yield msg
        finally:
            self._remove_queue(run_id, q)

    def _remove_queue(self, run_id: str, q: asyncio.Queue[RelayMessage]) -> None:
        """Remove a specific queue from subscribers."""
        queues = self._subscribers.get(run_id, [])
        if q in queues:
            queues.remove(q)
        if not queues and run_id in self._subscribers:
            del self._subscribers[run_id]

    async def unsubscribe(self, run_id: str) -> None:
        """Unsubscribe all subscribers for a run.
        
        Note: This removes ALL subscribers for the given run_id.
        Individual subscribers are removed automatically when their
        async iterator exits.
        """
        if run_id in self._subscribers:
            del self._subscribers[run_id]

    @property
    def is_distributed(self) -> bool:
        """Returns False - memory relay is single-instance only."""
        return False
    
    @property
    def dropped_count(self) -> int:
        """Total number of messages dropped due to full queues."""
        return self._dropped_count
