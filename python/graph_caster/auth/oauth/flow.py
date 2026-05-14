# Copyright GraphCaster. All Rights Reserved.

"""High-level OAuth flow: start (authorize) → complete (callback + token exchange)."""

from __future__ import annotations

import os
import secrets
import time

from graph_caster.auth.oauth.base import OAuthConfig, OAuthIdentity, OAuthProvider
from graph_caster.auth.oauth.state_store import StateStore


_DEFAULT_STATE_TTL_SEC = 600
_STATE_CREATED_AT_KEY = "_gc_state_created_at"


class OAuthStateExpired(ValueError):
    """Raised when an OAuth state token is past its TTL or missing/invalid.

    Inherits from :class:`ValueError` so existing call-sites that catch
    ``ValueError`` continue to work.
    """


def _state_ttl_from_env() -> int:
    raw = os.environ.get("GC_OAUTH_STATE_TTL_SEC", "").strip()
    if not raw:
        return _DEFAULT_STATE_TTL_SEC
    try:
        v = int(raw)
        return v if v > 0 else _DEFAULT_STATE_TTL_SEC
    except ValueError:
        return _DEFAULT_STATE_TTL_SEC


class OAuthFlow:
    """Orchestrates the OAuth2 authorization-code flow with CSRF state validation."""

    def __init__(
        self,
        provider: OAuthProvider,
        config: OAuthConfig,
        state_store: StateStore,
        *,
        state_ttl_sec: int | None = None,
    ) -> None:
        self._provider = provider
        self._config = config
        self._state_store = state_store
        self._state_ttl_sec = (
            int(state_ttl_sec) if state_ttl_sec is not None else _state_ttl_from_env()
        )

    @property
    def state_ttl_sec(self) -> int:
        return self._state_ttl_sec

    async def start(self, *, extra_payload: dict | None = None) -> tuple[str, str]:
        """Generate a CSRF state token, store it, and return (authorize_url, state)."""
        state = secrets.token_urlsafe(32)
        payload: dict = {"provider": self._provider.name, _STATE_CREATED_AT_KEY: time.time()}
        if extra_payload:
            for k, v in extra_payload.items():
                if k == _STATE_CREATED_AT_KEY:
                    continue
                payload[k] = v
        await self._state_store.put(state, payload, ttl_sec=self._state_ttl_sec)
        url = self._provider.authorize_url(self._config, state)
        return url, state

    async def complete(self, code: str, state: str) -> tuple[OAuthIdentity, dict]:
        """Validate CSRF state, exchange code, return (identity, original_extra_payload).

        Raises :class:`OAuthStateExpired` (a ``ValueError`` subclass) if the
        state is unknown, has been consumed, or exceeds the configured TTL
        (``GC_OAUTH_STATE_TTL_SEC``, default 600 s).
        """
        payload = await self._state_store.pop(state)
        if payload is None:
            raise OAuthStateExpired(
                f"OAuth state {state!r} is invalid or expired (CSRF check failed)"
            )
        created_at = payload.pop(_STATE_CREATED_AT_KEY, None)
        if isinstance(created_at, (int, float)):
            age = time.time() - float(created_at)
            if age > self._state_ttl_sec:
                raise OAuthStateExpired(
                    f"OAuth state {state!r} expired after {age:.1f}s "
                    f"(ttl={self._state_ttl_sec}s)"
                )
        identity = await self._provider.exchange_code(self._config, code)
        return identity, payload
