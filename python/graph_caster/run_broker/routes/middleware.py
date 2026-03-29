# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import os

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from graph_caster.run_broker.routes.common import broker_token_ok


class BrokerTokenMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path == "/webhooks/run":
            return await call_next(request)
        token = os.environ.get("GC_RUN_BROKER_TOKEN", "").strip()
        if token and not broker_token_ok(request, token):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await call_next(request)
