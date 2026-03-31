# Copyright GraphCaster. All Rights Reserved.

"""CRDT sync WebSocket stub (Phase 5 prep — host may replace)."""

from __future__ import annotations

from starlette.websockets import WebSocket


async def crdt_sync_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    await websocket.close(code=4000)
