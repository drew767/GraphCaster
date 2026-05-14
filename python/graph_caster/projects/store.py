# Copyright GraphCaster. All Rights Reserved.

"""Projects store — logical scoping within a tenant (F83 extension).

A GCProject is a sub-scope of a Tenant that groups workflows, credentials,
and variables and has its own member list with per-project roles.
"""

from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal


_VALID_PROJECT_ROLES = frozenset({"owner", "admin", "editor", "viewer"})


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class GCProject:
    id: str
    tenant_id: str
    name: str
    description: str = ""
    color: str | None = None
    created_at: str = field(default_factory=_utcnow)
    updated_at: str = field(default_factory=_utcnow)
    member_count: int = 0
    workflow_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "GCProject":
        return cls(
            id=str(d["id"]),
            tenant_id=str(d["tenant_id"]),
            name=str(d["name"]),
            description=str(d.get("description") or ""),
            color=d.get("color"),
            created_at=str(d.get("created_at") or _utcnow()),
            updated_at=str(d.get("updated_at") or _utcnow()),
            member_count=int(d.get("member_count") or 0),
            workflow_count=int(d.get("workflow_count") or 0),
        )


@dataclass
class GCProjectMember:
    project_id: str
    user_id: str
    role: Literal["owner", "admin", "editor", "viewer"]
    added_at: str = field(default_factory=_utcnow)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "GCProjectMember":
        role = str(d.get("role", "viewer"))
        if role not in _VALID_PROJECT_ROLES:
            raise ValueError(f"Invalid project role: {role!r}. Must be one of {sorted(_VALID_PROJECT_ROLES)}")
        return cls(
            project_id=str(d["project_id"]),
            user_id=str(d["user_id"]),
            role=role,  # type: ignore[arg-type]
            added_at=str(d.get("added_at") or _utcnow()),
        )


class ProjectStore(ABC):
    """Abstract async store for GCProject entities."""

    @abstractmethod
    async def create(self, project: GCProject) -> GCProject: ...

    @abstractmethod
    async def list(self, tenant_id: str) -> list[GCProject]: ...

    @abstractmethod
    async def get(self, project_id: str, tenant_id: str) -> GCProject | None: ...

    @abstractmethod
    async def update(self, project: GCProject) -> GCProject: ...

    @abstractmethod
    async def delete(self, project_id: str, tenant_id: str) -> None: ...

    @abstractmethod
    async def add_member(self, project_id: str, user_id: str, role: str) -> None: ...

    @abstractmethod
    async def remove_member(self, project_id: str, user_id: str) -> None: ...

    @abstractmethod
    async def list_members(self, project_id: str) -> list[GCProjectMember]: ...

    @abstractmethod
    async def get_resources(self, project_id: str) -> dict[str, Any]:
        """Return aggregated resource counts/lists for a project.

        Returns a dict with keys 'workflows', 'credentials', 'variables'.
        The base implementation returns empty lists; concrete stores may
        join against real workflow/credential/variable tables.
        """
        ...


class InMemoryProjectStore(ProjectStore):
    """Dict-backed project store for tests and single-process usage."""

    def __init__(self) -> None:
        self._projects: dict[str, GCProject] = {}
        self._members: dict[tuple[str, str], GCProjectMember] = {}

    async def create(self, project: GCProject) -> GCProject:
        if not project.id:
            project = deepcopy(project)
            project.id = str(uuid.uuid4())
        self._projects[project.id] = deepcopy(project)
        return deepcopy(project)

    async def list(self, tenant_id: str) -> list[GCProject]:
        return [
            deepcopy(p)
            for p in self._projects.values()
            if p.tenant_id == tenant_id
        ]

    async def get(self, project_id: str, tenant_id: str) -> GCProject | None:
        p = self._projects.get(project_id)
        if p is None or p.tenant_id != tenant_id:
            return None
        return deepcopy(p)

    async def update(self, project: GCProject) -> GCProject:
        if project.id not in self._projects:
            raise KeyError(f"Project {project.id!r} not found")
        now = _utcnow()
        updated = deepcopy(project)
        updated.updated_at = now
        self._projects[updated.id] = updated
        return deepcopy(updated)

    async def delete(self, project_id: str, tenant_id: str) -> None:
        p = self._projects.get(project_id)
        if p is not None and p.tenant_id == tenant_id:
            del self._projects[project_id]
        # Also remove member entries
        to_remove = [k for k in self._members if k[0] == project_id]
        for k in to_remove:
            del self._members[k]

    async def add_member(self, project_id: str, user_id: str, role: str) -> None:
        if role not in _VALID_PROJECT_ROLES:
            raise ValueError(f"Invalid project role: {role!r}")
        self._members[(project_id, user_id)] = GCProjectMember(
            project_id=project_id,
            user_id=user_id,
            role=role,  # type: ignore[arg-type]
        )

    async def remove_member(self, project_id: str, user_id: str) -> None:
        self._members.pop((project_id, user_id), None)

    async def list_members(self, project_id: str) -> list[GCProjectMember]:
        return [
            deepcopy(m)
            for (pid, _), m in self._members.items()
            if pid == project_id
        ]

    async def get_resources(self, project_id: str) -> dict[str, Any]:
        return {"workflows": [], "credentials": [], "variables": []}
