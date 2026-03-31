# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from graph_caster.auth.permissions import AuthContext, Permission


@runtime_checkable
class RBACHook(Protocol):
    async def check_permission(
        self, ctx: AuthContext, resource: str, permission: Permission
    ) -> bool: ...

    async def filter_graphs(self, ctx: AuthContext, graph_ids: list[str]) -> list[str]: ...


class _NoopRBAC:
    async def check_permission(
        self, _ctx: AuthContext, _resource: str, _permission: Permission
    ) -> bool:
        return True

    async def filter_graphs(self, _ctx: AuthContext, graph_ids: list[str]) -> list[str]:
        return list(graph_ids)


def noop_rbac_hook() -> Any:
    return _NoopRBAC()
