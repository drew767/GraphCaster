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

_DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"


def _raise_for_ollama_status(resp: httpx.Response) -> None:
    """Map Ollama HTTP error codes to typed LLMError subclasses."""
    if resp.status_code < 400:
        return
    status = resp.status_code
    try:
        body = resp.json()
    except Exception:
        body = {}
    message = body.get("error") or resp.text or ""

    if status == 429:
        raise LLMRateLimitError(message, status_code=status)
    if status in (401, 403):
        raise LLMAuthError(message, status_code=status)
    if status >= 500:
        raise LLMServerError(message, status_code=status)
    raise LLMBadRequestError(message, status_code=status)


def _resolve_base_url() -> str:
    return os.environ.get("OLLAMA_BASE_URL") or _DEFAULT_OLLAMA_BASE_URL


def _build_ollama_messages(messages: list[ChatMessage]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for m in messages:
        entry: dict[str, Any] = {"role": m.role, "content": m.content}
        if m.tool_calls:
            entry["tool_calls"] = [
                {
                    "function": {
                        "name": tc.name,
                        "arguments": tc.arguments,
                    }
                }
                for tc in m.tool_calls
            ]
        result.append(entry)
    return result


def _parse_ollama_tool_calls(raw_calls: list[dict[str, Any]] | None) -> list[ToolCall]:
    if not raw_calls:
        return []
    out: list[ToolCall] = []
    for i, tc in enumerate(raw_calls):
        fn = tc.get("function") or {}
        args = fn.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {"_raw": args}
        out.append(ToolCall(
            id=tc.get("id") or f"call_{i}",
            name=fn.get("name") or "",
            arguments=args,
        ))
    return out


def _parse_ollama_response(data: dict[str, Any]) -> ChatResponse:
    msg = data.get("message") or {}
    content = msg.get("content") or ""
    tool_calls = _parse_ollama_tool_calls(msg.get("tool_calls"))
    done_reason = data.get("done_reason") or "stop"

    prompt_tokens = data.get("prompt_eval_count", 0) or 0
    completion_tokens = data.get("eval_count", 0) or 0
    usage = TokenUsage(
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=prompt_tokens + completion_tokens,
    )
    return ChatResponse(
        content=content,
        tool_calls=tool_calls,
        usage=usage,
        finish_reason=done_reason,
        raw=data,
    )


class OllamaProvider(ModelProvider):
    name = "ollama"

    def __init__(
        self,
        base_url: str | None = None,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = (base_url or _resolve_base_url()).rstrip("/")
        self._http_client = http_client

    def _client(self) -> httpx.AsyncClient:
        if self._http_client is not None:
            return self._http_client
        return httpx.AsyncClient(timeout=120.0)

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
            "messages": _build_ollama_messages(messages),
            "stream": stream,
        }
        if tools:
            body["tools"] = tools
        options: dict[str, Any] = {}
        if temperature is not None:
            options["temperature"] = temperature
        if max_tokens is not None:
            options["num_predict"] = max_tokens
        if options:
            body["options"] = options

        if stream:
            return self._stream(body)
        return await self._complete(body)

    async def _complete(self, body: dict[str, Any]) -> ChatResponse:
        client = self._client()
        close_after = self._http_client is None
        try:
            try:
                resp = await client.post(
                    f"{self._base_url}/api/chat",
                    json=body,
                )
            except httpx.TimeoutException as exc:
                raise LLMTimeoutError(str(exc)) from exc
            _raise_for_ollama_status(resp)
            return _parse_ollama_response(resp.json())
        finally:
            if close_after:
                await client.aclose()

    async def _stream(self, body: dict[str, Any]) -> AsyncIterator[ChatStreamChunk]:
        client = self._client()
        close_after = self._http_client is None
        try:
            async with client.stream(
                "POST",
                f"{self._base_url}/api/chat",
                json=body,
            ) as resp:
                _raise_for_ollama_status(resp)
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk_data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    msg = chunk_data.get("message") or {}
                    delta = msg.get("content") or ""
                    done = chunk_data.get("done", False)
                    finish = chunk_data.get("done_reason") if done else None
                    yield ChatStreamChunk(delta=delta, finish_reason=finish)
                    if done:
                        break
        finally:
            if close_after:
                await client.aclose()

    async def list_models(self) -> list[str]:
        client = self._client()
        close_after = self._http_client is None
        try:
            try:
                resp = await client.get(f"{self._base_url}/api/tags")
            except httpx.TimeoutException as exc:
                raise LLMTimeoutError(str(exc)) from exc
            _raise_for_ollama_status(resp)
            data = resp.json()
            return [m["name"] for m in (data.get("models") or [])]
        finally:
            if close_after:
                await client.aclose()


def _auto_register() -> None:
    from graph_caster.llm.registry import get_default_registry
    registry = get_default_registry()
    if "ollama" not in registry.list_providers():
        registry.register(OllamaProvider())
