# Copyright Aura. All Rights Reserved.

"""WebSocket heartbeat manager for nginx proxy compatibility.

Pattern from n8n: ~60s keepalive prevents proxies from closing idle connections.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable

logger = logging.getLogger(__name__)


class HeartbeatManager:
    """Manages periodic heartbeat/ping for WebSocket and SSE connections.

    Pattern from n8n: ~60s keepalive for nginx proxy compatibility.
    """

    def __init__(
        self,
        interval_sec: float = 60.0,
        send_ping: Callable[[], Awaitable[None]] | None = None,
    ):
        self.interval_sec = interval_sec
        self._send_ping = send_ping
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()

    async def start(self) -> None:
        """Start heartbeat loop."""
        if self._task is not None:
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._ping_loop())

    async def stop(self) -> None:
        """Stop heartbeat loop."""
        if self._task is None:
            return
        self._stop_event.set()
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _ping_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=self.interval_sec,
                )
                break
            except asyncio.TimeoutError:
                if self._send_ping:
                    try:
                        await self._send_ping()
                    except Exception as e:
                        logger.debug("Heartbeat ping failed: %s", e)
