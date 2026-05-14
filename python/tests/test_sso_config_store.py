# Copyright GraphCaster. All Rights Reserved.

"""Tests for SsoConfigStore (F85 extension) — InMemorySsoConfigStore, 5 tests."""

from __future__ import annotations

import pytest

from graph_caster.auth.sso_config import InMemorySsoConfigStore, SsoProviderConfig


def _make_cfg(provider: str = "google") -> SsoProviderConfig:
    return SsoProviderConfig(
        provider=provider,
        enabled=True,
        client_id="client-123",
        client_secret_encrypted="enc:secret",
        redirect_uri="https://app.example.com/auth/callback",
        domain_restriction="@example.com",
    )


@pytest.mark.anyio
async def test_upsert_and_get():
    store = InMemorySsoConfigStore()
    cfg = await store.upsert("google", "t1", _make_cfg("google"))
    assert cfg.provider == "google"
    assert cfg.client_id == "client-123"
    fetched = await store.get("google", "t1")
    assert fetched is not None
    assert fetched.redirect_uri == "https://app.example.com/auth/callback"


@pytest.mark.anyio
async def test_list():
    store = InMemorySsoConfigStore()
    await store.upsert("google", "t1", _make_cfg("google"))
    await store.upsert("github", "t1", _make_cfg("github"))
    await store.upsert("google", "t2", _make_cfg("google"))
    providers_t1 = await store.list("t1")
    assert len(providers_t1) == 2
    assert {c.provider for c in providers_t1} == {"google", "github"}


@pytest.mark.anyio
async def test_get_missing_returns_none():
    store = InMemorySsoConfigStore()
    result = await store.get("microsoft", "t1")
    assert result is None


@pytest.mark.anyio
async def test_delete():
    store = InMemorySsoConfigStore()
    await store.upsert("github", "t1", _make_cfg("github"))
    await store.delete("github", "t1")
    assert await store.get("github", "t1") is None


@pytest.mark.anyio
async def test_test_not_configured():
    store = InMemorySsoConfigStore()
    result = await store.test("oidc", "t1")
    assert result["ok"] is False
    assert "not configured" in result["message"]
