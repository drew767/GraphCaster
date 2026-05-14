# Copyright GraphCaster. All Rights Reserved.

"""Reroute node: passes upstream output downstream unchanged (ComfyUI-style)."""

from __future__ import annotations

from typing import Any

from graph_caster.node_api.base import GraphCasterNode
from graph_caster.node_api.fields import Input, Output
from graph_caster.node_api.registry import register_class


class RerouteNode(GraphCasterNode):
    type = "reroute"
    version = 1.0
    display_name = "Reroute"
    description = "Passes the upstream output to downstream unchanged. Wire-routing helper."
    category = "flow"
    inputs: list[Input] = [Input("input", "json")]
    outputs: list[Output] = [Output("output", "json")]

    async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
        return {"output": kwargs.get("input")}


register_class(RerouteNode)
