# Copyright GraphCaster. All Rights Reserved.

"""High-level tenancy operations: signup, auth, invite, membership."""

from __future__ import annotations

import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

from graph_caster.tenancy.models import Tenant, TenantMembership, User
from graph_caster.tenancy.store import TenantStore


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_password(password: str) -> str:
    """Derive a stored hash using hashlib.scrypt with a random 32-byte salt."""
    salt = os.urandom(32)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1)
    return salt.hex() + ":" + dk.hex()


def _verify_password(password: str, stored: str) -> bool:
    """Verify a password against a stored scrypt hash."""
    try:
        salt_hex, dk_hex = stored.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(dk_hex)
    except (ValueError, AttributeError):
        return False
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=16384, r=8, p=1)
    return secrets.compare_digest(dk, expected)


class AuthenticationError(Exception):
    """Raised when credentials are invalid."""


class InviteError(Exception):
    """Raised when an invite token is invalid or expired."""


class TenantService:
    """High-level tenancy service backed by a TenantStore."""

    def __init__(self, store: TenantStore) -> None:
        self._store = store

    async def signup(
        self, email: str, name: str, password: str | None = None
    ) -> tuple[User, Tenant]:
        """Create a new user and a personal tenant; returns (user, tenant).

        If *password* is None the user is SSO-only (no password hash stored).
        """
        now = _utcnow()
        user = User(
            id=str(uuid.uuid4()),
            email=email,
            name=name,
            created_at=now,
            password_hash=_hash_password(password) if password else None,
        )
        user = await self._store.create_user(user)

        tenant = Tenant(
            id=str(uuid.uuid4()),
            name=f"{name}'s workspace",
            created_at=now,
            plan="default",
        )
        tenant = await self._store.create_tenant(tenant)

        await self._store.add_membership(
            TenantMembership(
                user_id=user.id,
                tenant_id=tenant.id,
                role="owner",
                invited_at=now,
            )
        )
        return user, tenant

    async def authenticate(self, email: str, password: str) -> User:
        """Return the User if credentials are valid; raise AuthenticationError otherwise."""
        user = await self._store.find_user_by_email(email)
        if user is None:
            raise AuthenticationError(f"No user with email {email!r}")
        if user.password_hash is None:
            raise AuthenticationError("User has no password (SSO-only account)")
        if not _verify_password(password, user.password_hash):
            raise AuthenticationError("Invalid password")
        if not user.is_active:
            raise AuthenticationError("User account is inactive")
        return user

    async def invite_member(self, tenant_id: str, email: str, role: str) -> str:
        """Create an invite token for *email* to join *tenant_id* with *role*.

        Token expires in 7 days. Returns the token string.
        """
        token = secrets.token_urlsafe(32)
        expires_at = (datetime.now(timezone.utc) + timedelta(days=7)).isoformat()
        await self._store.store_invite(
            token=token,
            tenant_id=tenant_id,
            email=email,
            role=role,
            expires_at=expires_at,
        )
        return token

    async def accept_invite(self, token: str, user: User) -> TenantMembership:
        """Accept an invite and create a membership. Raises InviteError if invalid/expired."""
        inv = await self._store.get_invite(token)
        if inv is None:
            raise InviteError("Invalid or already-used invite token")
        expires_at = datetime.fromisoformat(inv["expires_at"])
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if datetime.now(timezone.utc) > expires_at:
            await self._store.delete_invite(token)
            raise InviteError("Invite token has expired")
        m = TenantMembership(
            user_id=user.id,
            tenant_id=inv["tenant_id"],
            role=inv["role"],  # type: ignore[arg-type]
            invited_at=_utcnow(),
        )
        await self._store.add_membership(m)
        await self._store.delete_invite(token)
        return m

    async def list_user_tenants(self, user_id: str) -> list[Tenant]:
        return await self._store.list_tenants_for_user(user_id)

    async def user_can_access_tenant(self, user_id: str, tenant_id: str) -> bool:
        m = await self._store.get_membership(user_id, tenant_id)
        return m is not None
