# Copyright GraphCaster. All Rights Reserved.

"""Tests for OAuth2 / OIDC provider implementations (F85)."""

from __future__ import annotations

import json
import time
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytest.importorskip("httpx")

import httpx

from graph_caster.auth.oauth.base import OAuthConfig, OAuthIdentity
from graph_caster.auth.oauth.google import GoogleOAuthProvider
from graph_caster.auth.oauth.github import GitHubOAuthProvider
from graph_caster.auth.oauth.microsoft import MicrosoftOAuthProvider
from graph_caster.auth.oauth.generic_oidc import GenericOIDCProvider


def _make_config(provider: str = "google") -> OAuthConfig:
    return OAuthConfig(
        client_id="test-client-id",
        client_secret="test-client-secret",
        redirect_uri="https://app.example.com/callback",
        scopes=["openid", "email", "profile"],
    )


def _mock_response(status_code: int = 200, json_body: Any = None) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = status_code
    resp.json.return_value = json_body or {}
    resp.raise_for_status = MagicMock()
    if status_code >= 400:
        resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            f"HTTP {status_code}", request=MagicMock(), response=resp
        )
    return resp


_GOOGLE_DISCOVERY = {
    "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_endpoint": "https://oauth2.googleapis.com/token",
    "userinfo_endpoint": "https://openidconnect.googleapis.com/v1/userinfo",
}

_GOOGLE_TOKENS = {
    "access_token": "goog-access-token",
    "refresh_token": "goog-refresh-token",
    "expires_in": 3600,
}

_GOOGLE_USERINFO = {
    "sub": "google-uid-123",
    "email": "user@example.com",
    "name": "Test User",
}


class TestGoogleOAuthProvider:
    def test_authorize_url_shape(self) -> None:
        provider = GoogleOAuthProvider()
        config = _make_config()
        url = provider.authorize_url(config, state="csrf-state-abc")
        assert "accounts.google.com" in url
        assert "response_type=code" in url
        assert "client_id=test-client-id" in url
        assert "state=csrf-state-abc" in url
        assert "redirect_uri=" in url
        assert "scope=" in url

    @pytest.mark.anyio
    async def test_exchange_code_produces_identity(self) -> None:
        provider = GoogleOAuthProvider()
        provider._discovery = _GOOGLE_DISCOVERY

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=_mock_response(200, _GOOGLE_TOKENS))
        mock_client.get = AsyncMock(return_value=_mock_response(200, _GOOGLE_USERINFO))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        provider._http = mock_client

        identity = await provider.exchange_code(_make_config(), "auth-code-xyz")

        assert isinstance(identity, OAuthIdentity)
        assert identity.provider == "google"
        assert identity.subject == "google-uid-123"
        assert identity.email == "user@example.com"
        assert identity.name == "Test User"
        assert identity.access_token == "goog-access-token"
        assert identity.refresh_token == "goog-refresh-token"
        assert identity.expires_at is not None

    @pytest.mark.anyio
    async def test_refresh_token_returns_new_identity(self) -> None:
        provider = GoogleOAuthProvider()
        provider._discovery = _GOOGLE_DISCOVERY

        fresh_tokens = {"access_token": "goog-fresh-token", "expires_in": 3600}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=_mock_response(200, fresh_tokens))
        mock_client.get = AsyncMock(return_value=_mock_response(200, _GOOGLE_USERINFO))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        provider._http = mock_client

        identity = await provider.refresh_token(_make_config(), "old-refresh-token")
        assert identity.access_token == "goog-fresh-token"
        assert identity.email == "user@example.com"


_GITHUB_TOKENS = {
    "access_token": "gh-access-token",
    "token_type": "bearer",
}

_GITHUB_USERINFO = {
    "id": 99999,
    "login": "ghuser",
    "name": "GitHub User",
    "email": "ghuser@example.com",
}

_GITHUB_EMAILS = [
    {"email": "ghuser@example.com", "primary": True, "verified": True},
]


class TestGitHubOAuthProvider:
    def test_authorize_url_shape(self) -> None:
        provider = GitHubOAuthProvider()
        config = _make_config()
        url = provider.authorize_url(config, state="state-gh")
        assert "github.com/login/oauth/authorize" in url
        assert "client_id=test-client-id" in url
        assert "state=state-gh" in url

    @pytest.mark.anyio
    async def test_exchange_code_produces_identity(self) -> None:
        provider = GitHubOAuthProvider()

        call_count = 0

        async def mock_post(url, **kwargs):
            return _mock_response(200, _GITHUB_TOKENS)

        async def mock_get(url, **kwargs):
            nonlocal call_count
            call_count += 1
            if "emails" in url:
                return _mock_response(200, _GITHUB_EMAILS)
            return _mock_response(200, _GITHUB_USERINFO)

        mock_client = AsyncMock()
        mock_client.post = mock_post
        mock_client.get = mock_get
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        provider._http = mock_client

        identity = await provider.exchange_code(_make_config(), "gh-code")
        assert identity.provider == "github"
        assert identity.subject == "99999"
        assert identity.email == "ghuser@example.com"
        assert identity.name == "GitHub User"
        assert identity.access_token == "gh-access-token"

    @pytest.mark.anyio
    async def test_exchange_code_falls_back_to_emails_api_when_no_public_email(self) -> None:
        provider = GitHubOAuthProvider()
        userinfo_no_email = {**_GITHUB_USERINFO, "email": None}

        async def mock_post(url, **kwargs):
            return _mock_response(200, _GITHUB_TOKENS)

        async def mock_get(url, **kwargs):
            if "emails" in url:
                return _mock_response(200, _GITHUB_EMAILS)
            return _mock_response(200, userinfo_no_email)

        mock_client = AsyncMock()
        mock_client.post = mock_post
        mock_client.get = mock_get
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        provider._http = mock_client

        identity = await provider.exchange_code(_make_config(), "gh-code")
        assert identity.email == "ghuser@example.com"

    @pytest.mark.anyio
    async def test_exchange_code_raises_on_token_error(self) -> None:
        provider = GitHubOAuthProvider()
        error_response = {"error": "bad_verification_code", "error_description": "Bad code"}

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=_mock_response(200, error_response))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        provider._http = mock_client

        with pytest.raises(ValueError, match="Bad code"):
            await provider.exchange_code(_make_config(), "bad-code")

    @pytest.mark.anyio
    async def test_refresh_token_returns_new_identity(self) -> None:
        provider = GitHubOAuthProvider()
        fresh = {"access_token": "gh-fresh", "refresh_token": "gh-new-refresh"}

        async def mock_post(url, **kwargs):
            return _mock_response(200, fresh)

        async def mock_get(url, **kwargs):
            if "emails" in url:
                return _mock_response(200, _GITHUB_EMAILS)
            return _mock_response(200, _GITHUB_USERINFO)

        mock_client = AsyncMock()
        mock_client.post = mock_post
        mock_client.get = mock_get
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        provider._http = mock_client

        identity = await provider.refresh_token(_make_config(), "old-refresh")
        assert identity.access_token == "gh-fresh"
        assert identity.refresh_token == "gh-new-refresh"


_MS_DISCOVERY = {
    "authorization_endpoint": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    "token_endpoint": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    "userinfo_endpoint": "https://graph.microsoft.com/oidc/userinfo",
}

_MS_TOKENS = {
    "access_token": "ms-access-token",
    "refresh_token": "ms-refresh-token",
    "expires_in": 3600,
}

_MS_USERINFO = {
    "sub": "ms-uid-456",
    "email": "ms@example.com",
    "name": "MS User",
}


class TestMicrosoftOAuthProvider:
    def test_authorize_url_shape(self) -> None:
        provider = MicrosoftOAuthProvider()
        url = provider.authorize_url(_make_config(), "ms-state")
        assert "login.microsoftonline.com" in url
        assert "client_id=test-client-id" in url
        assert "state=ms-state" in url

    @pytest.mark.anyio
    async def test_exchange_code_produces_identity(self) -> None:
        provider = MicrosoftOAuthProvider()
        provider._discovery = _MS_DISCOVERY

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=_mock_response(200, _MS_TOKENS))
        mock_client.get = AsyncMock(return_value=_mock_response(200, _MS_USERINFO))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        provider._http = mock_client

        identity = await provider.exchange_code(_make_config(), "ms-code")
        assert identity.provider == "microsoft"
        assert identity.subject == "ms-uid-456"
        assert identity.email == "ms@example.com"
        assert identity.access_token == "ms-access-token"

    @pytest.mark.anyio
    async def test_refresh_token(self) -> None:
        provider = MicrosoftOAuthProvider()
        provider._discovery = _MS_DISCOVERY

        fresh = {"access_token": "ms-fresh", "expires_in": 3600}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=_mock_response(200, fresh))
        mock_client.get = AsyncMock(return_value=_mock_response(200, _MS_USERINFO))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        provider._http = mock_client

        identity = await provider.refresh_token(_make_config(), "ms-old-refresh")
        assert identity.access_token == "ms-fresh"


_OIDC_DISCOVERY = {
    "authorization_endpoint": "https://idp.example.com/authorize",
    "token_endpoint": "https://idp.example.com/token",
    "userinfo_endpoint": "https://idp.example.com/userinfo",
}

_OIDC_TOKENS = {
    "access_token": "oidc-access",
    "refresh_token": "oidc-refresh",
    "expires_in": 3600,
}

_OIDC_USERINFO = {
    "sub": "oidc-sub-789",
    "email": "oidc@example.com",
    "name": "OIDC User",
}


class TestGenericOIDCProvider:
    def test_authorize_url_shape(self) -> None:
        provider = GenericOIDCProvider(issuer="https://idp.example.com")
        url = provider.authorize_url(_make_config(), "oidc-state")
        assert "idp.example.com" in url
        assert "state=oidc-state" in url
        assert "response_type=code" in url

    @pytest.mark.anyio
    async def test_exchange_code_produces_identity(self) -> None:
        provider = GenericOIDCProvider(issuer="https://idp.example.com")
        provider._discovery = _OIDC_DISCOVERY

        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=_mock_response(200, _OIDC_TOKENS))
        mock_client.get = AsyncMock(return_value=_mock_response(200, _OIDC_USERINFO))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        provider._http = mock_client

        identity = await provider.exchange_code(_make_config(), "oidc-code")
        assert identity.provider == "oidc"
        assert identity.subject == "oidc-sub-789"
        assert identity.email == "oidc@example.com"
        assert identity.access_token == "oidc-access"

    @pytest.mark.anyio
    async def test_refresh_token(self) -> None:
        provider = GenericOIDCProvider(issuer="https://idp.example.com")
        provider._discovery = _OIDC_DISCOVERY

        fresh = {"access_token": "oidc-fresh", "expires_in": 7200}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=_mock_response(200, fresh))
        mock_client.get = AsyncMock(return_value=_mock_response(200, _OIDC_USERINFO))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=None)

        provider._http = mock_client

        identity = await provider.refresh_token(_make_config(), "old-refresh")
        assert identity.access_token == "oidc-fresh"
        assert identity.expires_at is not None
