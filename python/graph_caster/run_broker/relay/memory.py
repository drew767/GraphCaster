# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
from collections import defaultdict
from typing import TYPE_CHECKING

from .base import EventRelay, RelayMessage

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


class MemoryRelay(EventRelay):
    """In-memory event relay for single-instance deployments."""

    def __init__(self) -> None:
        self._subscribers: dict[str, list[asyncio.Queue[RelayMessage]]] = defaultdict(list)
        self._connected = False

    async def connect(self) -> None:
        self._connected = True

    async def disconnect(self) -> None:
        self._connected = False
        self._subscribers.clear()

    async def publish(self, message: RelayMessage) -> int:
        run_id = message.run_id
        queues = self._subscribers.get(run_id, [])
        count = 0
        for q in queues:
            try:
                q.put_nowait(message)
                count += 1
            except asyncio.QueueFull:
                pass
        return count

    async def subscribe(self, run_id: str) -> AsyncIterator[RelayMessage]:
        q: asyncio.Queue[RelayMessage] = asyncio.Queue(maxsize=4096)
        self._subscribers[run_id].append(q)
        try:
            while True:
                msg = await q.get()
                yield msg
        finally:
            self._remove_queue(run_id, q)

    def _remove_queue(self, run_id: str, q: asyncio.Queue[RelayMessage]) -> None:
        queues = self._subscribers.get(run_id, [])
        if q in queues:
            queues.remove(q)
        if not queues and run_id in self._subscribers:
            del self._subscribers[run_id]

    async def unsubscribe(self, run_id: str) -> None:
        if run_id in self._subscribers:
            del self._subscribers[run_id]

    @property
    def is_distributed(self) -> bool:
        return False
