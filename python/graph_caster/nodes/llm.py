# Copyright GraphCaster. All Rights Reserved.

"""LLM node (F51): call an LLM with system + user prompts.

Supports direct provider calls and fallback chains (F53), token usage
tracking (F52), streaming via llm_token events, tool-call passthrough,
and Mustache template expansion in prompts via ctx.expression_eval.
"""

from __future__ import annotations

import os
from typing import Any, ClassVar

from graph_caster.llm import (
    ChatMessage,
    FallbackChat,
    FallbackPolicy,
    FallbackTarget,
    get_default_registry,
)
from graph_caster.llm.provider import ChatResponse, TokenUsage
from graph_caster.node_api.base import GraphCasterNode
from graph_caster.node_api.fields import Input, Output
from graph_caster.node_api.registry import register_class


class LLMNode(GraphCasterNode):
    type: ClassVar[str] = "llm"
    version: ClassVar[float] = 1.0
    display_name: ClassVar[str] = "LLM"
    description: ClassVar[str] = "Call an LLM with system + user prompts"
    category: ClassVar[str] = "ai"
    icon: ClassVar[str] = "brain"

    inputs: ClassVar[list[Input]] = [
        Input("provider", str, required=True, description="Provider name (openai, anthropic, ollama, ...)"),
        Input("model", str, required=True),
        Input("systemPrompt", str, default="", multiline=True),
        Input("userPrompt", str, required=True, multiline=True),
        Input("temperature", float, default=0.7, range=(0.0, 2.0)),
        Input("maxTokens", int, default=2048, range=(1, 200000)),
        Input("stream", bool, default=False),
        Input("tools", "json", default=None, description="Optional list of tool specs"),
        Input("fallback", "json", default=None, description="Optional list of FallbackTarget dicts"),
        Input(
            "temperatureEnv",
            str,
            default="",
            description="Optional env var name to override temperature",
        ),
    ]
    outputs: ClassVar[list[Output]] = [
        Output("content", str),
        Output("toolCalls", "json"),
        Output("usage", "json"),
        Output("finishReason", str),
    ]

    async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
        provider_name: str = kwargs.get("provider", "")
        model: str = kwargs.get("model", "")
        system_prompt: str = kwargs.get("systemPrompt", "") or ""
        user_prompt: str = kwargs.get("userPrompt", "") or ""
        temperature: float = float(kwargs.get("temperature", 0.7))
        max_tokens: int = int(kwargs.get("maxTokens", 2048))
        stream: bool = bool(kwargs.get("stream", False))
        tools: list[dict] | None = kwargs.get("tools", None)
        fallback_raw: list[dict] | None = kwargs.get("fallback", None)
        temperature_env: str = kwargs.get("temperatureEnv", "") or ""

        node_id: str = getattr(ctx, "node_id", "")
        run_id: str = getattr(ctx, "run_id", "")
        emit = getattr(ctx, "emit", None)

        if temperature_env:
            env_val = os.environ.get(temperature_env)
            if env_val is not None:
                try:
                    temperature = float(env_val)
                except ValueError:
                    pass

        expression_eval = getattr(ctx, "expression_eval", None)
        upstream = getattr(ctx, "upstream_outputs", {})

        def _expand(text: str) -> str:
            if not text or expression_eval is None:
                return text
            if "{{" not in text:
                return text
            try:
                result = expression_eval(text, {"node_outputs": upstream})
                return str(result) if result is not None else text
            except Exception:
                return text

        system_prompt = _expand(system_prompt)
        user_prompt = _expand(user_prompt)

        messages: list[ChatMessage] = []
        if system_prompt:
            messages.append(ChatMessage(role="system", content=system_prompt))
        messages.append(ChatMessage(role="user", content=user_prompt))

        tool_specs: list[dict] | None = tools if isinstance(tools, list) else None

        def _make_emit_event():
            if emit is None:
                return None

            def _emit(event: dict) -> None:
                emit(event)

            return _emit

        emit_event = _make_emit_event()

        registry = get_default_registry()

        usage_tracker = None
        if hasattr(ctx, "usage_tracker"):
            usage_tracker = ctx.usage_tracker

        if fallback_raw and isinstance(fallback_raw, list):
            targets = []
            for t in fallback_raw:
                if isinstance(t, dict):
                    targets.append(
                        FallbackTarget(
                            provider=str(t.get("provider", "")),
                            model=str(t.get("model", "")),
                            weight=float(t.get("weight", 1.0)),
                        )
                    )
            policy = FallbackPolicy(targets=targets)
            fallback_chat = FallbackChat(registry, policy)
            response = await fallback_chat.invoke(
                messages,
                tools=tool_specs,
                temperature=temperature,
                max_tokens=max_tokens,
                stream=False,
                emit_event=emit_event,
            )
        else:
            provider = registry.get(provider_name)
            if stream:
                response = await _run_streaming(
                    provider, model, messages,
                    tools=tool_specs,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    node_id=node_id,
                    run_id=run_id,
                    emit=emit,
                )
            else:
                response = await provider.chat(
                    model,
                    messages,
                    tools=tool_specs,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=False,
                )

        if usage_tracker is not None:
            try:
                usage_tracker.record(
                    node_id,
                    provider_name,
                    model,
                    response.usage,
                )
            except Exception:
                pass

        tool_calls_out = [tc.to_dict() for tc in (response.tool_calls or [])]

        return {
            "content": response.content,
            "toolCalls": tool_calls_out,
            "usage": response.usage.to_dict(),
            "finishReason": response.finish_reason,
        }


async def _run_streaming(
    provider: Any,
    model: str,
    messages: list,
    *,
    tools: list[dict] | None,
    temperature: float,
    max_tokens: int,
    node_id: str,
    run_id: str,
    emit: Any,
) -> Any:
    stream_iter = await provider.chat(
        model,
        messages,
        tools=tools,
        temperature=temperature,
        max_tokens=max_tokens,
        stream=True,
    )

    chunks: list[str] = []
    finish_reason = "stop"

    async for chunk in stream_iter:
        delta = chunk.delta or ""
        if delta and emit is not None:
            emit({
                "type": "llm_token",
                "nodeId": node_id,
                "runId": run_id,
                "content": delta,
            })
        if delta:
            chunks.append(delta)
        if chunk.finish_reason:
            finish_reason = chunk.finish_reason

    content = "".join(chunks)
    return ChatResponse(
        content=content,
        tool_calls=[],
        usage=TokenUsage(),
        finish_reason=finish_reason,
    )


register_class(LLMNode)
