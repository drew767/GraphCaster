# Copyright GraphCaster. All Rights Reserved.

"""Tool registry for built-in and user-defined GraphCaster tools (F64)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


@dataclass
class ToolSpec:
    name: str
    display_name: str
    description: str
    parameters: dict
    callable: Callable[..., Awaitable[Any]]


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        self._tools[spec.name] = spec

    def get(self, name: str) -> ToolSpec | None:
        return self._tools.get(name)

    def list(self) -> list[ToolSpec]:
        return list(self._tools.values())

    def unregister(self, name: str) -> None:
        self._tools.pop(name, None)


_DEFAULT_REGISTRY: ToolRegistry | None = None


def get_default_registry() -> ToolRegistry:
    global _DEFAULT_REGISTRY
    if _DEFAULT_REGISTRY is None:
        _DEFAULT_REGISTRY = ToolRegistry()
        from graph_caster.tools.builtin import register_all
        register_all(_DEFAULT_REGISTRY)
    return _DEFAULT_REGISTRY
