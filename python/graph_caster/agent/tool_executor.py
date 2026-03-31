# Copyright Aura. All Rights Reserved.

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any


class ToolExecutor:
    """Maps tool names to callables (sync); arguments are JSON-object-shaped dicts."""

    def __init__(self, tools: Mapping[str, Callable[[dict[str, Any]], Any]] | None = None) -> None:
        self._tools: dict[str, Callable[[dict[str, Any]], Any]] = dict(tools or {})

    def register(self, name: str, fn: Callable[[dict[str, Any]], Any]) -> None:
        self._tools[name] = fn

    def schemas(self) -> list[dict[str, Any]]:
        """Minimal OpenAI-style function schemas for provider hints."""
        return [
            {
                "type": "function",
                "function": {
                    "name": name,
                    "description": f"Tool {name}",
                    "parameters": {"type": "object", "additionalProperties": True},
                },
            }
            for name in sorted(self._tools)
        ]

    def run(self, name: str, arguments: dict[str, Any] | None) -> str:
        fn = self._tools.get(name)
        if fn is None:
            return f"unknown_tool:{name}"
        args = arguments if isinstance(arguments, dict) else {}
        try:
            out = fn(args)
            return out if isinstance(out, str) else str(out)
        except Exception as e:  # noqa: BLE001 — surface to LLM as observation
            return f"error:{type(e).__name__}:{e}"
