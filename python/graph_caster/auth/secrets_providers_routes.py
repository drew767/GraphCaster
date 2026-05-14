# Copyright GraphCaster. All Rights Reserved.

"""REST routes for Secrets-Providers config management (UX55 / F8 extension)."""

from __future__ import annotations

import json
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from graph_caster.auth.secrets_providers_config import SecretsProvidersConfigStore


_VALID_PROVIDERS = frozenset({"file", "vault", "aws-sm"})


def _check_admin(request: Request) -> bool:
    return bool(request.headers.get("Authorization", "").strip())


def make_secrets_providers_routes(store: SecretsProvidersConfigStore) -> list[Route]:
    """Return Starlette Route list for /api/v1/secrets/providers endpoints."""

    async def list_providers(request: Request) -> Response:
        if not _check_admin(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        configs = await store.list()
        return JSONResponse({"providers": [c.to_dict() for c in configs]})

    async def update_provider(request: Request) -> Response:
        if not _check_admin(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        provider_id = request.path_params["provider_id"]
        if provider_id not in _VALID_PROVIDERS:
            return JSONResponse({"error": f"Unknown provider: {provider_id!r}"}, status_code=404)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                return JSONResponse({"error": "body must be object"}, status_code=400)
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        config_payload = body.get("config")
        if config_payload is None:
            config_payload = body
        if not isinstance(config_payload, dict):
            return JSONResponse({"error": "'config' must be object"}, status_code=400)

        try:
            result = await store.update(provider_id, config_payload)
        except KeyError as exc:
            return JSONResponse({"error": str(exc)}, status_code=404)

        return JSONResponse(result.to_dict())

    async def test_provider(request: Request) -> Response:
        if not _check_admin(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        provider_id = request.path_params["provider_id"]
        if provider_id not in _VALID_PROVIDERS:
            return JSONResponse({"error": f"Unknown provider: {provider_id!r}"}, status_code=404)
        result = await store.test(provider_id)
        status = 200 if result.get("ok") else 422
        return JSONResponse(result, status_code=status)

    return [
        Route("/api/v1/secrets/providers", list_providers, methods=["GET"]),
        Route("/api/v1/secrets/providers/{provider_id}", update_provider, methods=["PUT"]),
        Route("/api/v1/secrets/providers/{provider_id}/test", test_provider, methods=["POST"]),
    ]
