# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio

from graph_caster.auth.permissions import AuthContext, Permission
from graph_caster.auth.rbac_hook import noop_rbac_hook


def test_noop_rbac_allows_all() -> None:
    hook = noop_rbac_hook()
    ctx = AuthContext(user_id="u1", permissions={Permission.GRAPH_READ})

    async def _t() -> None:
        assert await hook.check_permission(ctx, "res", Permission.GRAPH_EXECUTE) is True
        assert await hook.filter_graphs(ctx, ["a", "b"]) == ["a", "b"]

    asyncio.run(_t())
