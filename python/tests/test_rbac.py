# Copyright GraphCaster. All Rights Reserved.

"""F84 RBAC unit tests: mapping exhaustiveness, scope resolution, Principal."""

from __future__ import annotations

import pytest

from graph_caster.auth.rbac import (
    ROLE_SCOPES,
    Principal,
    Role,
    has_scope,
    scopes_for_role,
)


# ---------------------------------------------------------------------------
# Mapping exhaustiveness
# ---------------------------------------------------------------------------


def test_role_scopes_covers_all_roles() -> None:
    """Every Role enum value must have an entry in ROLE_SCOPES."""
    for role in Role:
        assert role in ROLE_SCOPES, f"Role {role!r} missing from ROLE_SCOPES"


def test_role_scopes_values_are_sets_of_strings() -> None:
    for role, scopes in ROLE_SCOPES.items():
        assert isinstance(scopes, set), f"{role}: value must be a set"
        for s in scopes:
            assert isinstance(s, str), f"{role}: scope {s!r} must be a str"


# ---------------------------------------------------------------------------
# has_scope: wildcard, prefix, exact, miss
# ---------------------------------------------------------------------------


class TestHasScope:
    def test_star_wildcard_grants_everything(self) -> None:
        assert has_scope({"*"}, "graph:edit") is True
        assert has_scope({"*"}, "audit:read") is True
        assert has_scope({"*"}, "dataset:write") is True

    def test_prefix_wildcard_matches_same_prefix(self) -> None:
        assert has_scope({"graph:*"}, "graph:edit") is True
        assert has_scope({"graph:*"}, "graph:view") is True
        assert has_scope({"graph:*"}, "graph:publish") is True

    def test_prefix_wildcard_does_not_match_other_prefix(self) -> None:
        assert has_scope({"graph:*"}, "run:execute") is False
        assert has_scope({"graph:*"}, "audit:read") is False

    def test_exact_match(self) -> None:
        assert has_scope({"run:execute"}, "run:execute") is True

    def test_exact_miss(self) -> None:
        assert has_scope({"run:view"}, "run:execute") is False
        assert has_scope({"graph:view"}, "graph:edit") is False

    def test_empty_effective_always_false(self) -> None:
        assert has_scope(set(), "graph:view") is False


# ---------------------------------------------------------------------------
# Principal.effective_scopes
# ---------------------------------------------------------------------------


class TestPrincipalEffectiveScopes:
    def test_owner_has_wildcard(self) -> None:
        p = Principal(user_id="u1", tenant_id="t1", role=Role.OWNER)
        assert "*" in p.effective_scopes

    def test_admin_has_expected_scopes(self) -> None:
        p = Principal(user_id="u1", tenant_id="t1", role=Role.ADMIN)
        for s in ("graph:view", "graph:edit", "run:execute", "audit:read", "user:invite"):
            assert s in p.effective_scopes, f"admin should have {s}"

    def test_editor_has_run_execute_but_not_audit(self) -> None:
        p = Principal(user_id="u1", tenant_id="t1", role=Role.EDITOR)
        assert "run:execute" in p.effective_scopes
        assert "audit:read" not in p.effective_scopes

    def test_viewer_cannot_execute(self) -> None:
        p = Principal(user_id="u1", tenant_id="t1", role=Role.VIEWER)
        assert "run:execute" not in p.effective_scopes
        assert "graph:view" in p.effective_scopes

    def test_dataset_operator_scopes(self) -> None:
        p = Principal(user_id="u1", tenant_id="t1", role=Role.DATASET_OPERATOR)
        assert "dataset:read" in p.effective_scopes
        assert "dataset:write" in p.effective_scopes
        assert "graph:view" in p.effective_scopes
        assert "run:execute" not in p.effective_scopes

    def test_api_key_scopes_override_role(self) -> None:
        p = Principal(
            user_id="apikey:kid1",
            tenant_id="default",
            role=Role.ADMIN,
            api_key_scopes={"run:view"},
        )
        assert p.effective_scopes == {"run:view"}
        assert "run:execute" not in p.effective_scopes
        assert "audit:read" not in p.effective_scopes

    def test_api_key_scopes_star_grants_all(self) -> None:
        p = Principal(
            user_id="apikey:kid2",
            tenant_id="default",
            role=Role.VIEWER,
            api_key_scopes={"*"},
        )
        assert has_scope(p.effective_scopes, "audit:read") is True

    def test_api_key_scopes_none_falls_back_to_role(self) -> None:
        p = Principal(
            user_id="apikey:kid3",
            tenant_id="default",
            role=Role.EDITOR,
            api_key_scopes=None,
        )
        assert p.effective_scopes == scopes_for_role(Role.EDITOR)


# ---------------------------------------------------------------------------
# scopes_for_role returns a copy (mutation safety)
# ---------------------------------------------------------------------------


def test_scopes_for_role_returns_copy() -> None:
    s1 = scopes_for_role(Role.VIEWER)
    s1.add("injected:scope")
    s2 = scopes_for_role(Role.VIEWER)
    assert "injected:scope" not in s2
