# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import secrets

from starlette.requests import Request
from starlette.websockets import WebSocket

MAX_PERSISTED_EVENTS_BYTES = 16 * 1024 * 1024

WS_CLOSE_DEV_TOKEN = 1008
WS_CLOSE_VIEWER_REJECT = 4401
WS_CLOSE_UNKNOWN_RUN = 4404


def const_time_str_eq(left: str, right: str) -> bool:
    return secrets.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


def broker_token_ok(request: Request, secret: str) -> bool:
    h = request.headers.get("x-gc-dev-token") or ""
    if h and const_time_str_eq(h, secret):
        return True
    q = request.query_params.get("token") or ""
    if q and const_time_str_eq(q, secret):
        return True
    return False


def broker_ws_token_ok(websocket: WebSocket, secret: str) -> bool:
    h = websocket.headers.get("x-gc-dev-token") or ""
    if h and const_time_str_eq(h, secret):
        return True
    q = websocket.query_params.get("token") or ""
    if q and const_time_str_eq(q, secret):
        return True
    return False
