# Copyright GraphCaster. All Rights Reserved.

"""Generic OIDC provider: configurable issuer, auto-discovers endpoints."""

from __future__ import annotations

import urllib.parse
from datetime import datetime, timezone
from typing import Any, ClassVar

import httpx

from graph_caster.auth.oauth.base import OAuthConfig, OAuthIdentity, OAuthProvider

_DEFAULT_SCOPES = ["openid", "email", "profile"]


class GenericOIDCProvider(OAuthProvider):
    name: ClassVar[str] = "oidc"

    def __init__(
        self,
        *,
        issuer: str,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._issuer = issuer.rstrip("/")
        self._http = http_client
        self._discovery: dict[str, Any] | None = None

    def _client(self) -> httpx.AsyncClient:
        if self._http is not None:
            return self._http
        return httpx.AsyncClient()

    @property
    def _discovery_url(self) -> str:
        return f"{self._issuer}/.well-known/openid-configuration"

    async def _get_discovery(self) -> dict[str, Any]:
        if self._discovery is not None:
            return self._discovery
        async with self._client() as client:
            resp = await client.get(self._discovery_url)
            resp.raise_for_status()
            self._discovery = resp.json()
        return self._discovery  # type: ignore[return-value]

    def authorize_url(self, config: OAuthConfig, state: str) -> str:
        scopes = config.scopes if config.scopes else _DEFAULT_SCOPES
        auth_endpoint = config.extras.get(
            "authorization_endpoint",
            f"{self._issuer}/authorize",
        )
        params = {
            "client_id": config.client_id,
            "redirect_uri": config.redirect_uri,
            "response_type": "code",
            "scope": " ".join(scopes),
            "state": state,
        }
        params.update({k: v for k, v in config.extras.items() if k != "authorization_endpoint"})
        return auth_endpoint + "?" + urllib.parse.urlencode(params)

    async def exchange_code(self, config: OAuthConfig, code: str) -> OAuthIdentity:
        discovery = await self._get_discovery()
        token_url: str = discovery["token_endpoint"]
        userinfo_url: str = discovery["userinfo_endpoint"]

        async with self._client() as client:
            token_resp = await client.post(
                token_url,
                data={
                    "client_id": config.client_id,
                    "client_secret": config.client_secret,
                    "code": code,
                    "redirect_uri": config.redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            token_resp.raise_for_status()
            tokens: dict[str, Any] = token_resp.json()

            access_token: str = tokens["access_token"]
            refresh_token: str | None = tokens.get("refresh_token")
            expires_in = tokens.get("expires_in")
            expires_at: str | None = None
            if expires_in is not None:
                import time
                expires_at = datetime.fromtimestamp(
                    time.time() + int(expires_in), tz=timezone.utc
                ).isoformat()

            ui_resp = await client.get(
                userinfo_url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            ui_resp.raise_for_status()
            userinfo: dict[str, Any] = ui_resp.json()

        return OAuthIdentity(
            provider=self.name,
            subject=str(userinfo.get("sub", "")),
            email=str(userinfo.get("email", "")),
            name=str(userinfo.get("name", "")),
            raw=userinfo,
            access_token=access_token,
            refresh_token=refresh_token,
            expires_at=expires_at,
        )

    async def refresh_token(self, config: OAuthConfig, refresh_token: str) -> OAuthIdentity:
        discovery = await self._get_discovery()
        token_url: str = discovery["token_endpoint"]
        userinfo_url: str = discovery["userinfo_endpoint"]

        async with self._client() as client:
            token_resp = await client.post(
                token_url,
                data={
                    "client_id": config.client_id,
                    "client_secret": config.client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )
            token_resp.raise_for_status()
            tokens: dict[str, Any] = token_resp.json()

            access_token: str = tokens["access_token"]
            new_refresh = tokens.get("refresh_token", refresh_token)
            expires_in = tokens.get("expires_in")
            expires_at: str | None = None
            if expires_in is not None:
                import time
                expires_at = datetime.fromtimestamp(
                    time.time() + int(expires_in), tz=timezone.utc
                ).isoformat()

            ui_resp = await client.get(
                userinfo_url,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            ui_resp.raise_for_status()
            userinfo: dict[str, Any] = ui_resp.json()

        return OAuthIdentity(
            provider=self.name,
            subject=str(userinfo.get("sub", "")),
            email=str(userinfo.get("email", "")),
            name=str(userinfo.get("name", "")),
            raw=userinfo,
            access_token=access_token,
            refresh_token=new_refresh,
            expires_at=expires_at,
        )
