# Copyright GraphCaster. All Rights Reserved.

"""Tests for the OAuth state TTL guard added to OAuthFlow.complete()."""

from __future__ import annotations

import pytest

from graph_caster.auth.oauth.base import OAuthConfig, OAuthIdentity, OAuthProvider
from graph_caster.auth.oauth.flow import (
    OAuthFlow,
    OAuthStateExpired,
    _DEFAULT_STATE_TTL_SEC,
    _state_ttl_from_env,
)
from graph_caster.auth.oauth.state_store import InMemoryStateStore


def _config() -> OAuthConfig:
    return OAuthConfig(
        client_id="cid",
        client_secret="csecret",
        redirect_uri="https://app.test/cb",
        scopes=["openid"],
    )


class _StubProvider(OAuthProvider):
    name = "stub"

    def authorize_url(self, config: OAuthConfig, state: str) -> str:
        return f"https://stub.test/auth?state={state}"

    async def exchange_code(self, config: OAuthConfig, code: str) -> OAuthIdentity:
        return OAuthIdentity(
            provider="stub",
            subject="sub",
            email="a@b.test",
            name="A",
            raw={"code": code},
            access_token="acc",
        )

    async def refresh_token(self, config: OAuthConfig, refresh_token: str) -> OAuthIdentity:
        return OAuthIdentity(
            provider="stub",
            subject="sub",
            email="a@b.test",
            name="A",
            raw={},
            access_token="acc2",
        )


def test_state_ttl_from_env_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_OAUTH_STATE_TTL_SEC", raising=False)
    assert _state_ttl_from_env() == _DEFAULT_STATE_TTL_SEC == 600


def test_state_ttl_from_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_OAUTH_STATE_TTL_SEC", "120")
    assert _state_ttl_from_env() == 120


def test_state_ttl_from_env_invalid_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_OAUTH_STATE_TTL_SEC", "garbage")
    assert _state_ttl_from_env() == _DEFAULT_STATE_TTL_SEC


def test_state_ttl_from_env_nonpositive_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_OAUTH_STATE_TTL_SEC", "0")
    assert _state_ttl_from_env() == _DEFAULT_STATE_TTL_SEC


@pytest.mark.anyio
async def test_complete_succeeds_within_ttl(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_now = {"t": 1_000.0}

    def _now() -> float:
        return fake_now["t"]

    monkeypatch.setattr("graph_caster.auth.oauth.flow.time.time", _now)
    flow = OAuthFlow(_StubProvider(), _config(), InMemoryStateStore(), state_ttl_sec=600)
    _url, state = await flow.start(extra_payload={"return_to": "/x"})

    fake_now["t"] = 1_000.0 + 300.0  # within TTL
    identity, payload = await flow.complete("code", state)
    assert identity.provider == "stub"
    assert payload["return_to"] == "/x"
    # Internal marker must not leak to caller payload.
    assert "_gc_state_created_at" not in payload


@pytest.mark.anyio
async def test_complete_rejects_expired_state(monkeypatch: pytest.MonkeyPatch) -> None:
    fake_now = {"t": 5_000.0}

    def _now() -> float:
        return fake_now["t"]

    monkeypatch.setattr("graph_caster.auth.oauth.flow.time.time", _now)
    flow = OAuthFlow(_StubProvider(), _config(), InMemoryStateStore(), state_ttl_sec=600)
    _url, state = await flow.start()

    # Advance well past TTL.
    fake_now["t"] = 5_000.0 + 1_200.0
    with pytest.raises(OAuthStateExpired) as exc:
        await flow.complete("code", state)
    assert "expired" in str(exc.value).lower()


@pytest.mark.anyio
async def test_oauth_state_expired_is_value_error_for_backcompat() -> None:
    """Existing call-sites that catch ``ValueError`` must keep working."""
    flow = OAuthFlow(_StubProvider(), _config(), InMemoryStateStore())
    with pytest.raises(ValueError):
        await flow.complete("code", "bogus-state")


@pytest.mark.anyio
async def test_complete_with_unknown_state_raises_oauth_state_expired() -> None:
    flow = OAuthFlow(_StubProvider(), _config(), InMemoryStateStore())
    with pytest.raises(OAuthStateExpired):
        await flow.complete("code", "never-issued")


@pytest.mark.anyio
async def test_ttl_env_override_applies_to_default_construction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GC_OAUTH_STATE_TTL_SEC", "42")
    flow = OAuthFlow(_StubProvider(), _config(), InMemoryStateStore())
    assert flow.state_ttl_sec == 42
