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

_OPENAI_BASE_URL = "https://api.openai.com/v1"


def _raise_for_openai_status(resp: httpx.Response) -> None:
    """Map OpenAI HTTP error codes to typed LLMError subclasses."""
    if resp.status_code < 400:
        return
    status = resp.status_code
    try:
        body = resp.json()
    except Exception:
        body = {}
    message = (body.get("error") or {}).get("message") or resp.text or ""

    if status == 429:
        error_code = (body.get("error") or {}).get("code") or ""
        if "quota" in error_code or "quota" in message.lower():
            raise LLMQuotaExceededError(message, status_code=status)
        raise LLMRateLimitError(message, status_code=status)
    if status in (401, 403):
        raise LLMAuthError(message, status_code=status)
    if status >= 500:
        raise LLMServerError(message, status_code=status)
    raise LLMBadRequestError(message, status_code=status)


def _resolve_api_key() -> str | None:
    return os.environ.get("OPENAI_API_KEY")


def _build_openai_messages(messages: list[ChatMessage]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for m in messages:
        entry: dict[str, Any] = {"role": m.role, "content": m.content}
        if m.tool_calls:
            entry["tool_calls"] = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)},
                }
                for tc in m.tool_calls
            ]
        if m.tool_call_id is not None:
            entry["tool_call_id"] = m.tool_call_id
        result.append(entry)
    return result


def _parse_openai_tool_calls(raw_calls: list[dict[str, Any]] | None) -> list[ToolCall]:
    if not raw_calls:
        return []
    out: list[ToolCall] = []
    for tc in raw_calls:
        fn = tc.get("function") or {}
        raw_args = fn.get("arguments") or "{}"
        try:
            args = json.loads(raw_args)
        except json.JSONDecodeError:
            args = {"_raw": raw_args}
        out.append(ToolCall(id=tc.get("id") or "", name=fn.get("name") or "", arguments=args))
    return out


def _parse_openai_response(data: dict[str, Any]) -> ChatResponse:
    choices = data.get("choices") or []
    choice = choices[0] if choices else {}
    msg = choice.get("message") or {}
    content = msg.get("content") or ""
    tool_calls = _parse_openai_tool_calls(msg.get("tool_calls"))
    finish_reason = choice.get("finish_reason") or "stop"
    usage_raw = data.get("usage") or {}
    usage = TokenUsage(
        prompt_tokens=usage_raw.get("prompt_tokens", 0),
        completion_tokens=usage_raw.get("completion_tokens", 0),
        total_tokens=usage_raw.get("total_tokens", 0),
    )
    return ChatResponse(
        content=content,
        tool_calls=tool_calls,
        usage=usage,
        finish_reason=finish_reason,
        raw=data,
    )


class OpenAIProvider(ModelProvider):
    name = "openai"

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str = _OPENAI_BASE_URL,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._api_key = api_key or _resolve_api_key() or ""
        self._base_url = base_url.rstrip("/")
        self._http_client = http_client

    def _client(self) -> httpx.AsyncClient:
        if self._http_client is not None:
            return self._http_client
        return httpx.AsyncClient(
            headers={"Authorization": f"Bearer {self._api_key}"},
            timeout=60.0,
        )

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

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
        body: dict[str, Any] = {
            "model": model,
            "messages": _build_openai_messages(messages),
            "stream": stream,
        }
        if tools:
            body["tools"] = tools
        if temperature is not None:
            body["temperature"] = temperature
        if max_tokens is not None:
            body["max_tokens"] = max_tokens

        if stream:
            return self._stream(body)
        return await self._complete(body)

    async def _complete(self, body: dict[str, Any]) -> ChatResponse:
        client = self._client()
        close_after = self._http_client is None
        try:
            try:
                resp = await client.post(
                    f"{self._base_url}/chat/completions",
                    headers=self._headers(),
                    json=body,
                )
            except httpx.TimeoutException as exc:
                raise LLMTimeoutError(str(exc)) from exc
            _raise_for_openai_status(resp)
            return _parse_openai_response(resp.json())
        finally:
            if close_after:
                await client.aclose()

    async def _stream(self, body: dict[str, Any]) -> AsyncIterator[ChatStreamChunk]:
        client = self._client()
        close_after = self._http_client is None
        try:
            async with client.stream(
                "POST",
                f"{self._base_url}/chat/completions",
                headers=self._headers(),
                json=body,
            ) as resp:
                _raise_for_openai_status(resp)
                async for line in resp.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:]
                    if payload.strip() == "[DONE]":
                        break
                    try:
                        chunk_data = json.loads(payload)
                    except json.JSONDecodeError:
                        continue
                    choices = chunk_data.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta") or {}
                    content_delta = delta.get("content") or ""
                    finish_reason = choices[0].get("finish_reason")
                    yield ChatStreamChunk(
                        delta=content_delta,
                        finish_reason=finish_reason,
                    )
        finally:
            if close_after:
                await client.aclose()

    async def list_models(self) -> list[str]:
        client = self._client()
        close_after = self._http_client is None
        try:
            try:
                resp = await client.get(
                    f"{self._base_url}/models",
                    headers=self._headers(),
                )
            except httpx.TimeoutException as exc:
                raise LLMTimeoutError(str(exc)) from exc
            _raise_for_openai_status(resp)
            data = resp.json()
            return [m["id"] for m in (data.get("data") or [])]
        finally:
            if close_after:
                await client.aclose()


def _auto_register() -> None:
    if not _resolve_api_key():
        return
    from graph_caster.llm.registry import get_default_registry
    registry = get_default_registry()
    if "openai" not in registry.list_providers():
        registry.register(OpenAIProvider())
