# Copyright GraphCaster. All Rights Reserved.

"""Variable scope registry and per-run context wrapper."""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from enum import StrEnum
from typing import Any


class VariableScope(StrEnum):
    SYSTEM = "sys"
    RUN = "run"
    SESSION = "session"
    CONVERSATION = "conv"
    TENANT = "tenant"
    ENV = "env"


class VariableStore(ABC):
    """Abstract backend for scoped variable storage."""

    @abstractmethod
    async def get(self, scope: VariableScope, key: str, default: Any = None) -> Any:
        """Return the value for *key* in *scope*, or *default* if absent."""

    @abstractmethod
    async def set(self, scope: VariableScope, key: str, value: Any) -> None:
        """Persist *value* under *key* in *scope*."""

    @abstractmethod
    async def delete(self, scope: VariableScope, key: str) -> None:
        """Remove *key* from *scope* (no-op if absent)."""

    @abstractmethod
    async def list(self, scope: VariableScope) -> dict[str, Any]:
        """Return all key-value pairs for *scope* as a plain dict."""


class VariableContext:
    """Per-run wrapper that routes reads/writes to the underlying store using
    run_id / session_id / tenant_id as namespace keys.

    System variables are provided at construction time and are read-only.
    The ``conv`` scope is aliased to ``session`` transparently.
    """

    def __init__(
        self,
        store: VariableStore,
        *,
        run_id: str,
        session_id: str | None = None,
        tenant_id: str,
        system: dict[str, Any] | None = None,
    ) -> None:
        self._store = store
        self._run_id = run_id
        self._session_id = session_id
        self._tenant_id = tenant_id
        self._system: dict[str, Any] = dict(system) if system else {}
        # Run-scope is in-memory only (not delegated to the backing store)
        self._run_vars: dict[str, Any] = {}

        # Inject standard system variables if not already provided
        now_iso = datetime.now(tz=timezone.utc).isoformat()
        self._system.setdefault("run_id", run_id)
        self._system.setdefault("session_id", session_id or "")
        self._system.setdefault("tenant_id", tenant_id)
        self._system.setdefault("started_at", now_iso)

    # ------------------------------------------------------------------
    # Scope normalisation

    def _normalize_scope(self, scope: VariableScope) -> VariableScope:
        if scope == VariableScope.CONVERSATION:
            return VariableScope.SESSION
        return scope

    def _store_key(self, scope: VariableScope, key: str) -> str:
        """Return a namespaced key passed to the backing store."""
        scope = self._normalize_scope(scope)
        if scope == VariableScope.SESSION:
            prefix = self._session_id or "__no_session__"
        elif scope == VariableScope.TENANT:
            prefix = self._tenant_id
        else:
            prefix = self._run_id
        return f"{prefix}/{key}"

    # ------------------------------------------------------------------
    # Public async API

    async def get(self, scope: VariableScope, key: str, default: Any = None) -> Any:
        scope = self._normalize_scope(scope)
        if scope == VariableScope.SYSTEM:
            return self._system.get(key, default)
        if scope == VariableScope.RUN:
            return self._run_vars.get(key, default)
        if scope == VariableScope.ENV:
            # ENV is stored flat (no namespacing) in the backing store
            return await self._store.get(scope, key, default)
        return await self._store.get(scope, self._store_key(scope, key), default)

    async def set(self, scope: VariableScope, key: str, value: Any) -> None:
        scope = self._normalize_scope(scope)
        if scope == VariableScope.SYSTEM:
            raise ValueError("System variables are read-only")
        if scope == VariableScope.ENV:
            raise ValueError("Env variables are read-only")
        if scope == VariableScope.RUN:
            self._run_vars[key] = value
            return
        await self._store.set(scope, self._store_key(scope, key), value)

    async def delete(self, scope: VariableScope, key: str) -> None:
        scope = self._normalize_scope(scope)
        if scope in (VariableScope.SYSTEM, VariableScope.ENV):
            raise ValueError(f"{scope} variables are read-only")
        if scope == VariableScope.RUN:
            self._run_vars.pop(key, None)
            return
        await self._store.delete(scope, self._store_key(scope, key))

    async def list_scope(self, scope: VariableScope) -> dict[str, Any]:
        scope = self._normalize_scope(scope)
        if scope == VariableScope.SYSTEM:
            return dict(self._system)
        if scope == VariableScope.RUN:
            return dict(self._run_vars)
        if scope == VariableScope.ENV:
            # ENV is stored flat (no namespacing); return as-is
            return await self._store.list(scope)
        raw = await self._store.list(scope)
        # Strip the namespaced prefix and return only the keys relevant to this context
        if scope == VariableScope.SESSION:
            prefix = (self._session_id or "__no_session__") + "/"
        elif scope == VariableScope.TENANT:
            prefix = self._tenant_id + "/"
        else:
            prefix = self._run_id + "/"
        return {k[len(prefix):]: v for k, v in raw.items() if k.startswith(prefix)}

    async def to_expression_dict(self) -> dict[str, Any]:
        """Return a dict with keys ``sys``, ``run``, ``session``, ``tenant``, ``env``
        suitable for merging into the expression evaluator context.
        """
        sys_vars = dict(self._system)
        run_vars = dict(self._run_vars)
        session_vars = await self.list_scope(VariableScope.SESSION)
        tenant_vars = await self.list_scope(VariableScope.TENANT)
        env_vars = await self.list_scope(VariableScope.ENV)
        return {
            "sys": sys_vars,
            "run": run_vars,
            "session": session_vars,
            "tenant": tenant_vars,
            "env": env_vars,
        }

    # ------------------------------------------------------------------
    # Sync helpers (for callers in non-async paths)

    def get_sync(self, scope: VariableScope, key: str, default: Any = None) -> Any:
        return asyncio.run(self.get(scope, key, default))

    def set_sync(self, scope: VariableScope, key: str, value: Any) -> None:
        asyncio.run(self.set(scope, key, value))

    def to_expression_dict_sync(self) -> dict[str, Any]:
        return asyncio.run(self.to_expression_dict())
