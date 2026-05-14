# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {"id": self.id, "name": self.name, "arguments": self.arguments}

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ToolCall:
        return cls(id=d["id"], name=d["name"], arguments=d.get("arguments") or {})


@dataclass
class ChatMessage:
    role: Literal["system", "user", "assistant", "tool"]
    content: str
    tool_calls: list[ToolCall] | None = None
    tool_call_id: str | None = None

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"role": self.role, "content": self.content}
        if self.tool_calls is not None:
            d["tool_calls"] = [tc.to_dict() for tc in self.tool_calls]
        if self.tool_call_id is not None:
            d["tool_call_id"] = self.tool_call_id
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ChatMessage:
        tcs: list[ToolCall] | None = None
        if "tool_calls" in d and d["tool_calls"] is not None:
            tcs = [ToolCall.from_dict(tc) for tc in d["tool_calls"]]
        return cls(
            role=d["role"],
            content=d.get("content") or "",
            tool_calls=tcs,
            tool_call_id=d.get("tool_call_id"),
        )


@dataclass
class TokenUsage:
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> TokenUsage:
        return cls(
            prompt_tokens=d.get("prompt_tokens", 0),
            completion_tokens=d.get("completion_tokens", 0),
            total_tokens=d.get("total_tokens", 0),
        )


@dataclass
class ChatResponse:
    content: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: TokenUsage = field(default_factory=TokenUsage)
    finish_reason: str = "stop"
    raw: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "content": self.content,
            "tool_calls": [tc.to_dict() for tc in self.tool_calls],
            "usage": self.usage.to_dict(),
            "finish_reason": self.finish_reason,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ChatResponse:
        tcs = [ToolCall.from_dict(tc) for tc in (d.get("tool_calls") or [])]
        usage = TokenUsage.from_dict(d.get("usage") or {})
        return cls(
            content=d.get("content") or "",
            tool_calls=tcs,
            usage=usage,
            finish_reason=d.get("finish_reason") or "stop",
            raw=d.get("raw") or {},
        )


@dataclass
class ChatStreamChunk:
    delta: str
    tool_call_delta: ToolCall | None = None
    finish_reason: str | None = None


class ModelProvider(ABC):
    name: str

    @abstractmethod
    async def chat(
        self,
        model: str,
        messages: list[ChatMessage],
        *,
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        stream: bool = False,
    ) -> ChatResponse | AsyncIterator[ChatStreamChunk]:
        ...

    @abstractmethod
    async def list_models(self) -> list[str]:
        ...
