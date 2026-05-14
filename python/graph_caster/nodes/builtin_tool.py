# Copyright GraphCaster. All Rights Reserved.

"""BuiltinToolNode — generic wrapper for F64 built-in tool registry."""

from __future__ import annotations

from typing import Any, ClassVar

from graph_caster.node_api.base import GraphCasterNode
from graph_caster.node_api.fields import Input, Output
from graph_caster.node_api.registry import register_class


class BuiltinToolNode(GraphCasterNode):
    """Execute any tool from the built-in tool registry.

    The *tool* input names a registered built-in (e.g. "calc", "wikipedia_search").
    The *arguments* input is a JSON object whose keys are passed as keyword
    arguments to the tool callable.
    """

    type: ClassVar[str] = "builtin_tool"
    version: ClassVar[float] = 1.0
    display_name: ClassVar[str] = "Built-in Tool"
    description: ClassVar[str] = (
        "Run one of the 10 built-in tools (calculator, web search, Wikipedia, "
        "weather, HTTP GET, time, regex, JSON parse, base64, UUID)."
    )
    category: ClassVar[str] = "tools"
    icon: ClassVar[str] = "tool"

    inputs: ClassVar[list[Input]] = [
        Input(
            name="tool",
            field_type=str,
            required=True,
            description="Tool name from the built-in registry (e.g. 'calc', 'wikipedia_search').",
            placeholder="calc",
        ),
        Input(
            name="arguments",
            field_type="json",
            required=True,
            description="Keyword arguments passed to the tool as a JSON object.",
        ),
    ]

    outputs: ClassVar[list[Output]] = [
        Output(
            name="result",
            field_type="json",
            description="Tool output.",
        ),
    ]

    async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
        from graph_caster.tools.registry import get_default_registry

        tool_name: str = kwargs["tool"]
        arguments: dict = kwargs.get("arguments") or {}

        registry = get_default_registry()
        spec = registry.get(tool_name)
        if spec is None:
            available = [s.name for s in registry.list()]
            raise ValueError(
                f"Unknown built-in tool: {tool_name!r}. "
                f"Available: {available}"
            )

        if not isinstance(arguments, dict):
            raise TypeError(f"'arguments' must be a JSON object, got {type(arguments).__name__}")

        result = await spec.callable(**arguments)
        return {"result": result}


register_class(BuiltinToolNode)
