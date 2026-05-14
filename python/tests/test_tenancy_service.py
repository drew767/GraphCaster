# Copyright GraphCaster. All Rights Reserved.

"""Service-layer tests for F83 TenantService."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from graph_caster.tenancy.models import User
from graph_caster.tenancy.service import AuthenticationError, InviteError, TenantService
from graph_caster.tenancy.store import InMemoryTenantStore


def _make_service() -> TenantService:
    return TenantService(InMemoryTenantStore())


@pytest.mark.anyio
async def test_signup_creates_user_tenant_membership():
    svc = _make_service()
    user, tenant = await svc.signup("alice@example.com", "Alice", "secret123")

    assert user.id
    assert user.email == "alice@example.com"
    assert user.password_hash is not None
    assert tenant.id
    assert "Alice" in tenant.name

    tenants = await svc.list_user_tenants(user.id)
    assert len(tenants) == 1 and tenants[0].id == tenant.id

    can_access = await svc.user_can_access_tenant(user.id, tenant.id)
    assert can_access is True


@pytest.mark.anyio
async def test_signup_sso_only_no_password():
    svc = _make_service()
    user, _ = await svc.signup("sso@example.com", "SSO User", password=None)
    assert user.password_hash is None


@pytest.mark.anyio
async def test_authenticate_correct_password():
    svc = _make_service()
    user, _ = await svc.signup("bob@example.com", "Bob", "mypassword")
    authed = await svc.authenticate("bob@example.com", "mypassword")
    assert authed.id == user.id


@pytest.mark.anyio
async def test_authenticate_wrong_password_raises():
    svc = _make_service()
    await svc.signup("carol@example.com", "Carol", "correct")
    with pytest.raises(AuthenticationError):
        await svc.authenticate("carol@example.com", "wrong")


@pytest.mark.anyio
async def test_authenticate_unknown_email_raises():
    svc = _make_service()
    with pytest.raises(AuthenticationError, match="No user"):
        await svc.authenticate("nobody@example.com", "anything")


@pytest.mark.anyio
async def test_authenticate_sso_only_raises():
    svc = _make_service()
    await svc.signup("sso@example.com", "SSO", password=None)
    with pytest.raises(AuthenticationError, match="no password"):
        await svc.authenticate("sso@example.com", "whatever")


@pytest.mark.anyio
async def test_invite_member_returns_token():
    svc = _make_service()
    _, tenant = await svc.signup("owner@example.com", "Owner", "pass")
    token = await svc.invite_member(tenant.id, "newbie@example.com", "editor")
    assert isinstance(token, str) and len(token) > 10


@pytest.mark.anyio
async def test_accept_invite_creates_membership():
    svc = _make_service()
    _, tenant = await svc.signup("owner@example.com", "Owner", "pass")
    token = await svc.invite_member(tenant.id, "newbie@example.com", "editor")

    newbie = User(
        id="newbie-id",
        email="newbie@example.com",
        name="Newbie",
        created_at="2024-01-01T00:00:00+00:00",
    )
    m = await svc.accept_invite(token, newbie)
    assert m.role == "editor"
    assert m.tenant_id == tenant.id
    assert m.user_id == "newbie-id"

    can_access = await svc.user_can_access_tenant("newbie-id", tenant.id)
    assert can_access is True


@pytest.mark.anyio
async def test_accept_invite_invalid_token():
    svc = _make_service()
    user = User(id="u", email="u@u.com", name="U", created_at="2024-01-01T00:00:00+00:00")
    with pytest.raises(InviteError, match="Invalid"):
        await svc.accept_invite("totally-wrong-token", user)


@pytest.mark.anyio
async def test_accept_invite_expired_token():
    svc = _make_service()
    _, tenant = await svc.signup("owner@example.com", "Owner", "pass")

    store = svc._store
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    await store.store_invite("expiredtok", tenant.id, "x@x.com", "viewer", past)

    user = User(id="u", email="x@x.com", name="X", created_at="2024-01-01T00:00:00+00:00")
    with pytest.raises(InviteError, match="expired"):
        await svc.accept_invite("expiredtok", user)


@pytest.mark.anyio
async def test_user_can_access_tenant_false_for_non_member():
    svc = _make_service()
    _, tenant = await svc.signup("owner@example.com", "Owner", "pass")
    assert await svc.user_can_access_tenant("stranger-id", tenant.id) is False


@pytest.mark.anyio
async def test_list_user_tenants_empty():
    svc = _make_service()
    tenants = await svc.list_user_tenants("user-with-no-tenants")
    assert tenants == []
