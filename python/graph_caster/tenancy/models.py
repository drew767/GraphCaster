# Copyright GraphCaster. All Rights Reserved.

"""Dataclass models for multi-tenant data layer (F83)."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Literal


@dataclass
class User:
    id: str
    email: str
    name: str
    created_at: str
    password_hash: str | None = None
    is_active: bool = True

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "User":
        return cls(
            id=d["id"],
            email=d["email"],
            name=d["name"],
            created_at=d["created_at"],
            password_hash=d.get("password_hash"),
            is_active=bool(d.get("is_active", True)),
        )


@dataclass
class Tenant:
    id: str
    name: str
    created_at: str
    plan: str = "default"

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Tenant":
        return cls(
            id=d["id"],
            name=d["name"],
            created_at=d["created_at"],
            plan=str(d.get("plan", "default")),
        )


@dataclass
class Workspace:
    id: str
    tenant_id: str
    name: str
    created_at: str
    description: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Workspace":
        return cls(
            id=d["id"],
            tenant_id=d["tenant_id"],
            name=d["name"],
            created_at=d["created_at"],
            description=str(d.get("description", "")),
        )


@dataclass
class Project:
    id: str
    workspace_id: str
    name: str
    created_at: str

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Project":
        return cls(
            id=d["id"],
            workspace_id=d["workspace_id"],
            name=d["name"],
            created_at=d["created_at"],
        )


_VALID_ROLES = frozenset({"owner", "admin", "editor", "viewer", "dataset_operator"})


@dataclass
class TenantMembership:
    user_id: str
    tenant_id: str
    role: Literal["owner", "admin", "editor", "viewer", "dataset_operator"]
    invited_at: str

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "TenantMembership":
        role = str(d.get("role", "viewer"))
        if role not in _VALID_ROLES:
            raise ValueError(f"Invalid role: {role!r}. Must be one of {sorted(_VALID_ROLES)}")
        return cls(
            user_id=d["user_id"],
            tenant_id=d["tenant_id"],
            role=role,  # type: ignore[arg-type]
            invited_at=d["invited_at"],
        )
