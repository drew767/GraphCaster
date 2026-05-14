# Copyright GraphCaster. All Rights Reserved.

"""TenantStore abstraction + InMemoryTenantStore + SqlAlchemyTenantStore (optional)."""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from copy import deepcopy
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from graph_caster.tenancy.models import (
    Project,
    Tenant,
    TenantMembership,
    User,
    Workspace,
)

_DEFAULT_TENANT_ID = "default"
_DEFAULT_USER_ID = "local"


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


class TenantStore(ABC):
    """Abstract async store for multi-tenant entities."""

    # --- User ---

    @abstractmethod
    async def create_user(self, user: User) -> User: ...

    @abstractmethod
    async def get_user(self, user_id: str) -> User | None: ...

    @abstractmethod
    async def find_user_by_email(self, email: str) -> User | None: ...

    @abstractmethod
    async def update_user(self, user: User) -> User: ...

    # --- Tenant ---

    @abstractmethod
    async def create_tenant(self, tenant: Tenant) -> Tenant: ...

    @abstractmethod
    async def get_tenant(self, tenant_id: str) -> Tenant | None: ...

    @abstractmethod
    async def list_tenants_for_user(self, user_id: str) -> list[Tenant]: ...

    # --- Membership ---

    @abstractmethod
    async def add_membership(self, m: TenantMembership) -> None: ...

    @abstractmethod
    async def list_memberships(self, tenant_id: str) -> list[TenantMembership]: ...

    @abstractmethod
    async def get_membership(self, user_id: str, tenant_id: str) -> TenantMembership | None: ...

    @abstractmethod
    async def update_member_role(self, user_id: str, tenant_id: str, new_role: str) -> None: ...

    @abstractmethod
    async def remove_member(self, user_id: str, tenant_id: str) -> None: ...

    # --- Workspace ---

    @abstractmethod
    async def create_workspace(self, workspace: Workspace) -> Workspace: ...

    @abstractmethod
    async def get_workspace(self, workspace_id: str) -> Workspace | None: ...

    @abstractmethod
    async def list_workspaces(self, tenant_id: str) -> list[Workspace]: ...

    # --- Project ---

    @abstractmethod
    async def create_project(self, project: Project) -> Project: ...

    @abstractmethod
    async def get_project(self, project_id: str) -> Project | None: ...

    @abstractmethod
    async def list_projects(self, workspace_id: str) -> list[Project]: ...

    # --- Invites ---

    @abstractmethod
    async def store_invite(self, token: str, tenant_id: str, email: str, role: str, expires_at: str) -> None: ...

    @abstractmethod
    async def get_invite(self, token: str) -> dict | None: ...

    @abstractmethod
    async def delete_invite(self, token: str) -> None: ...

    # --- Bootstrap ---

    async def bootstrap_defaults(self) -> None:
        """Create default tenant + local user + owner membership if absent."""
        now = _utcnow()
        tenant = await self.get_tenant(_DEFAULT_TENANT_ID)
        if tenant is None:
            tenant = await self.create_tenant(
                Tenant(id=_DEFAULT_TENANT_ID, name="Default", created_at=now, plan="default")
            )
        user = await self.get_user(_DEFAULT_USER_ID)
        if user is None:
            user = await self.create_user(
                User(
                    id=_DEFAULT_USER_ID,
                    email="local@graphcaster",
                    name="Local User",
                    created_at=now,
                )
            )
        existing = await self.get_membership(_DEFAULT_USER_ID, _DEFAULT_TENANT_ID)
        if existing is None:
            await self.add_membership(
                TenantMembership(
                    user_id=_DEFAULT_USER_ID,
                    tenant_id=_DEFAULT_TENANT_ID,
                    role="owner",
                    invited_at=now,
                )
            )


class InMemoryTenantStore(TenantStore):
    """Dict-backed store for tests and single-process usage."""

    def __init__(self) -> None:
        self._users: dict[str, User] = {}
        self._tenants: dict[str, Tenant] = {}
        self._memberships: dict[tuple[str, str], TenantMembership] = {}
        self._workspaces: dict[str, Workspace] = {}
        self._projects: dict[str, Project] = {}
        self._invites: dict[str, dict] = {}

    async def create_user(self, user: User) -> User:
        self._users[user.id] = deepcopy(user)
        return deepcopy(user)

    async def get_user(self, user_id: str) -> User | None:
        u = self._users.get(user_id)
        return deepcopy(u) if u is not None else None

    async def find_user_by_email(self, email: str) -> User | None:
        for u in self._users.values():
            if u.email == email:
                return deepcopy(u)
        return None

    async def update_user(self, user: User) -> User:
        self._users[user.id] = deepcopy(user)
        return deepcopy(user)

    async def create_tenant(self, tenant: Tenant) -> Tenant:
        self._tenants[tenant.id] = deepcopy(tenant)
        return deepcopy(tenant)

    async def get_tenant(self, tenant_id: str) -> Tenant | None:
        t = self._tenants.get(tenant_id)
        return deepcopy(t) if t is not None else None

    async def list_tenants_for_user(self, user_id: str) -> list[Tenant]:
        tenant_ids = {tid for (uid, tid) in self._memberships if uid == user_id}
        return [deepcopy(self._tenants[tid]) for tid in tenant_ids if tid in self._tenants]

    async def add_membership(self, m: TenantMembership) -> None:
        self._memberships[(m.user_id, m.tenant_id)] = deepcopy(m)

    async def list_memberships(self, tenant_id: str) -> list[TenantMembership]:
        return [deepcopy(m) for (_, tid), m in self._memberships.items() if tid == tenant_id]

    async def get_membership(self, user_id: str, tenant_id: str) -> TenantMembership | None:
        m = self._memberships.get((user_id, tenant_id))
        return deepcopy(m) if m is not None else None

    async def update_member_role(self, user_id: str, tenant_id: str, new_role: str) -> None:
        key = (user_id, tenant_id)
        if key not in self._memberships:
            raise KeyError(f"No membership for user {user_id!r} in tenant {tenant_id!r}")
        existing = self._memberships[key]
        self._memberships[key] = TenantMembership(
            user_id=existing.user_id,
            tenant_id=existing.tenant_id,
            role=new_role,  # type: ignore[arg-type]
            invited_at=existing.invited_at,
        )

    async def remove_member(self, user_id: str, tenant_id: str) -> None:
        self._memberships.pop((user_id, tenant_id), None)

    async def create_workspace(self, workspace: Workspace) -> Workspace:
        self._workspaces[workspace.id] = deepcopy(workspace)
        return deepcopy(workspace)

    async def get_workspace(self, workspace_id: str) -> Workspace | None:
        w = self._workspaces.get(workspace_id)
        return deepcopy(w) if w is not None else None

    async def list_workspaces(self, tenant_id: str) -> list[Workspace]:
        return [deepcopy(w) for w in self._workspaces.values() if w.tenant_id == tenant_id]

    async def create_project(self, project: Project) -> Project:
        self._projects[project.id] = deepcopy(project)
        return deepcopy(project)

    async def get_project(self, project_id: str) -> Project | None:
        p = self._projects.get(project_id)
        return deepcopy(p) if p is not None else None

    async def list_projects(self, workspace_id: str) -> list[Project]:
        return [deepcopy(p) for p in self._projects.values() if p.workspace_id == workspace_id]

    async def store_invite(self, token: str, tenant_id: str, email: str, role: str, expires_at: str) -> None:
        self._invites[token] = {
            "token": token,
            "tenant_id": tenant_id,
            "email": email,
            "role": role,
            "expires_at": expires_at,
        }

    async def get_invite(self, token: str) -> dict | None:
        inv = self._invites.get(token)
        return dict(inv) if inv is not None else None

    async def delete_invite(self, token: str) -> None:
        self._invites.pop(token, None)


def _sqlalchemy_available() -> bool:
    try:
        import sqlalchemy  # noqa: F401
        import aiosqlite  # noqa: F401
        return True
    except ImportError:
        return False


class SqlAlchemyTenantStore(TenantStore):
    """Async SQLAlchemy store backed by SQLite (default) or any async URL.

    DB URL is read from ``GC_TENANCY_DB_URL`` env var; falls back to
    ``sqlite+aiosqlite:///graphcaster_tenancy.db`` relative to cwd.

    Call ``await store.init()`` before first use.
    """

    def __init__(self, db_url: str | None = None) -> None:
        if not _sqlalchemy_available():
            raise ImportError(
                "SqlAlchemyTenantStore requires sqlalchemy and aiosqlite. "
                "Install with: pip install -e '.[tenancy]'"
            )
        self._db_url = db_url or os.environ.get(
            "GC_TENANCY_DB_URL", "sqlite+aiosqlite:///graphcaster_tenancy.db"
        )
        self._engine = None  # type: ignore[assignment]
        self._Session = None  # type: ignore[assignment]

    async def init(self) -> None:
        """Create tables (idempotent)."""
        from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
        from sqlalchemy.orm import sessionmaker

        self._engine = create_async_engine(self._db_url, echo=False)
        self._Session = sessionmaker(self._engine, class_=AsyncSession, expire_on_commit=False)
        async with self._engine.begin() as conn:
            await conn.run_sync(_Base.metadata.create_all)

    async def _session(self):
        return self._Session()

    async def create_user(self, user: User) -> User:
        async with self._Session() as session:
            row = _UserRow(
                id=user.id,
                email=user.email,
                name=user.name,
                password_hash=user.password_hash,
                created_at=user.created_at,
                is_active=user.is_active,
            )
            session.add(row)
            await session.commit()
        return user

    async def get_user(self, user_id: str) -> User | None:
        from sqlalchemy import select

        async with self._Session() as session:
            result = await session.execute(select(_UserRow).where(_UserRow.id == user_id))
            row = result.scalar_one_or_none()
            return _row_to_user(row) if row else None

    async def find_user_by_email(self, email: str) -> User | None:
        from sqlalchemy import select

        async with self._Session() as session:
            result = await session.execute(select(_UserRow).where(_UserRow.email == email))
            row = result.scalar_one_or_none()
            return _row_to_user(row) if row else None

    async def update_user(self, user: User) -> User:
        from sqlalchemy import select

        async with self._Session() as session:
            result = await session.execute(select(_UserRow).where(_UserRow.id == user.id))
            row = result.scalar_one_or_none()
            if row is None:
                raise KeyError(f"User {user.id!r} not found")
            row.email = user.email
            row.name = user.name
            row.password_hash = user.password_hash
            row.is_active = user.is_active
            await session.commit()
        return user

    async def create_tenant(self, tenant: Tenant) -> Tenant:
        async with self._Session() as session:
            row = _TenantRow(
                id=tenant.id,
                name=tenant.name,
                created_at=tenant.created_at,
                plan=tenant.plan,
            )
            session.add(row)
            await session.commit()
        return tenant

    async def get_tenant(self, tenant_id: str) -> Tenant | None:
        from sqlalchemy import select

        async with self._Session() as session:
            result = await session.execute(select(_TenantRow).where(_TenantRow.id == tenant_id))
            row = result.scalar_one_or_none()
            return _row_to_tenant(row) if row else None

    async def list_tenants_for_user(self, user_id: str) -> list[Tenant]:
        from sqlalchemy import select

        async with self._Session() as session:
            result = await session.execute(
                select(_TenantRow)
                .join(_MembershipRow, _TenantRow.id == _MembershipRow.tenant_id)
                .where(_MembershipRow.user_id == user_id)
            )
            return [_row_to_tenant(r) for r in result.scalars()]

    async def add_membership(self, m: TenantMembership) -> None:
        async with self._Session() as session:
            row = _MembershipRow(
                user_id=m.user_id,
                tenant_id=m.tenant_id,
                role=m.role,
                invited_at=m.invited_at,
            )
            session.add(row)
            await session.commit()

    async def list_memberships(self, tenant_id: str) -> list[TenantMembership]:
        from sqlalchemy import select

        async with self._Session() as session:
            result = await session.execute(
                select(_MembershipRow).where(_MembershipRow.tenant_id == tenant_id)
            )
            return [_row_to_membership(r) for r in result.scalars()]

    async def get_membership(self, user_id: str, tenant_id: str) -> TenantMembership | None:
        from sqlalchemy import select

        async with self._Session() as session:
            result = await session.execute(
                select(_MembershipRow).where(
                    _MembershipRow.user_id == user_id,
                    _MembershipRow.tenant_id == tenant_id,
                )
            )
            row = result.scalar_one_or_none()
            return _row_to_membership(row) if row else None

    async def update_member_role(self, user_id: str, tenant_id: str, new_role: str) -> None:
        from sqlalchemy import select

        async with self._Session() as session:
            result = await session.execute(
                select(_MembershipRow).where(
                    _MembershipRow.user_id == user_id,
                    _MembershipRow.tenant_id == tenant_id,
                )
            )
            row = result.scalar_one_or_none()
            if row is None:
                raise KeyError(f"No membership for user {user_id!r} in tenant {tenant_id!r}")
            row.role = new_role
            await session.commit()

    async def remove_member(self, user_id: str, tenant_id: str) -> None:
        from sqlalchemy import select, delete

        async with self._Session() as session:
            await session.execute(
                delete(_MembershipRow).where(
                    _MembershipRow.user_id == user_id,
                    _MembershipRow.tenant_id == tenant_id,
                )
            )
            await session.commit()

    async def create_workspace(self, workspace: Workspace) -> Workspace:
        async with self._Session() as session:
            row = _WorkspaceRow(
                id=workspace.id,
                tenant_id=workspace.tenant_id,
                name=workspace.name,
                created_at=workspace.created_at,
                description=workspace.description,
            )
            session.add(row)
            await session.commit()
        return workspace

    async def get_workspace(self, workspace_id: str) -> Workspace | None:
        from sqlalchemy import select

        async with self._Session() as session:
            result = await session.execute(select(_WorkspaceRow).where(_WorkspaceRow.id == workspace_id))
            row = result.scalar_one_or_none()
            return _row_to_workspace(row) if row else None

    async def list_workspaces(self, tenant_id: str) -> list[Workspace]:
        from sqlalchemy import select

        async with self._Session() as session:
            result = await session.execute(
                select(_WorkspaceRow).where(_WorkspaceRow.tenant_id == tenant_id)
            )
            return [_row_to_workspace(r) for r in result.scalars()]

    async def create_project(self, project: Project) -> Project:
        async with self._Session() as session:
            row = _ProjectRow(
                id=project.id,
                workspace_id=project.workspace_id,
                name=project.name,
                created_at=project.created_at,
            )
            session.add(row)
            await session.commit()
        return project

    async def get_project(self, project_id: str) -> Project | None:
        from sqlalchemy import select

        async with self._Session() as session:
            result = await session.execute(select(_ProjectRow).where(_ProjectRow.id == project_id))
            row = result.scalar_one_or_none()
            return _row_to_project(row) if row else None

    async def list_projects(self, workspace_id: str) -> list[Project]:
        from sqlalchemy import select

        async with self._Session() as session:
            result = await session.execute(
                select(_ProjectRow).where(_ProjectRow.workspace_id == workspace_id)
            )
            return [_row_to_project(r) for r in result.scalars()]

    async def store_invite(self, token: str, tenant_id: str, email: str, role: str, expires_at: str) -> None:
        async with self._Session() as session:
            row = _InviteRow(
                token=token,
                tenant_id=tenant_id,
                email=email,
                role=role,
                expires_at=expires_at,
            )
            session.add(row)
            await session.commit()

    async def get_invite(self, token: str) -> dict | None:
        from sqlalchemy import select

        async with self._Session() as session:
            result = await session.execute(select(_InviteRow).where(_InviteRow.token == token))
            row = result.scalar_one_or_none()
            if row is None:
                return None
            return {
                "token": row.token,
                "tenant_id": row.tenant_id,
                "email": row.email,
                "role": row.role,
                "expires_at": row.expires_at,
            }

    async def delete_invite(self, token: str) -> None:
        from sqlalchemy import delete

        async with self._Session() as session:
            await session.execute(delete(_InviteRow).where(_InviteRow.token == token))
            await session.commit()


# ---------------------------------------------------------------------------
# SQLAlchemy ORM tables (defined lazily so no import at module level)
# ---------------------------------------------------------------------------

try:
    from sqlalchemy.orm import DeclarativeBase, mapped_column, Mapped
    from sqlalchemy import String, Boolean

    class _Base(DeclarativeBase):
        pass

    class _UserRow(_Base):
        __tablename__ = "users"
        id: Mapped[str] = mapped_column(String, primary_key=True)
        email: Mapped[str] = mapped_column(String, unique=True, nullable=False)
        name: Mapped[str] = mapped_column(String, nullable=False)
        password_hash: Mapped[str | None] = mapped_column(String, nullable=True)
        created_at: Mapped[str] = mapped_column(String, nullable=False)
        is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    class _TenantRow(_Base):
        __tablename__ = "tenants"
        id: Mapped[str] = mapped_column(String, primary_key=True)
        name: Mapped[str] = mapped_column(String, nullable=False)
        created_at: Mapped[str] = mapped_column(String, nullable=False)
        plan: Mapped[str] = mapped_column(String, nullable=False, default="default")

    class _MembershipRow(_Base):
        __tablename__ = "tenant_memberships"
        user_id: Mapped[str] = mapped_column(String, primary_key=True)
        tenant_id: Mapped[str] = mapped_column(String, primary_key=True)
        role: Mapped[str] = mapped_column(String, nullable=False)
        invited_at: Mapped[str] = mapped_column(String, nullable=False)

    class _WorkspaceRow(_Base):
        __tablename__ = "workspaces"
        id: Mapped[str] = mapped_column(String, primary_key=True)
        tenant_id: Mapped[str] = mapped_column(String, nullable=False)
        name: Mapped[str] = mapped_column(String, nullable=False)
        created_at: Mapped[str] = mapped_column(String, nullable=False)
        description: Mapped[str] = mapped_column(String, nullable=False, default="")

    class _ProjectRow(_Base):
        __tablename__ = "projects"
        id: Mapped[str] = mapped_column(String, primary_key=True)
        workspace_id: Mapped[str] = mapped_column(String, nullable=False)
        name: Mapped[str] = mapped_column(String, nullable=False)
        created_at: Mapped[str] = mapped_column(String, nullable=False)

    class _InviteRow(_Base):
        __tablename__ = "invites"
        token: Mapped[str] = mapped_column(String, primary_key=True)
        tenant_id: Mapped[str] = mapped_column(String, nullable=False)
        email: Mapped[str] = mapped_column(String, nullable=False)
        role: Mapped[str] = mapped_column(String, nullable=False)
        expires_at: Mapped[str] = mapped_column(String, nullable=False)

    def _row_to_user(r: _UserRow) -> User:
        return User(
            id=r.id,
            email=r.email,
            name=r.name,
            password_hash=r.password_hash,
            created_at=r.created_at,
            is_active=bool(r.is_active),
        )

    def _row_to_tenant(r: _TenantRow) -> Tenant:
        return Tenant(id=r.id, name=r.name, created_at=r.created_at, plan=r.plan)

    def _row_to_membership(r: _MembershipRow) -> TenantMembership:
        return TenantMembership(
            user_id=r.user_id,
            tenant_id=r.tenant_id,
            role=r.role,  # type: ignore[arg-type]
            invited_at=r.invited_at,
        )

    def _row_to_workspace(r: _WorkspaceRow) -> Workspace:
        return Workspace(
            id=r.id,
            tenant_id=r.tenant_id,
            name=r.name,
            created_at=r.created_at,
            description=r.description,
        )

    def _row_to_project(r: _ProjectRow) -> Project:
        return Project(
            id=r.id,
            workspace_id=r.workspace_id,
            name=r.name,
            created_at=r.created_at,
        )

except ImportError:
    # SQLAlchemy not installed; SqlAlchemyTenantStore will raise ImportError at runtime.
    class _Base:  # type: ignore[no-redef]
        metadata = None  # type: ignore[assignment]

    _UserRow = None  # type: ignore[assignment,misc]
    _TenantRow = None  # type: ignore[assignment,misc]
    _MembershipRow = None  # type: ignore[assignment,misc]
    _WorkspaceRow = None  # type: ignore[assignment,misc]
    _ProjectRow = None  # type: ignore[assignment,misc]
    _InviteRow = None  # type: ignore[assignment,misc]

    def _row_to_user(r):  # type: ignore[misc]
        raise ImportError("sqlalchemy not installed")

    def _row_to_tenant(r):  # type: ignore[misc]
        raise ImportError("sqlalchemy not installed")

    def _row_to_membership(r):  # type: ignore[misc]
        raise ImportError("sqlalchemy not installed")

    def _row_to_workspace(r):  # type: ignore[misc]
        raise ImportError("sqlalchemy not installed")

    def _row_to_project(r):  # type: ignore[misc]
        raise ImportError("sqlalchemy not installed")
