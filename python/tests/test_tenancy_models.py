# Copyright GraphCaster. All Rights Reserved.

"""Dataclass round-trip serialization tests for F83 tenancy models."""

import pytest
from graph_caster.tenancy.models import (
    Project,
    Tenant,
    TenantMembership,
    User,
    Workspace,
)


def test_user_round_trip():
    u = User(
        id="u1",
        email="alice@example.com",
        name="Alice",
        created_at="2024-01-01T00:00:00+00:00",
        password_hash="abc",
        is_active=True,
    )
    d = u.to_dict()
    assert d["id"] == "u1"
    assert d["email"] == "alice@example.com"
    assert d["password_hash"] == "abc"
    assert d["is_active"] is True
    restored = User.from_dict(d)
    assert restored == u


def test_user_defaults():
    u = User(id="x", email="x@x.com", name="X", created_at="2024-01-01T00:00:00+00:00")
    assert u.password_hash is None
    assert u.is_active is True


def test_user_from_dict_optional_fields():
    d = {"id": "u2", "email": "b@b.com", "name": "Bob", "created_at": "2024-01-01T00:00:00+00:00"}
    u = User.from_dict(d)
    assert u.password_hash is None
    assert u.is_active is True


def test_tenant_round_trip():
    t = Tenant(id="t1", name="Acme", created_at="2024-01-01T00:00:00+00:00", plan="pro")
    d = t.to_dict()
    assert d["plan"] == "pro"
    restored = Tenant.from_dict(d)
    assert restored == t


def test_tenant_defaults():
    t = Tenant(id="t1", name="X", created_at="2024-01-01T00:00:00+00:00")
    assert t.plan == "default"


def test_workspace_round_trip():
    w = Workspace(
        id="ws1",
        tenant_id="t1",
        name="Main Workspace",
        created_at="2024-01-01T00:00:00+00:00",
        description="A workspace",
    )
    d = w.to_dict()
    restored = Workspace.from_dict(d)
    assert restored == w


def test_workspace_defaults():
    w = Workspace(id="ws1", tenant_id="t1", name="W", created_at="2024-01-01T00:00:00+00:00")
    assert w.description == ""


def test_project_round_trip():
    p = Project(id="p1", workspace_id="ws1", name="Alpha", created_at="2024-01-01T00:00:00+00:00")
    d = p.to_dict()
    restored = Project.from_dict(d)
    assert restored == p


def test_membership_round_trip():
    m = TenantMembership(
        user_id="u1",
        tenant_id="t1",
        role="editor",
        invited_at="2024-01-01T00:00:00+00:00",
    )
    d = m.to_dict()
    assert d["role"] == "editor"
    restored = TenantMembership.from_dict(d)
    assert restored == m


def test_membership_all_valid_roles():
    for role in ("owner", "admin", "editor", "viewer", "dataset_operator"):
        m = TenantMembership(user_id="u", tenant_id="t", role=role, invited_at="2024-01-01T00:00:00+00:00")  # type: ignore[arg-type]
        assert m.role == role


def test_membership_invalid_role_raises():
    with pytest.raises(ValueError, match="Invalid role"):
        TenantMembership.from_dict(
            {"user_id": "u", "tenant_id": "t", "role": "superadmin", "invited_at": "2024-01-01T00:00:00+00:00"}
        )
