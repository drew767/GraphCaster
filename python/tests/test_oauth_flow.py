# Copyright GraphCaster. All Rights Reserved.

"""Tests for OAuthFlow + StateStore (F85)."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytest.importorskip("httpx")

from graph_caster.auth.oauth.base import OAuthConfig, OAuthIdentity, OAuthProvider
from graph_caster.auth.oauth.flow import OAuthFlow
from graph_caster.auth.oauth.state_store import FileStateStore, InMemoryStateStore


def _make_config() -> OAuthConfig:
    return OAuthConfig(
        client_id="cid",
        client_secret="csecret",
        redirect_uri="https://app.test/cb",
        scopes=["openid"],
    )


class _StubProvider(OAuthProvider):
    name = "stub"

    def authorize_url(self, config: OAuthConfig, state: str) -> str:
        return f"https://stub.example.com/auth?state={state}&client_id={config.client_id}"

    async def exchange_code(self, config: OAuthConfig, code: str) -> OAuthIdentity:
        return OAuthIdentity(
            provider="stub",
            subject="stub-sub",
            email="stub@example.com",
            name="Stub User",
            raw={"code": code},
            access_token="stub-access",
        )

    async def refresh_token(self, config: OAuthConfig, refresh_token: str) -> OAuthIdentity:
        return OAuthIdentity(
            provider="stub",
            subject="stub-sub",
            email="stub@example.com",
            name="Stub User",
            raw={},
            access_token="stub-fresh",
        )


class TestInMemoryStateStore:
    @pytest.mark.anyio
    async def test_put_and_pop_returns_payload(self) -> None:
        store = InMemoryStateStore()
        await store.put("state-abc", {"k": "v"})
        result = await store.pop("state-abc")
        assert result == {"k": "v"}

    @pytest.mark.anyio
    async def test_pop_removes_entry(self) -> None:
        store = InMemoryStateStore()
        await store.put("once", {"x": 1})
        assert await store.pop("once") == {"x": 1}
        assert await store.pop("once") is None

    @pytest.mark.anyio
    async def test_pop_returns_none_for_unknown_state(self) -> None:
        store = InMemoryStateStore()
        assert await store.pop("nonexistent") is None

    @pytest.mark.anyio
    async def test_expired_state_returns_none(self) -> None:
        store = InMemoryStateStore()
        await store.put("expire-me", {"data": True}, ttl_sec=1)
        store._store["expire-me"] = ({"data": True}, time.monotonic() - 1)
        result = await store.pop("expire-me")
        assert result is None


class TestFileStateStore:
    @pytest.mark.anyio
    async def test_put_and_pop_roundtrip(self, tmp_path: Path) -> None:
        store = FileStateStore(tmp_path / "states.jsonl")
        await store.put("fs-state", {"user_id": "abc"})
        result = await store.pop("fs-state")
        assert result == {"user_id": "abc"}

    @pytest.mark.anyio
    async def test_pop_removes_from_file(self, tmp_path: Path) -> None:
        store = FileStateStore(tmp_path / "states.jsonl")
        await store.put("once", {"x": 1})
        assert await store.pop("once") is not None
        assert await store.pop("once") is None

    @pytest.mark.anyio
    async def test_expired_file_state_returns_none(self, tmp_path: Path) -> None:
        import json

        path = tmp_path / "states.jsonl"
        old_entry = json.dumps({
            "state": "expired",
            "payload": {"k": "v"},
            "expires_at": time.time() - 100,
        })
        path.write_text(old_entry + "\n", encoding="utf-8")
        store = FileStateStore(path)
        result = await store.pop("expired")
        assert result is None

    @pytest.mark.anyio
    async def test_multiple_states_in_file(self, tmp_path: Path) -> None:
        store = FileStateStore(tmp_path / "states.jsonl")
        await store.put("s1", {"a": 1})
        await store.put("s2", {"b": 2})
        await store.put("s3", {"c": 3})

        assert await store.pop("s2") == {"b": 2}
        assert await store.pop("s1") == {"a": 1}
        assert await store.pop("s3") == {"c": 3}


class TestOAuthFlow:
    @pytest.mark.anyio
    async def test_start_returns_url_and_state(self) -> None:
        store = InMemoryStateStore()
        flow = OAuthFlow(_StubProvider(), _make_config(), store)
        url, state = await flow.start()
        assert "stub.example.com" in url
        assert state in url
        assert len(state) > 16

    @pytest.mark.anyio
    async def test_start_stores_state_in_store(self) -> None:
        store = InMemoryStateStore()
        flow = OAuthFlow(_StubProvider(), _make_config(), store)
        url, state = await flow.start(extra_payload={"next": "/dashboard"})
        assert state in store._store
        payload = store._store[state][0]
        assert payload["next"] == "/dashboard"
        assert payload["provider"] == "stub"

    @pytest.mark.anyio
    async def test_complete_with_valid_state_returns_identity_and_payload(self) -> None:
        store = InMemoryStateStore()
        flow = OAuthFlow(_StubProvider(), _make_config(), store)
        url, state = await flow.start(extra_payload={"return_to": "/home"})
        identity, payload = await flow.complete("auth-code-123", state)
        assert isinstance(identity, OAuthIdentity)
        assert identity.provider == "stub"
        assert identity.access_token == "stub-access"
        assert payload["return_to"] == "/home"

    @pytest.mark.anyio
    async def test_complete_with_bad_state_raises_value_error(self) -> None:
        store = InMemoryStateStore()
        flow = OAuthFlow(_StubProvider(), _make_config(), store)
        with pytest.raises(ValueError, match="invalid or expired"):
            await flow.complete("code", "bogus-state")

    @pytest.mark.anyio
    async def test_complete_consumes_state_single_use(self) -> None:
        store = InMemoryStateStore()
        flow = OAuthFlow(_StubProvider(), _make_config(), store)
        _url, state = await flow.start()
        await flow.complete("code1", state)
        with pytest.raises(ValueError):
            await flow.complete("code2", state)

    @pytest.mark.anyio
    async def test_expired_state_raises_value_error(self) -> None:
        store = InMemoryStateStore()
        flow = OAuthFlow(_StubProvider(), _make_config(), store)
        _url, state = await flow.start()
        store._store[state] = (store._store[state][0], time.monotonic() - 1)
        with pytest.raises(ValueError, match="invalid or expired"):
            await flow.complete("code", state)

    @pytest.mark.anyio
    async def test_two_separate_flows_independent(self) -> None:
        store = InMemoryStateStore()
        flow = OAuthFlow(_StubProvider(), _make_config(), store)
        _url1, state1 = await flow.start(extra_payload={"user": "a"})
        _url2, state2 = await flow.start(extra_payload={"user": "b"})
        assert state1 != state2
        id1, pay1 = await flow.complete("c1", state1)
        id2, pay2 = await flow.complete("c2", state2)
        assert pay1["user"] == "a"
        assert pay2["user"] == "b"
