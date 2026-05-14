# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import os
from typing import Any, AsyncIterator

import httpx

from graph_caster.llm.errors import (
    LLMAuthError,
    LLMBadRequestError,
    LLMQuotaExceededError,
    LLMRateLimitError,
    LLMServerError,
    LLMTimeoutError,
)
from graph_caster.llm.provider import (
    ChatMessage,
    ChatResponse,
    ChatStreamChunk,
    ModelProvider,
    ToolCall,
    TokenUsage,
)

_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1"
_ANTHROPIC_API_VERSION = "2023-06-01"


def _raise_for_anthropic_status(resp: httpx.Response) -> None:
    """Map Anthropic HTTP error codes to typed LLMError subclasses."""
    if resp.status_code < 400:
        return
    status = resp.status_code
    try:
        body = resp.json()
    except Exception:
        body = {}
    error_obj = body.get("error") or {}
    message = error_obj.get("message") or resp.text or ""
    error_type = error_obj.get("type") or ""

    if status == 429:
        if "quota" in error_type or "quota" in message.lower():
            raise LLMQuotaExceededError(message, status_code=status)
        raise LLMRateLimitError(message, status_code=status)
    if status in (401, 403):
        raise LLMAuthError(message, status_code=status)
    if status >= 500:
        raise LLMServerError(message, status_code=status)
    raise LLMBadRequestError(message, status_code=status)


def _resolve_api_key() -> str | None:
    return os.environ.get("ANTHROPIC_API_KEY")


def _build_anthropic_payload(
    model: str,
    messages: list[ChatMessage],
    *,
    tools: list[dict[str, Any]] | None,
    temperature: float | None,
    max_tokens: int | None,
    stream: bool,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """Returns (system_message_or_None, list_of_user_assistant_messages)."""
    system_text: str | None = None
    anthropic_messages: list[dict[str, Any]] = []

    for m in messages:
        if m.role == "system":
            system_text = m.content
            continue
        if m.role == "tool":
            anthropic_messages.append({
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": m.tool_call_id or "",
                        "content": m.content,
                    }
                ],
            })
            continue
        if m.role == "assistant" and m.tool_calls:
            content_blocks: list[dict[str, Any]] = []
            if m.content:
                content_blocks.append({"type": "text", "text": m.content})
            for tc in m.tool_calls:
                content_blocks.append({
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.name,
                    "input": tc.arguments,
                })
            anthropic_messages.append({"role": "assistant", "content": content_blocks})
            continue
        anthropic_messages.append({"role": m.role, "content": m.content})

    return system_text, anthropic_messages


def _parse_anthropic_response(data: dict[str, Any]) -> ChatResponse:
    content_blocks = data.get("content") or []
    text_parts: list[str] = []
    tool_calls: list[ToolCall] = []

    for block in content_blocks:
        btype = block.get("type")
        if btype == "text":
            text_parts.append(block.get("text") or "")
        elif btype == "tool_use":
            tool_calls.append(ToolCall(
                id=block.get("id") or "",
                name=block.get("name") or "",
                arguments=block.get("input") or {},
            ))

    usage_raw = data.get("usage") or {}
    usage = TokenUsage(
        prompt_tokens=usage_raw.get("input_tokens", 0),
        completion_tokens=usage_raw.get("output_tokens", 0),
        total_tokens=usage_raw.get("input_tokens", 0) + usage_raw.get("output_tokens", 0),
    )
    stop_reason = data.get("stop_reason") or "end_turn"

    return ChatResponse(
        content="".join(text_parts),
        tool_calls=tool_calls,
        usage=usage,
        finish_reason=stop_reason,
        raw=data,
    )


class AnthropicProvider(ModelProvider):
    name = "anthropic"

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = _ANTHROPIC_BASE_URL,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key or _resolve_api_key() or ""
        self._base_url = base_url.rstrip("/")
        self._http_client = http_client

    def _client(self) -> httpx.AsyncClient:
        if self._http_client is not None:
            return self._http_client
        return httpx.AsyncClient(timeout=60.0)

    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self._api_key,
            "anthropic-version": _ANTHROPIC_API_VERSION,
            "Content-Type": "application/json",
        }

    def _build_body(
        self,
        model: str,
        messages: list[ChatMessage],
        *,
        tools: list[dict[str, Any]] | None,
        temperature: float | None,
        max_tokens: int | None,
        stream: bool,
    ) -> dict[str, Any]:
        system_text, anthropic_messages = _build_anthropic_payload(
            model, messages, tools=tools, temperature=temperature,
            max_tokens=max_tokens, stream=stream,
        )
        body: dict[str, Any] = {
            "model": model,
            "messages": anthropic_messages,
            "max_tokens": max_tokens or 1024,
        }
        if system_text is not None:
            body["system"] = system_text
        if tools:
            body["tools"] = [
                {
                    "name": t.get("name") or t.get("function", {}).get("name", ""),
                    "description": t.get("description") or t.get("function", {}).get("description", ""),
                    "input_schema": t.get("parameters") or t.get("function", {}).get("parameters", {}),
                }
                for t in tools
            ]
        if temperature is not None:
            body["temperature"] = temperature
        if stream:
            body["stream"] = True
        return body

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
        body = self._build_body(
            model, messages,
            tools=tools, temperature=temperature, max_tokens=max_tokens, stream=stream,
        )
        if stream:
            return self._stream(body)
        return await self._complete(body)

    async def _complete(self, body: dict[str, Any]) -> ChatResponse:
        client = self._client()
        close_after = self._http_client is None
        try:
            try:
                resp = await client.post(
                    f"{self._base_url}/messages",
                    headers=self._headers(),
                    json=body,
                )
            except httpx.TimeoutException as exc:
                raise LLMTimeoutError(str(exc)) from exc
            _raise_for_anthropic_status(resp)
            return _parse_anthropic_response(resp.json())
        finally:
            if close_after:
                await client.aclose()

    async def _stream(self, body: dict[str, Any]) -> AsyncIterator[ChatStreamChunk]:
        client = self._client()
        close_after = self._http_client is None
        try:
            async with client.stream(
                "POST",
                f"{self._base_url}/messages",
                headers=self._headers(),
                json=body,
            ) as resp:
                _raise_for_anthropic_status(resp)
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:]
                    try:
                        event_data = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    etype = event_data.get("type")
                    if etype == "content_block_delta":
                        delta_obj = event_data.get("delta") or {}
                        if delta_obj.get("type") == "text_delta":
                            yield ChatStreamChunk(delta=delta_obj.get("text") or "")
                    elif etype == "message_delta":
                        stop_reason = (event_data.get("delta") or {}).get("stop_reason")
                        if stop_reason:
                            yield ChatStreamChunk(delta="", finish_reason=stop_reason)
        finally:
            if close_after:
                await client.aclose()

    async def list_models(self) -> list[str]:
        return [
            "claude-opus-4-5",
            "claude-sonnet-4-5",
            "claude-haiku-3-5",
            "claude-opus-4-0",
            "claude-sonnet-4-0",
        ]


def _auto_register() -> None:
    if not _resolve_api_key():
        return
    from graph_caster.llm.registry import get_default_registry
    registry = get_default_registry()
    if "anthropic" not in registry.list_providers():
        registry.register(AnthropicProvider())
