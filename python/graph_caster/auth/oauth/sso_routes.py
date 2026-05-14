# Copyright GraphCaster. All Rights Reserved.

"""Starlette SSO route factory for OAuth2/OIDC login/callback endpoints (F85)."""

from __future__ import annotations

import json
import os
from typing import Any

from graph_caster.auth.oauth.base import OAuthConfig, OAuthIdentity, OAuthProvider
from graph_caster.auth.oauth.flow import OAuthFlow
from graph_caster.auth.oauth.state_store import InMemoryStateStore, StateStore
from graph_caster.auth.oauth.google import GoogleOAuthProvider
from graph_caster.auth.oauth.github import GitHubOAuthProvider
from graph_caster.auth.oauth.microsoft import MicrosoftOAuthProvider
from graph_caster.auth.oauth.generic_oidc import GenericOIDCProvider

_PROVIDER_NAMES = {"google", "github", "microsoft", "oidc"}


def _load_provider_config(provider_name: str) -> OAuthConfig | None:
    prefix = f"GC_OAUTH_{provider_name.upper()}"
    client_id = os.environ.get(f"{prefix}_CLIENT_ID", "").strip()
    client_secret = os.environ.get(f"{prefix}_CLIENT_SECRET", "").strip()
    redirect_uri = os.environ.get(f"{prefix}_REDIRECT_URI", "").strip()
    if not client_id or not client_secret:
        return None
    scopes_raw = os.environ.get(f"{prefix}_SCOPES", "").strip()
    scopes = [s.strip() for s in scopes_raw.split(",") if s.strip()] if scopes_raw else []
    extras: dict[str, Any] = {}
    if provider_name == "microsoft":
        tenant = os.environ.get("GC_OAUTH_MICROSOFT_TENANT", "common").strip()
        if tenant:
            extras["tenant"] = tenant
    if provider_name == "oidc":
        issuer = os.environ.get("GC_OIDC_ISSUER", "").strip()
        if issuer:
            extras["issuer"] = issuer
    return OAuthConfig(
        client_id=client_id,
        client_secret=client_secret,
        redirect_uri=redirect_uri,
        scopes=scopes,
        extras=extras,
    )


def _make_provider(provider_name: str) -> OAuthProvider | None:
    if provider_name == "google":
        return GoogleOAuthProvider()
    if provider_name == "github":
        return GitHubOAuthProvider()
    if provider_name == "microsoft":
        tenant = os.environ.get("GC_OAUTH_MICROSOFT_TENANT", "common").strip()
        return MicrosoftOAuthProvider(tenant=tenant or "common")
    if provider_name == "oidc":
        issuer = os.environ.get("GC_OIDC_ISSUER", "").strip()
        if not issuer:
            return None
        return GenericOIDCProvider(issuer=issuer)
    return None


def make_sso_routes(state_store: StateStore | None = None) -> list[Any]:
    """Return Starlette Route objects for SSO login/callback.

    Appended to the v1 router; does not break existing routes.
    """
    try:
        from starlette.responses import JSONResponse, RedirectResponse, Response
        from starlette.requests import Request
        from starlette.routing import Route
    except ImportError:
        return []

    _state_store = state_store or InMemoryStateStore()

    async def sso_login(request: Request) -> Response:
        provider_name = request.path_params["provider"].lower()
        if provider_name not in _PROVIDER_NAMES:
            return JSONResponse(
                {"error": f"Unknown SSO provider: {provider_name!r}. Valid: {sorted(_PROVIDER_NAMES)}"},
                status_code=404,
            )
        config = _load_provider_config(provider_name)
        if config is None:
            return JSONResponse(
                {"error": f"SSO provider {provider_name!r} is not configured (set GC_OAUTH_{provider_name.upper()}_CLIENT_ID / _CLIENT_SECRET)"},
                status_code=503,
            )
        provider = _make_provider(provider_name)
        if provider is None:
            return JSONResponse(
                {"error": f"Could not initialize provider {provider_name!r} (check GC_OIDC_ISSUER for oidc)"},
                status_code=503,
            )
        flow = OAuthFlow(provider, config, _state_store)
        extra: dict = {}
        next_url = request.query_params.get("next")
        if next_url:
            extra["next"] = next_url
        auth_url, state = await flow.start(extra_payload=extra or None)
        response = RedirectResponse(url=auth_url, status_code=302)
        response.set_cookie("gc_oauth_state", state, httponly=True, samesite="lax", max_age=600)
        return response

    async def sso_callback(request: Request) -> Response:
        provider_name = request.path_params["provider"].lower()
        if provider_name not in _PROVIDER_NAMES:
            return JSONResponse(
                {"error": f"Unknown SSO provider: {provider_name!r}"},
                status_code=404,
            )
        code = request.query_params.get("code", "").strip()
        state = request.query_params.get("state", "").strip()
        if not code or not state:
            return JSONResponse({"error": "Missing code or state query parameters"}, status_code=400)

        config = _load_provider_config(provider_name)
        if config is None:
            return JSONResponse(
                {"error": f"SSO provider {provider_name!r} is not configured"},
                status_code=503,
            )
        provider = _make_provider(provider_name)
        if provider is None:
            return JSONResponse(
                {"error": f"Could not initialize provider {provider_name!r}"},
                status_code=503,
            )
        flow = OAuthFlow(provider, config, _state_store)

        try:
            identity, _payload = await flow.complete(code, state)
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        except Exception as e:
            return JSONResponse({"error": f"Token exchange failed: {e}"}, status_code=502)

        result = _identity_to_signin_result(identity)

        try:
            from graph_caster.tenancy import InMemoryTenantStore
            _tenant_store = getattr(sso_callback, "_tenant_store", None)
            if _tenant_store is None:
                _tenant_store = InMemoryTenantStore()
                sso_callback._tenant_store = _tenant_store  # type: ignore[attr-defined]
            user_result = await _find_or_create_user(_tenant_store, identity)
            result["userId"] = user_result.id
        except Exception:
            pass

        return JSONResponse(result)

    return [
        Route("/api/v1/auth/sso/{provider}/login", sso_login, methods=["GET"]),
        Route("/api/v1/auth/sso/{provider}/callback", sso_callback, methods=["GET"]),
    ]


def _identity_to_signin_result(identity: OAuthIdentity) -> dict:
    return {
        "provider": identity.provider,
        "subject": identity.subject,
        "email": identity.email,
        "name": identity.name,
        "accessToken": identity.access_token,
        "refreshToken": identity.refresh_token,
        "expiresAt": identity.expires_at,
    }


async def _find_or_create_user(store: Any, identity: OAuthIdentity) -> Any:
    from graph_caster.tenancy.models import User
    from datetime import datetime, timezone
    import uuid

    existing = await store.find_user_by_email(identity.email)
    if existing is not None:
        return existing
    now = datetime.now(timezone.utc).isoformat()
    new_user = User(
        id=str(uuid.uuid4()),
        email=identity.email,
        name=identity.name,
        created_at=now,
    )
    return await store.create_user(new_user)
