# Copyright GraphCaster. All Rights Reserved.

"""REST routes for SSO provider config management (UX58 / F85 extension).

Admin-only endpoints for configuring per-tenant SSO providers.
"""

from __future__ import annotations

import json
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from graph_caster.auth.sso_config import SsoConfigStore, SsoProviderConfig


_VALID_PROVIDERS = frozenset({"google", "github", "microsoft", "oidc", "saml"})


def _tenant_id_from_request(request: Request) -> str:
    return request.headers.get("X-Tenant-Id", "default").strip() or "default"


def _check_admin(request: Request) -> bool:
    auth = request.headers.get("Authorization", "").strip()
    return bool(auth)


def make_sso_config_routes(store: SsoConfigStore) -> list[Route]:
    """Return Starlette Route list for /api/v1/sso/providers endpoints."""

    async def list_providers(request: Request) -> Response:
        if not _check_admin(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        tenant_id = _tenant_id_from_request(request)
        configs = await store.list(tenant_id)
        return JSONResponse({"providers": [c.to_dict() for c in configs]})

    async def get_provider(request: Request) -> Response:
        if not _check_admin(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        provider = request.path_params["provider"].lower()
        if provider not in _VALID_PROVIDERS:
            return JSONResponse({"error": f"Unknown provider: {provider!r}"}, status_code=404)
        tenant_id = _tenant_id_from_request(request)
        cfg = await store.get(provider, tenant_id)
        if cfg is None:
            return JSONResponse({"error": f"Provider {provider!r} not configured"}, status_code=404)
        return JSONResponse(cfg.to_dict())

    async def upsert_provider(request: Request) -> Response:
        if not _check_admin(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        provider = request.path_params["provider"].lower()
        if provider not in _VALID_PROVIDERS:
            return JSONResponse({"error": f"Unknown provider: {provider!r}"}, status_code=404)
        tenant_id = _tenant_id_from_request(request)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                return JSONResponse({"error": "body must be object"}, status_code=400)
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        body["provider"] = provider
        try:
            cfg = SsoProviderConfig.from_dict(body)
        except (ValueError, KeyError) as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)

        result = await store.upsert(provider, tenant_id, cfg)
        return JSONResponse(result.to_dict(), status_code=200)

    async def delete_provider(request: Request) -> Response:
        if not _check_admin(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        provider = request.path_params["provider"].lower()
        if provider not in _VALID_PROVIDERS:
            return JSONResponse({"error": f"Unknown provider: {provider!r}"}, status_code=404)
        tenant_id = _tenant_id_from_request(request)
        await store.delete(provider, tenant_id)
        return JSONResponse({"deleted": provider})

    async def test_provider(request: Request) -> Response:
        if not _check_admin(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        provider = request.path_params["provider"].lower()
        if provider not in _VALID_PROVIDERS:
            return JSONResponse({"error": f"Unknown provider: {provider!r}"}, status_code=404)
        tenant_id = _tenant_id_from_request(request)
        result = await store.test(provider, tenant_id)
        status = 200 if result.get("ok") else 422
        return JSONResponse(result, status_code=status)

    return [
        Route("/api/v1/sso/providers", list_providers, methods=["GET"]),
        Route("/api/v1/sso/providers/{provider}", get_provider, methods=["GET"]),
        Route("/api/v1/sso/providers/{provider}", upsert_provider, methods=["PUT"]),
        Route("/api/v1/sso/providers/{provider}", delete_provider, methods=["DELETE"]),
        Route("/api/v1/sso/providers/{provider}/test", test_provider, methods=["POST"]),
    ]
