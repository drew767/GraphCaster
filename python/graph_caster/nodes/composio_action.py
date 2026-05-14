# Copyright GraphCaster. All Rights Reserved.

"""ComposioActionNode — runs a Composio action via the bridge (F66).

Registered with F95's register_class().  The bridge is instantiated once per
run context (cached in ctx["_composio_bridge"]) to reuse SDK connections.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, ClassVar

from graph_caster.node_api.base import GraphCasterNode
from graph_caster.node_api.context import NodeContext
from graph_caster.node_api.fields import Input, Output
from graph_caster.node_api.registry import register_class


def _get_or_create_bridge(ctx: Any) -> Any:
    """Return a cached ComposioBridge from the run context dict."""
    from graph_caster.tools.composio.bridge import ComposioBridge

    if isinstance(ctx, dict):
        bridge = ctx.get("_composio_bridge")
        if bridge is None:
            workspace_root: Path | None = None
            host = ctx.get("_gc_host")
            if host is not None:
                workspace_root = getattr(host, "workspace_root", None)
            api_key: str | None = None
            secrets = ctx.get("_gc_secrets")
            if secrets is not None and hasattr(secrets, "as_mapping"):
                api_key = secrets.as_mapping().get("COMPOSIO_API_KEY")
            bridge = ComposioBridge(api_key=api_key, workspace_root=workspace_root)
            ctx["_composio_bridge"] = bridge
        return bridge

    if isinstance(ctx, NodeContext):
        key = "COMPOSIO_API_KEY"
        api_key = ctx.secrets.as_mapping().get(key) if ctx.secrets is not None else None
        return ComposioBridge(api_key=api_key, workspace_root=ctx.workspace_root)

    from graph_caster.tools.composio.bridge import ComposioBridge

    return ComposioBridge()


class ComposioActionNode(GraphCasterNode):
    """Execute a Composio action (Slack, GitHub, Gmail, Notion, and 200+ others).

    Requires the optional extra:
        pip install -e '.[composio]'
    """

    type: ClassVar[str] = "composio_action"
    version: ClassVar[float] = 1.0
    display_name: ClassVar[str] = "Composio Action"
    description: ClassVar[str] = (
        "Run any Composio-managed integration action (Slack, GitHub, Gmail, "
        "Notion, Asana, Airtable, and 200+ others)."
    )
    category: ClassVar[str] = "integrations"
    icon: ClassVar[str] = "plug"

    inputs: ClassVar[list[Input]] = [
        Input(
            name="action",
            field_type=str,
            required=True,
            description="Composio action name, e.g. SLACK_SEND_MESSAGE or GITHUB_CREATE_ISSUE.",
            placeholder="SLACK_SEND_MESSAGE",
        ),
        Input(
            name="params",
            field_type="json",
            required=True,
            description="Action parameter dict. Values may use Mustache expressions.",
        ),
        Input(
            name="entityId",
            field_type=str,
            required=False,
            default="default",
            description="Composio entity ID for multi-user scenarios.",
        ),
        Input(
            name="timeoutSec",
            field_type=float,
            required=False,
            default=30.0,
            description="Execution timeout in seconds.",
            range=(1.0, 3600.0),
        ),
    ]

    outputs: ClassVar[list[Output]] = [
        Output(
            name="result",
            field_type="json",
            description="Full Composio action response.",
        ),
    ]

    async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
        action: str = kwargs["action"]
        params: dict = kwargs.get("params") or {}
        entity_id: str = kwargs.get("entityId") or "default"
        timeout_sec: float = float(kwargs.get("timeoutSec") or 30.0)

        bridge = _get_or_create_bridge(ctx)
        result = await asyncio.wait_for(
            bridge.invoke(action, params, entity_id=entity_id),
            timeout=timeout_sec,
        )
        return {"result": result}


register_class(ComposioActionNode)
