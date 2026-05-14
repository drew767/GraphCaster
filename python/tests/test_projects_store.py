# Copyright GraphCaster. All Rights Reserved.

"""Tests for ProjectStore (F83 extension) — InMemoryProjectStore, 8 tests."""

from __future__ import annotations

import pytest

from graph_caster.projects.store import GCProject, GCProjectMember, InMemoryProjectStore


_T1 = "tenant-1"
_T2 = "tenant-2"


def _make_project(tenant_id: str = _T1, name: str = "Alpha") -> GCProject:
    return GCProject(id="", tenant_id=tenant_id, name=name, description="desc", color="#ff0000")


@pytest.mark.anyio
async def test_create_and_get():
    store = InMemoryProjectStore()
    p = await store.create(_make_project())
    assert p.id  # auto-generated
    fetched = await store.get(p.id, _T1)
    assert fetched is not None
    assert fetched.name == "Alpha"
    assert fetched.color == "#ff0000"


@pytest.mark.anyio
async def test_list_by_tenant():
    store = InMemoryProjectStore()
    a = await store.create(_make_project(_T1, "A"))
    b = await store.create(_make_project(_T1, "B"))
    await store.create(_make_project(_T2, "Other"))
    projects = await store.list(_T1)
    names = {p.name for p in projects}
    assert names == {"A", "B"}
    assert len(await store.list(_T2)) == 1


@pytest.mark.anyio
async def test_get_wrong_tenant_returns_none():
    store = InMemoryProjectStore()
    p = await store.create(_make_project(_T1))
    result = await store.get(p.id, _T2)
    assert result is None


@pytest.mark.anyio
async def test_update():
    store = InMemoryProjectStore()
    p = await store.create(_make_project())
    p.name = "Beta"
    p.color = "#00ff00"
    updated = await store.update(p)
    assert updated.name == "Beta"
    assert updated.color == "#00ff00"
    assert updated.updated_at != ""


@pytest.mark.anyio
async def test_delete():
    store = InMemoryProjectStore()
    p = await store.create(_make_project())
    await store.delete(p.id, _T1)
    assert await store.get(p.id, _T1) is None
    assert await store.list(_T1) == []


@pytest.mark.anyio
async def test_add_and_list_members():
    store = InMemoryProjectStore()
    p = await store.create(_make_project())
    await store.add_member(p.id, "user-1", "editor")
    await store.add_member(p.id, "user-2", "viewer")
    members = await store.list_members(p.id)
    assert len(members) == 2
    roles = {m.user_id: m.role for m in members}
    assert roles["user-1"] == "editor"
    assert roles["user-2"] == "viewer"


@pytest.mark.anyio
async def test_remove_member():
    store = InMemoryProjectStore()
    p = await store.create(_make_project())
    await store.add_member(p.id, "user-1", "admin")
    await store.remove_member(p.id, "user-1")
    members = await store.list_members(p.id)
    assert members == []


@pytest.mark.anyio
async def test_get_resources_returns_empty_by_default():
    store = InMemoryProjectStore()
    p = await store.create(_make_project())
    resources = await store.get_resources(p.id)
    assert resources["workflows"] == []
    assert resources["credentials"] == []
    assert resources["variables"] == []
