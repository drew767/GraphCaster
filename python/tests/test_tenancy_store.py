# Copyright GraphCaster. All Rights Reserved.

"""Store tests for F83 tenancy layer — InMemoryTenantStore and SqlAlchemyTenantStore."""

from __future__ import annotations

import asyncio
import os
import tempfile
from datetime import datetime, timezone

import pytest

from graph_caster.tenancy.models import Project, Tenant, TenantMembership, User, Workspace
from graph_caster.tenancy.store import InMemoryTenantStore

_NOW = "2024-01-01T00:00:00+00:00"

# ---------------------------------------------------------------------------
# Helper: parametrize store factories
# ---------------------------------------------------------------------------

def _sa_available() -> bool:
    try:
        import sqlalchemy  # noqa: F401
        import aiosqlite  # noqa: F401
        return True
    except ImportError:
        return False


async def _make_sa_store():
    from graph_caster.tenancy.store import SqlAlchemyTenantStore

    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    url = f"sqlite+aiosqlite:///{db_path}"
    store = SqlAlchemyTenantStore(db_url=url)
    await store.init()
    return store


# ---------------------------------------------------------------------------
# InMemory tests
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_inmemory_create_and_fetch_user():
    store = InMemoryTenantStore()
    u = User(id="u1", email="alice@a.com", name="Alice", created_at=_NOW)
    created = await store.create_user(u)
    assert created.id == "u1"

    fetched = await store.get_user("u1")
    assert fetched is not None
    assert fetched.email == "alice@a.com"


@pytest.mark.anyio
async def test_inmemory_find_user_by_email():
    store = InMemoryTenantStore()
    await store.create_user(User(id="u1", email="bob@b.com", name="Bob", created_at=_NOW))

    found = await store.find_user_by_email("bob@b.com")
    assert found is not None and found.id == "u1"

    not_found = await store.find_user_by_email("nobody@x.com")
    assert not_found is None


@pytest.mark.anyio
async def test_inmemory_get_user_missing():
    store = InMemoryTenantStore()
    assert await store.get_user("nonexistent") is None


@pytest.mark.anyio
async def test_inmemory_create_and_fetch_tenant():
    store = InMemoryTenantStore()
    t = Tenant(id="t1", name="Acme", created_at=_NOW, plan="pro")
    await store.create_tenant(t)

    fetched = await store.get_tenant("t1")
    assert fetched is not None
    assert fetched.name == "Acme"
    assert fetched.plan == "pro"


@pytest.mark.anyio
async def test_inmemory_add_membership_and_list():
    store = InMemoryTenantStore()
    await store.create_user(User(id="u1", email="a@a.com", name="A", created_at=_NOW))
    await store.create_tenant(Tenant(id="t1", name="T", created_at=_NOW))

    m = TenantMembership(user_id="u1", tenant_id="t1", role="admin", invited_at=_NOW)
    await store.add_membership(m)

    memberships = await store.list_memberships("t1")
    assert len(memberships) == 1
    assert memberships[0].role == "admin"


@pytest.mark.anyio
async def test_inmemory_update_role():
    store = InMemoryTenantStore()
    await store.create_user(User(id="u1", email="a@a.com", name="A", created_at=_NOW))
    await store.create_tenant(Tenant(id="t1", name="T", created_at=_NOW))
    await store.add_membership(TenantMembership(user_id="u1", tenant_id="t1", role="viewer", invited_at=_NOW))

    await store.update_member_role("u1", "t1", "editor")

    m = await store.get_membership("u1", "t1")
    assert m is not None and m.role == "editor"


@pytest.mark.anyio
async def test_inmemory_remove_member():
    store = InMemoryTenantStore()
    await store.create_user(User(id="u1", email="a@a.com", name="A", created_at=_NOW))
    await store.create_tenant(Tenant(id="t1", name="T", created_at=_NOW))
    await store.add_membership(TenantMembership(user_id="u1", tenant_id="t1", role="editor", invited_at=_NOW))

    await store.remove_member("u1", "t1")

    memberships = await store.list_memberships("t1")
    assert memberships == []


@pytest.mark.anyio
async def test_inmemory_list_tenants_for_user():
    store = InMemoryTenantStore()
    await store.create_user(User(id="u1", email="a@a.com", name="A", created_at=_NOW))
    await store.create_tenant(Tenant(id="t1", name="T1", created_at=_NOW))
    await store.create_tenant(Tenant(id="t2", name="T2", created_at=_NOW))
    await store.add_membership(TenantMembership(user_id="u1", tenant_id="t1", role="owner", invited_at=_NOW))
    await store.add_membership(TenantMembership(user_id="u1", tenant_id="t2", role="viewer", invited_at=_NOW))

    tenants = await store.list_tenants_for_user("u1")
    ids = {t.id for t in tenants}
    assert ids == {"t1", "t2"}


@pytest.mark.anyio
async def test_inmemory_workspace_crud():
    store = InMemoryTenantStore()
    ws = Workspace(id="ws1", tenant_id="t1", name="Main", created_at=_NOW, description="desc")
    await store.create_workspace(ws)

    fetched = await store.get_workspace("ws1")
    assert fetched is not None and fetched.description == "desc"

    all_ws = await store.list_workspaces("t1")
    assert len(all_ws) == 1


@pytest.mark.anyio
async def test_inmemory_project_crud():
    store = InMemoryTenantStore()
    p = Project(id="p1", workspace_id="ws1", name="Alpha", created_at=_NOW)
    await store.create_project(p)

    fetched = await store.get_project("p1")
    assert fetched is not None and fetched.name == "Alpha"

    all_p = await store.list_projects("ws1")
    assert len(all_p) == 1


@pytest.mark.anyio
async def test_inmemory_bootstrap_defaults():
    store = InMemoryTenantStore()
    await store.bootstrap_defaults()

    tenant = await store.get_tenant("default")
    assert tenant is not None and tenant.name == "Default"

    user = await store.get_user("local")
    assert user is not None and user.email == "local@graphcaster"

    m = await store.get_membership("local", "default")
    assert m is not None and m.role == "owner"


@pytest.mark.anyio
async def test_inmemory_bootstrap_defaults_idempotent():
    store = InMemoryTenantStore()
    await store.bootstrap_defaults()
    await store.bootstrap_defaults()  # second call must not raise

    members = await store.list_memberships("default")
    assert len(members) == 1


@pytest.mark.anyio
async def test_inmemory_invite_flow():
    store = InMemoryTenantStore()
    await store.store_invite("tok123", "t1", "bob@b.com", "editor", "2099-01-01T00:00:00+00:00")

    inv = await store.get_invite("tok123")
    assert inv is not None and inv["email"] == "bob@b.com"

    await store.delete_invite("tok123")
    assert await store.get_invite("tok123") is None


# ---------------------------------------------------------------------------
# SQLAlchemy tests (skipped if dependencies absent)
# ---------------------------------------------------------------------------

@pytest.mark.anyio
@pytest.mark.skipif(not _sa_available(), reason="sqlalchemy/aiosqlite not installed")
async def test_sqlalchemy_create_and_fetch_user():
    store = await _make_sa_store()
    u = User(id="u1", email="alice@a.com", name="Alice", created_at=_NOW)
    await store.create_user(u)

    fetched = await store.get_user("u1")
    assert fetched is not None and fetched.email == "alice@a.com"


@pytest.mark.anyio
@pytest.mark.skipif(not _sa_available(), reason="sqlalchemy/aiosqlite not installed")
async def test_sqlalchemy_find_user_by_email():
    store = await _make_sa_store()
    await store.create_user(User(id="u1", email="bob@b.com", name="Bob", created_at=_NOW))

    found = await store.find_user_by_email("bob@b.com")
    assert found is not None and found.id == "u1"

    assert await store.find_user_by_email("nobody@x.com") is None


@pytest.mark.anyio
@pytest.mark.skipif(not _sa_available(), reason="sqlalchemy/aiosqlite not installed")
async def test_sqlalchemy_create_and_fetch_tenant():
    store = await _make_sa_store()
    await store.create_tenant(Tenant(id="t1", name="Acme", created_at=_NOW, plan="pro"))

    t = await store.get_tenant("t1")
    assert t is not None and t.plan == "pro"

    assert await store.get_tenant("nonexistent") is None


@pytest.mark.anyio
@pytest.mark.skipif(not _sa_available(), reason="sqlalchemy/aiosqlite not installed")
async def test_sqlalchemy_membership_lifecycle():
    store = await _make_sa_store()
    await store.create_user(User(id="u1", email="a@a.com", name="A", created_at=_NOW))
    await store.create_tenant(Tenant(id="t1", name="T", created_at=_NOW))

    await store.add_membership(TenantMembership(user_id="u1", tenant_id="t1", role="viewer", invited_at=_NOW))

    members = await store.list_memberships("t1")
    assert len(members) == 1 and members[0].role == "viewer"

    await store.update_member_role("u1", "t1", "admin")
    m = await store.get_membership("u1", "t1")
    assert m is not None and m.role == "admin"

    await store.remove_member("u1", "t1")
    assert await store.list_memberships("t1") == []


@pytest.mark.anyio
@pytest.mark.skipif(not _sa_available(), reason="sqlalchemy/aiosqlite not installed")
async def test_sqlalchemy_bootstrap_defaults():
    store = await _make_sa_store()
    await store.bootstrap_defaults()

    tenant = await store.get_tenant("default")
    assert tenant is not None

    user = await store.get_user("local")
    assert user is not None

    m = await store.get_membership("local", "default")
    assert m is not None and m.role == "owner"


@pytest.mark.anyio
@pytest.mark.skipif(not _sa_available(), reason="sqlalchemy/aiosqlite not installed")
async def test_sqlalchemy_workspace_and_project():
    store = await _make_sa_store()
    await store.create_workspace(Workspace(id="ws1", tenant_id="t1", name="Main", created_at=_NOW))
    await store.create_project(Project(id="p1", workspace_id="ws1", name="Alpha", created_at=_NOW))

    ws = await store.get_workspace("ws1")
    assert ws is not None and ws.name == "Main"

    p = await store.get_project("p1")
    assert p is not None and p.name == "Alpha"

    assert len(await store.list_workspaces("t1")) == 1
    assert len(await store.list_projects("ws1")) == 1
