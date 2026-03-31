# Copyright Aura. All Rights Reserved.

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol

from graph_caster.agent.tool_executor import ToolExecutor


@dataclass
class LlmToolCall:
    name: str
    arguments: dict[str, Any]


@dataclass
class LlmTextResult:
    text: str


class InRunnerLlm(Protocol):
    def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None,
    ) -> LlmToolCall | LlmTextResult: ...


class AgentLoop:
    """Fixed-depth tool loop: LLM proposes tool calls or final text."""

    def __init__(
        self,
        llm: InRunnerLlm,
        tools: ToolExecutor,
        *,
        max_iterations: int = 10,
    ) -> None:
        self._llm = llm
        self._tools = tools
        self._max_iterations = max(1, max_iterations)

    def steps(
        self,
        user_message: str,
        *,
        system_prompt: str | None = None,
    ) -> list[tuple[Literal["tool_call", "tool_result", "final"], Any]]:
        messages: list[dict[str, Any]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": user_message})

        trace: list[tuple[Literal["tool_call", "tool_result", "final"], Any]] = []
        tool_schemas = self._tools.schemas() or None

        for _ in range(self._max_iterations):
            response = self._llm.complete(messages, tools=tool_schemas)
            if isinstance(response, LlmToolCall):
                trace.append(("tool_call", response))
                observation = self._tools.run(response.name, response.arguments)
                trace.append(("tool_result", observation))
                messages.append(
                    {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {
                                    "name": response.name,
                                    "arguments": str(response.arguments),
                                },
                            }
                        ],
                    }
                )
                messages.append({"role": "tool", "content": observation, "name": response.name})
                continue
            trace.append(("final", response.text))
            return trace

        trace.append(("final", "max_iterations_reached"))
        return trace
