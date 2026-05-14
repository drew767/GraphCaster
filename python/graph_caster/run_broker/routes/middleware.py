# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import os

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from graph_caster.run_broker.routes.common import broker_token_ok


class BrokerTokenMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        p = request.url.path
        if (
            p == "/webhooks/run"
            or p.startswith("/webhooks/trigger/")
            or p == "/api/v1/openapi.json"
        ):
            return await call_next(request)
        token = os.environ.get("GC_RUN_BROKER_TOKEN", "").strip()
        if token and not broker_token_ok(request, token):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await call_next(request)


class PrincipalMiddleware(BaseHTTPMiddleware):
    """Resolve the API-key bearer and populate ``request.scope["principal"]``."""

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        auth_h = request.headers.get("Authorization")
        if auth_h:
            try:
                from graph_caster.run_broker.routes.api_v1_routes import _load_api_v1_auth
                from graph_caster.auth.rbac import Principal, Role

                api_auth = _load_api_v1_auth()
                if api_auth is not None:
                    key = api_auth.validate(auth_h)
                    if key is not None:
                        scopes = set(key.scopes)
                        principal = Principal(
                            user_id=f"apikey:{key.key_id}",
                            tenant_id="default",
                            role=Role.EDITOR,
                            api_key_scopes=scopes,
                        )
                        request.scope["principal"] = principal
            except Exception:
                pass
        return await call_next(request)
