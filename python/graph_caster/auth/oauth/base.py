# Copyright GraphCaster. All Rights Reserved.

"""OAuth2 / OIDC provider abstract base classes and shared dataclasses."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import ClassVar


@dataclass
class OAuthConfig:
    client_id: str
    client_secret: str
    redirect_uri: str
    scopes: list[str]
    extras: dict = field(default_factory=dict)


@dataclass
class OAuthIdentity:
    provider: str
    subject: str
    email: str
    name: str
    raw: dict
    access_token: str
    refresh_token: str | None = None
    expires_at: str | None = None


class OAuthProvider(ABC):
    name: ClassVar[str]

    @abstractmethod
    def authorize_url(self, config: OAuthConfig, state: str) -> str:
        """Return the provider's authorization URL for the given config and CSRF state."""

    @abstractmethod
    async def exchange_code(self, config: OAuthConfig, code: str) -> OAuthIdentity:
        """Exchange an authorization code for an OAuthIdentity."""

    @abstractmethod
    async def refresh_token(self, config: OAuthConfig, refresh_token: str) -> OAuthIdentity:
        """Use a refresh token to obtain fresh tokens and return an updated OAuthIdentity."""
