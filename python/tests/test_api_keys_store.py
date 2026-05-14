# Copyright GraphCaster. All Rights Reserved.

"""Tests for ApiKeyStore (5 tests)."""

from __future__ import annotations

from pathlib import Path

import pytest

from graph_caster.auth.api_keys import ApiKeyStore


@pytest.mark.anyio
async def test_create_returns_record_and_raw_key(tmp_path: Path) -> None:
    store = ApiKeyStore(tmp_path)
    rec, raw_key = await store.create("u1", "t1", "My Key", ["run:execute"])
    assert rec.id.startswith("gc_")
    assert rec.user_id == "u1"
    assert rec.tenant_id == "t1"
    assert rec.label == "My Key"
    assert rec.scopes == ["run:execute"]
    assert len(raw_key) > 20
    assert raw_key.startswith("gc_")


@pytest.mark.anyio
async def test_list_own_keys(tmp_path: Path) -> None:
    store = ApiKeyStore(tmp_path)
    await store.create("u1", "t1", "Key A", ["run:view"])
    await store.create("u1", "t1", "Key B", ["run:execute"])
    await store.create("u2", "t1", "Key C", ["run:view"])
    keys = await store.list("u1", "t1")
    assert len(keys) == 2
    assert all(k.user_id == "u1" for k in keys)


@pytest.mark.anyio
async def test_verify_valid_key(tmp_path: Path) -> None:
    store = ApiKeyStore(tmp_path)
    rec, raw_key = await store.create("u1", "t1", "Label", ["*"])
    found = await store.verify(raw_key)
    assert found is not None
    assert found.id == rec.id
    assert found.user_id == "u1"


@pytest.mark.anyio
async def test_verify_wrong_key_returns_none(tmp_path: Path) -> None:
    store = ApiKeyStore(tmp_path)
    await store.create("u1", "t1", "Label", ["*"])
    found = await store.verify("gc_totally-wrong-secret")
    assert found is None


@pytest.mark.anyio
async def test_revoke_removes_key(tmp_path: Path) -> None:
    store = ApiKeyStore(tmp_path)
    rec, raw_key = await store.create("u1", "t1", "Temp Key", ["run:view"])
    await store.revoke(rec.id, "u1", "t1")
    found = await store.verify(raw_key)
    assert found is None
    keys = await store.list("u1", "t1")
    assert keys == []


@pytest.mark.anyio
async def test_touch_last_used(tmp_path: Path) -> None:
    store = ApiKeyStore(tmp_path)
    rec, _ = await store.create("u1", "t1", "Key", [])
    assert rec.last_used_at is None
    await store.touch_last_used(rec.id, "t1")
    updated = await store.get(rec.id, "t1")
    assert updated is not None
    assert updated.last_used_at is not None


@pytest.mark.anyio
async def test_revoke_wrong_user_raises(tmp_path: Path) -> None:
    store = ApiKeyStore(tmp_path)
    rec, _ = await store.create("u1", "t1", "Key", [])
    with pytest.raises(PermissionError):
        await store.revoke(rec.id, "u-other", "t1")
