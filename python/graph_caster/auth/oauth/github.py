# Copyright GraphCaster. All Rights Reserved.

"""GitHub OAuth2 provider (not OIDC; uses /user and /user/emails APIs)."""

from __future__ import annotations

import urllib.parse
from typing import Any, ClassVar

import httpx

from graph_caster.auth.oauth.base import OAuthConfig, OAuthIdentity, OAuthProvider

_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
_TOKEN_URL = "https://github.com/login/oauth/access_token"
_USER_URL = "https://api.github.com/user"
_EMAILS_URL = "https://api.github.com/user/emails"
_DEFAULT_SCOPES = ["read:user", "user:email"]


class GitHubOAuthProvider(OAuthProvider):
    name: ClassVar[str] = "github"

    def __init__(self, *, http_client: httpx.AsyncClient | None = None) -> None:
        self._http = http_client

    def _client(self) -> httpx.AsyncClient:
        if self._http is not None:
            return self._http
        return httpx.AsyncClient()

    def authorize_url(self, config: OAuthConfig, state: str) -> str:
        scopes = config.scopes if config.scopes else _DEFAULT_SCOPES
        params = {
            "client_id": config.client_id,
            "redirect_uri": config.redirect_uri,
            "scope": " ".join(scopes),
            "state": state,
        }
        params.update(config.extras)
        return _AUTHORIZE_URL + "?" + urllib.parse.urlencode(params)

    async def _fetch_primary_email(self, client: httpx.AsyncClient, access_token: str) -> str:
        try:
            resp = await client.get(
                _EMAILS_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                },
            )
            resp.raise_for_status()
            emails: list[dict[str, Any]] = resp.json()
            for entry in emails:
                if entry.get("primary") and entry.get("verified"):
                    return str(entry.get("email", ""))
            for entry in emails:
                if entry.get("primary"):
                    return str(entry.get("email", ""))
            if emails:
                return str(emails[0].get("email", ""))
        except Exception:
            pass
        return ""

    async def exchange_code(self, config: OAuthConfig, code: str) -> OAuthIdentity:
        async with self._client() as client:
            token_resp = await client.post(
                _TOKEN_URL,
                data={
                    "client_id": config.client_id,
                    "client_secret": config.client_secret,
                    "code": code,
                    "redirect_uri": config.redirect_uri,
                },
                headers={"Accept": "application/json"},
            )
            token_resp.raise_for_status()
            tokens: dict[str, Any] = token_resp.json()

            if "error" in tokens:
                raise ValueError(f"GitHub token error: {tokens.get('error_description', tokens['error'])}")

            access_token: str = tokens["access_token"]
            refresh_token: str | None = tokens.get("refresh_token")

            user_resp = await client.get(
                _USER_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                },
            )
            user_resp.raise_for_status()
            userinfo: dict[str, Any] = user_resp.json()

            email: str = str(userinfo.get("email") or "")
            if not email:
                email = await self._fetch_primary_email(client, access_token)

        return OAuthIdentity(
            provider=self.name,
            subject=str(userinfo.get("id", "")),
            email=email,
            name=str(userinfo.get("name") or userinfo.get("login", "")),
            raw=userinfo,
            access_token=access_token,
            refresh_token=refresh_token,
        )

    async def refresh_token(self, config: OAuthConfig, refresh_token: str) -> OAuthIdentity:
        async with self._client() as client:
            token_resp = await client.post(
                _TOKEN_URL,
                data={
                    "client_id": config.client_id,
                    "client_secret": config.client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
                headers={"Accept": "application/json"},
            )
            token_resp.raise_for_status()
            tokens: dict[str, Any] = token_resp.json()

            if "error" in tokens:
                raise ValueError(f"GitHub token error: {tokens.get('error_description', tokens['error'])}")

            access_token: str = tokens["access_token"]
            new_refresh: str | None = tokens.get("refresh_token", refresh_token)

            user_resp = await client.get(
                _USER_URL,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                },
            )
            user_resp.raise_for_status()
            userinfo: dict[str, Any] = user_resp.json()

            email: str = str(userinfo.get("email") or "")
            if not email:
                email = await self._fetch_primary_email(client, access_token)

        return OAuthIdentity(
            provider=self.name,
            subject=str(userinfo.get("id", "")),
            email=email,
            name=str(userinfo.get("name") or userinfo.get("login", "")),
            raw=userinfo,
            access_token=access_token,
            refresh_token=new_refresh,
        )
