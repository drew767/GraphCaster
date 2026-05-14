# Copyright GraphCaster. All Rights Reserved.

"""Tests for SSO REST API endpoints (F85)."""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytest.importorskip("starlette")
pytest.importorskip("httpx")

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from graph_caster.auth.oauth.base import OAuthConfig, OAuthIdentity, OAuthProvider
from graph_caster.auth.oauth.flow import OAuthFlow
from graph_caster.auth.oauth.state_store import InMemoryStateStore
from graph_caster.auth.oauth.sso_routes import make_sso_routes


def _build_app(state_store: InMemoryStateStore | None = None) -> Any:
    routes = make_sso_routes(state_store=state_store)
    return Starlette(routes=routes)


def _env_for_provider(provider: str = "google") -> dict[str, str]:
    prefix = f"GC_OAUTH_{provider.upper()}"
    return {
        f"{prefix}_CLIENT_ID": "test-cid",
        f"{prefix}_CLIENT_SECRET": "test-csecret",
        f"{prefix}_REDIRECT_URI": "https://app.test/callback",
    }


class _StubProvider(OAuthProvider):
    name = "google"

    def authorize_url(self, config: OAuthConfig, state: str) -> str:
        return f"https://accounts.google.com/auth?state={state}"

    async def exchange_code(self, config: OAuthConfig, code: str) -> OAuthIdentity:
        return OAuthIdentity(
            provider="google",
            subject="uid-1",
            email="user@gmail.com",
            name="Test User",
            raw={"code": code},
            access_token="tok-abc",
        )

    async def refresh_token(self, config: OAuthConfig, refresh_token: str) -> OAuthIdentity:
        raise NotImplementedError


class TestSSOLoginEndpoint:
    def test_login_unknown_provider_returns_404(self) -> None:
        app = _build_app()
        with TestClient(app, raise_server_exceptions=True) as client:
            resp = client.get("/api/v1/auth/sso/notreal/login", follow_redirects=False)
        assert resp.status_code == 404

    def test_login_unconfigured_provider_returns_503(self) -> None:
        app = _build_app()
        env_no_creds: dict[str, str] = {}
        with patch.dict(os.environ, env_no_creds, clear=False):
            for key in list(os.environ.keys()):
                if "GC_OAUTH_GOOGLE" in key:
                    del os.environ[key]
            with TestClient(app, raise_server_exceptions=True) as client:
                resp = client.get("/api/v1/auth/sso/google/login", follow_redirects=False)
        assert resp.status_code in (503, 404)

    def test_login_configured_redirects_302(self) -> None:
        store = InMemoryStateStore()
        app = _build_app(state_store=store)

        with patch.dict(os.environ, _env_for_provider("google")), \
             patch(
                 "graph_caster.auth.oauth.sso_routes._make_provider",
                 return_value=_StubProvider(),
             ):
            with TestClient(app, raise_server_exceptions=True) as client:
                resp = client.get("/api/v1/auth/sso/google/login", follow_redirects=False)

        assert resp.status_code == 302
        location = resp.headers.get("location", "")
        assert "accounts.google.com" in location
        assert "state=" in location

    def test_login_sets_state_cookie(self) -> None:
        store = InMemoryStateStore()
        app = _build_app(state_store=store)

        with patch.dict(os.environ, _env_for_provider("google")), \
             patch(
                 "graph_caster.auth.oauth.sso_routes._make_provider",
                 return_value=_StubProvider(),
             ):
            with TestClient(app, raise_server_exceptions=True) as client:
                resp = client.get("/api/v1/auth/sso/google/login", follow_redirects=False)

        assert resp.status_code == 302
        assert "gc_oauth_state" in resp.cookies


class TestSSOCallbackEndpoint:
    def test_callback_missing_code_returns_400(self) -> None:
        app = _build_app()
        with patch.dict(os.environ, _env_for_provider("google")):
            with TestClient(app, raise_server_exceptions=True) as client:
                resp = client.get("/api/v1/auth/sso/google/callback?state=abc", follow_redirects=False)
        assert resp.status_code == 400

    def test_callback_bad_state_returns_400(self) -> None:
        store = InMemoryStateStore()
        app = _build_app(state_store=store)

        with patch.dict(os.environ, _env_for_provider("google")), \
             patch(
                 "graph_caster.auth.oauth.sso_routes._make_provider",
                 return_value=_StubProvider(),
             ):
            with TestClient(app, raise_server_exceptions=True) as client:
                resp = client.get(
                    "/api/v1/auth/sso/google/callback?code=somecode&state=bad-state",
                    follow_redirects=False,
                )

        assert resp.status_code == 400
        assert "invalid or expired" in resp.json().get("error", "")

    def test_callback_valid_exchanges_and_returns_identity(self) -> None:
        store = InMemoryStateStore()
        app = _build_app(state_store=store)

        with patch.dict(os.environ, _env_for_provider("google")), \
             patch(
                 "graph_caster.auth.oauth.sso_routes._make_provider",
                 return_value=_StubProvider(),
             ):
            with TestClient(app, raise_server_exceptions=True) as client:
                login_resp = client.get("/api/v1/auth/sso/google/login", follow_redirects=False)
                assert login_resp.status_code == 302

                location = login_resp.headers["location"]
                from urllib.parse import urlparse, parse_qs
                qs = parse_qs(urlparse(location).query)
                state = qs["state"][0]

                cb_resp = client.get(
                    f"/api/v1/auth/sso/google/callback?code=auth-code-abc&state={state}",
                    follow_redirects=False,
                )

        assert cb_resp.status_code == 200
        body = cb_resp.json()
        assert body["provider"] == "google"
        assert body["email"] == "user@gmail.com"
        assert body["accessToken"] == "tok-abc"

    def test_callback_unknown_provider_returns_404(self) -> None:
        app = _build_app()
        with TestClient(app, raise_server_exceptions=True) as client:
            resp = client.get(
                "/api/v1/auth/sso/nosuchprovider/callback?code=x&state=y",
                follow_redirects=False,
            )
        assert resp.status_code == 404
