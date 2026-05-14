# Copyright GraphCaster. All Rights Reserved.

"""Tests for CredentialStore (10 tests)."""

from __future__ import annotations

from pathlib import Path

import pytest

from graph_caster.credentials.store import (
    CredentialStore,
    _encrypt_field,
    _decrypt_field,
    _workspace_key,
)


@pytest.mark.anyio
async def test_create_and_get(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path)
    rec = await store.create(
        tenant_id="t1",
        name="OpenAI key",
        type="openai",
        fields={"api_key": "sk-secret"},
    )
    assert rec.id
    assert rec.name == "OpenAI key"
    assert rec.type == "openai"
    assert rec.fields["api_key"] == "sk-secret"

    fetched = await store.get(rec.id, "t1")
    assert fetched is not None
    assert fetched.id == rec.id
    assert fetched.fields["api_key"] == "sk-secret"


@pytest.mark.anyio
async def test_list_all(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path)
    await store.create("t1", "Key A", "anthropic", {"api_key": "ant-1"})
    await store.create("t1", "Key B", "openai", {"api_key": "oai-2"})
    all_recs = await store.list("t1")
    assert len(all_recs) == 2


@pytest.mark.anyio
async def test_list_type_filter(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path)
    await store.create("t1", "Key A", "anthropic", {"api_key": "a"})
    await store.create("t1", "Key B", "openai", {"api_key": "b"})
    anthropic_recs = await store.list("t1", type_filter="anthropic")
    assert len(anthropic_recs) == 1
    assert anthropic_recs[0].type == "anthropic"


@pytest.mark.anyio
async def test_list_search(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path)
    await store.create("t1", "Prod OpenAI", "openai", {"api_key": "p"})
    await store.create("t1", "Dev Slack", "slack", {"token": "t"})
    results = await store.list("t1", search="prod")
    assert len(results) == 1
    assert results[0].name == "Prod OpenAI"


@pytest.mark.anyio
async def test_update(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path)
    rec = await store.create("t1", "Old name", "openai", {"api_key": "sk-old"})
    updated = await store.update(rec.id, "t1", {"name": "New name", "fields": {"api_key": "sk-new"}})
    assert updated.name == "New name"
    assert updated.fields["api_key"] == "sk-new"


@pytest.mark.anyio
async def test_delete(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path)
    rec = await store.create("t1", "Temp", "custom", {})
    await store.delete(rec.id, "t1")
    assert await store.get(rec.id, "t1") is None


@pytest.mark.anyio
async def test_encryption_round_trip(tmp_path: Path) -> None:
    key = _workspace_key(tmp_path)
    plaintext = "super-secret-token-xyz"
    ciphertext = _encrypt_field(plaintext, key)
    assert ciphertext.startswith("enc:")
    assert ciphertext != plaintext
    recovered = _decrypt_field(ciphertext, key)
    assert recovered == plaintext


@pytest.mark.anyio
async def test_sensitive_fields_are_encrypted_on_disk(tmp_path: Path) -> None:
    import json

    store = CredentialStore(tmp_path)
    rec = await store.create("t1", "Cred", "github", {"token": "gh-tok-secret", "username": "alice"})
    cred_file = tmp_path / ".graphcaster" / "credentials" / "t1" / f"{rec.id}.json"
    data = json.loads(cred_file.read_text())
    assert data["fields"]["token"].startswith("enc:")
    assert data["fields"]["username"] == "alice"


@pytest.mark.anyio
async def test_used_by_workflows(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path)
    rec = await store.create("t1", "Cred", "openai", {"api_key": "k"})
    await store.mark_used_by(rec.id, "t1", "wf-abc")
    await store.mark_used_by(rec.id, "t1", "wf-def")
    await store.mark_used_by(rec.id, "t1", "wf-abc")
    workflows = await store.get_used_by_workflows(rec.id, "t1")
    assert "wf-abc" in workflows
    assert "wf-def" in workflows
    assert workflows.count("wf-abc") == 1


@pytest.mark.anyio
async def test_test_connection_no_api_key(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path)
    rec = await store.create("t1", "Empty", "openai", {})
    result = await store.test(rec.id, "t1")
    assert result["ok"] is False
    assert "api_key" in result["message"]


@pytest.mark.anyio
async def test_get_nonexistent_returns_none(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path)
    assert await store.get("nonexistent-id", "t1") is None


@pytest.mark.anyio
async def test_invalid_type_raises(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path)
    with pytest.raises(ValueError, match="Invalid credential type"):
        await store.create("t1", "Bad", "unknown-type", {})


@pytest.mark.anyio
async def test_tenant_isolation(tmp_path: Path) -> None:
    store = CredentialStore(tmp_path)
    rec = await store.create("tenant-a", "Key", "openai", {"api_key": "k"})
    assert await store.get(rec.id, "tenant-b") is None
    recs_b = await store.list("tenant-b")
    assert recs_b == []
