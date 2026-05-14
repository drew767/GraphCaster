# Copyright GraphCaster. All Rights Reserved.

"""Yjs CRDT collaborative-editing WebSocket endpoint (F77).

Gated by env var  GC_RUN_BROKER_COLLAB=on  — responds 4001 otherwise.

Protocol (JSON frames over text WS):
  client -> server:  {type: "hello",    graphId, token}
  server -> client:  {type: "sync-snapshot", data: <base64 | "">}
  client -> server:  {type: "update",   data: <base64>}
  server -> peers:   {type: "update",   data: <base64>}   (relayed, not echo'd)
  client -> server:  {type: "awareness",data: <base64>}
  server -> peers:   {type: "awareness",data: <base64>}   (relayed, not echo'd)
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import time
from pathlib import Path
from typing import TYPE_CHECKING

from starlette.websockets import WebSocket, WebSocketDisconnect, WebSocketState

if TYPE_CHECKING:
    pass

_LOG = logging.getLogger(__name__)

_SNAPSHOT_INTERVAL_SEC = 30.0
_GRAPHS_DIR_ENV = "GC_GRAPHS_DIR"
_COLLAB_BIN_SUFFIX = ".collab.bin"

WS_CLOSE_FEATURE_DISABLED = 4001
WS_CLOSE_BAD_HELLO = 4002


def _collab_enabled() -> bool:
    return os.environ.get("GC_RUN_BROKER_COLLAB", "").strip().lower() == "on"


def _graphs_dir() -> Path | None:
    raw = os.environ.get(_GRAPHS_DIR_ENV, "").strip()
    if raw:
        return Path(raw)
    return None


def _bin_path(graph_id: str) -> Path | None:
    d = _graphs_dir()
    if d is None:
        return None
    safe = "".join(c if c.isalnum() or c in "-_." else "_" for c in graph_id)
    return d / (safe + _COLLAB_BIN_SUFFIX)


class _CollabSession:
    """Per-graphId session: holds latest aggregated state and all live sockets."""

    def __init__(self, graph_id: str) -> None:
        self.graph_id = graph_id
        self._state: bytes = b""
        self._connections: list[WebSocket] = []
        self._last_snapshot_ts: float = time.monotonic()
        self._lock = asyncio.Lock()
        self._load_from_disk()

    def _load_from_disk(self) -> None:
        path = _bin_path(self.graph_id)
        if path is not None and path.exists():
            try:
                self._state = path.read_bytes()
                _LOG.debug("collab: loaded %d bytes from %s", len(self._state), path)
            except OSError as exc:
                _LOG.warning("collab: could not load %s: %s", path, exc)

    def _save_to_disk(self) -> None:
        if not self._state:
            return
        path = _bin_path(self.graph_id)
        if path is None:
            return
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(self._state)
        except OSError as exc:
            _LOG.warning("collab: could not save %s: %s", path, exc)

    async def add(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections.append(ws)

    async def remove(self, ws: WebSocket) -> None:
        async with self._lock:
            self._connections = [c for c in self._connections if c is not ws]
            if not self._connections:
                self._save_to_disk()

    def snapshot_b64(self) -> str:
        return base64.b64encode(self._state).decode() if self._state else ""

    async def apply_update(self, update_bytes: bytes, sender: WebSocket) -> None:
        async with self._lock:
            self._state = self._state + update_bytes
            now = time.monotonic()
            if now - self._last_snapshot_ts >= _SNAPSHOT_INTERVAL_SEC:
                self._save_to_disk()
                self._last_snapshot_ts = now
            peers = [c for c in self._connections if c is not sender]

        msg = json.dumps({"type": "update", "data": base64.b64encode(update_bytes).decode()})
        for peer in peers:
            await _safe_send(peer, msg)

    async def relay_awareness(self, update_bytes: bytes, sender: WebSocket) -> None:
        async with self._lock:
            peers = [c for c in self._connections if c is not sender]
        msg = json.dumps({"type": "awareness", "data": base64.b64encode(update_bytes).decode()})
        for peer in peers:
            await _safe_send(peer, msg)


async def _safe_send(ws: WebSocket, text: str) -> None:
    try:
        if ws.client_state == WebSocketState.CONNECTED:
            await ws.send_text(text)
    except Exception as exc:
        _LOG.debug("collab: send failed: %s", exc)


_SESSIONS: dict[str, _CollabSession] = {}
_SESSIONS_LOCK = asyncio.Lock()


async def _get_or_create_session(graph_id: str) -> _CollabSession:
    async with _SESSIONS_LOCK:
        if graph_id not in _SESSIONS:
            _SESSIONS[graph_id] = _CollabSession(graph_id)
        return _SESSIONS[graph_id]


async def collab_websocket(websocket: WebSocket) -> None:
    """Starlette WebSocket handler for /api/v1/collab/{graphId}/ws"""
    await websocket.accept()

    if not _collab_enabled():
        await websocket.close(code=WS_CLOSE_FEATURE_DISABLED)
        return

    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=15.0)
    except (asyncio.TimeoutError, WebSocketDisconnect):
        await websocket.close(code=WS_CLOSE_BAD_HELLO)
        return

    try:
        hello = json.loads(raw)
    except json.JSONDecodeError:
        await websocket.close(code=WS_CLOSE_BAD_HELLO)
        return

    if hello.get("type") != "hello" or not hello.get("graphId"):
        await websocket.close(code=WS_CLOSE_BAD_HELLO)
        return

    graph_id: str = str(hello["graphId"])
    session = await _get_or_create_session(graph_id)
    await session.add(websocket)

    await websocket.send_text(
        json.dumps({"type": "sync-snapshot", "data": session.snapshot_b64()})
    )

    try:
        while True:
            try:
                raw = await websocket.receive_text()
            except WebSocketDisconnect:
                break
            except Exception as exc:
                _LOG.debug("collab receive error: %s", exc)
                break

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue

            msg_type = msg.get("type")
            data_b64 = msg.get("data", "")

            if msg_type in ("update", "awareness") and data_b64:
                try:
                    payload = base64.b64decode(data_b64)
                except Exception:
                    continue
                if msg_type == "update":
                    await session.apply_update(payload, websocket)
                else:
                    await session.relay_awareness(payload, websocket)
            elif msg_type == "ping" or (msg_type is not None and "sentinel" in msg_type):
                await _safe_send(websocket, json.dumps({"type": "pong"}))
    finally:
        await session.remove(websocket)
        try:
            if websocket.client_state == WebSocketState.CONNECTED:
                await websocket.close()
        except Exception:
            pass
