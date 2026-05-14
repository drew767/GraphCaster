# Copyright GraphCaster. All Rights Reserved.

"""OpenAI-compatible API layer (F88).

Exposes any graph as if it were an OpenAI model so that existing OpenAI SDK
code can point at GraphCaster by changing only ``base_url``.

Model name convention:  ``gc-graph:<graphId>``  or
                         ``gc-graph:<graphId>@v<N>``   (specific published version)

Routes registered:
  POST /api/v1/openai/chat/completions
  GET  /api/v1/openai/models

Auth: ``Authorization: Bearer kid:secret`` with scope ``openai:invoke``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any, AsyncIterator

from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

if TYPE_CHECKING:
    from graph_caster.run_broker.auth.api_key import APIKeyAuthenticator

logger = logging.getLogger(__name__)

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

# Maximum characters per synthetic streaming chunk when the graph emits no llm_token events.
_STREAM_CHUNK_SIZE = 50

# Timeout (seconds) when waiting for run_finished after a graph run starts.
_RUN_WAIT_TIMEOUT = 300.0


def _parse_model(model_str: str) -> tuple[str, int | None]:
    """Return (graph_id, version_or_None) from a ``gc-graph:…`` model string.

    Raises ``ValueError`` if the prefix is absent.
    """
    prefix = "gc-graph:"
    if not model_str.startswith(prefix):
        raise ValueError(f"model must start with '{prefix}', got: {model_str!r}")
    rest = model_str[len(prefix):]
    if "@v" in rest:
        gid, ver_str = rest.rsplit("@v", 1)
        try:
            ver = int(ver_str)
        except ValueError:
            raise ValueError(f"version component must be an integer, got: {ver_str!r}")
        return gid, ver
    return rest, None


def _extract_user_query(messages: list[dict[str, Any]]) -> str:
    """Return the last user message text, or empty string."""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            content = msg.get("content", "")
            if isinstance(content, list):
                # vision-style: [{type: text, text: …}, …]
                parts = [p.get("text", "") for p in content if isinstance(p, dict) and p.get("type") == "text"]
                return " ".join(parts)
            return str(content)
    return ""


def _build_openai_response(
    run_id: str,
    model_str: str,
    content: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
) -> dict[str, Any]:
    return {
        "id": f"chatcmpl-{run_id}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model_str,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": prompt_tokens + completion_tokens,
        },
    }


def _chunk_event(
    run_id: str,
    model_str: str,
    delta_content: str,
    finish_reason: str | None = None,
) -> str:
    chunk: dict[str, Any] = {
        "id": f"chatcmpl-{run_id}",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model_str,
        "choices": [
            {
                "index": 0,
                "delta": {"content": delta_content} if delta_content else {},
                "finish_reason": finish_reason,
            }
        ],
    }
    return f"data: {json.dumps(chunk)}\n\n"


def _graphs_dir_from_env() -> Path | None:
    raw = os.environ.get("GC_RUN_BROKER_GRAPHS_DIR", "").strip()
    return Path(raw).resolve() if raw else None


def _workspace_root_from_env() -> Path | None:
    raw = os.environ.get("GC_RUN_BROKER_WORKSPACE_ROOT", "").strip()
    return Path(raw).resolve() if raw else None


async def _list_graph_ids() -> list[str]:
    """Return graph IDs available in the graphs directory."""
    gdir = _graphs_dir_from_env()
    if gdir is None:
        return []

    def _scan() -> list[str]:
        if not gdir.is_dir():
            return []
        ids: list[str] = []
        for p in sorted(gdir.glob("*.json")):
            if not p.is_file():
                continue
            try:
                doc = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            meta = doc.get("meta") or {}
            gid = (
                meta.get("graphId")
                or doc.get("graphId")
                or p.stem
            )
            if gid and gid != "default":
                ids.append(str(gid))
        return ids

    return await asyncio.to_thread(_scan)


async def _start_run_and_wait(
    graph_id: str,
    messages: list[dict[str, Any]],
    session_id: str | None,
    metadata: dict[str, Any] | None,
    version: int | None,
    run_manager: Any,
) -> tuple[str, str, int, int]:
    """Start a run via the internal run manager and wait for completion.

    Returns ``(run_id, content, prompt_tokens, completion_tokens)``.
    """
    user_query = _extract_user_query(messages)

    context: dict[str, Any] = {
        "messages": messages,
        "query": user_query,
    }
    if session_id:
        context["session_id"] = session_id
        context["session"] = {"history": messages, "session_id": session_id}
    if metadata:
        context["metadata"] = metadata
    if version is not None:
        context["graph_version"] = version

    trigger_ctx: dict[str, Any] = {
        "type": "openai_compat",
        "graph_id": graph_id,
        "session_id": session_id,
    }

    run_id = await run_manager.start_run(
        graph_id,
        context=context,
        trigger_context=trigger_ctx,
    )

    result = await run_manager.wait_for_run(run_id, timeout=_RUN_WAIT_TIMEOUT)

    outputs = result.get("outputs") or {}
    content = _extract_content_from_outputs(outputs)
    if not content and result.get("status") in ("failed", "timeout"):
        content = result.get("error") or f"Graph run ended with status: {result.get('status')}"

    usage = outputs.get("usage") or {}
    prompt_tokens = int(usage.get("prompt_tokens", 0))
    completion_tokens = int(usage.get("completion_tokens", 0))

    return run_id, content, prompt_tokens, completion_tokens


def _extract_content_from_outputs(outputs: Any) -> str:
    """Pull a text content string from graph exit-node outputs."""
    if not isinstance(outputs, dict):
        if outputs is None:
            return ""
        if isinstance(outputs, str):
            return outputs
        return json.dumps(outputs)

    # Direct content field
    if "content" in outputs and isinstance(outputs["content"], str):
        return outputs["content"]
    # Nested under exit node
    for key, val in outputs.items():
        if isinstance(val, dict):
            if "content" in val and isinstance(val["content"], str):
                return val["content"]
    # Fallback: JSON-encode
    if outputs:
        return json.dumps(outputs)
    return ""


def make_openai_compat_routes(
    run_manager: Any,
    auth: "APIKeyAuthenticator | None" = None,
) -> list[Route]:
    """Return Starlette Route objects for the OpenAI-compat surface."""

    def _check_auth(auth_header: str | None) -> Response | None:
        """Return a 403 Response on failure, or None if auth passes."""
        if auth is None:
            return None
        key = auth.validate(auth_header)
        if key is None:
            return JSONResponse({"error": "Invalid API key"}, status_code=403)
        if not auth.has_scope(key, "openai:invoke"):
            return JSONResponse({"error": "Missing scope: openai:invoke"}, status_code=403)
        return None

    async def post_chat_completions(request: Request) -> Response:
        auth_h = request.headers.get("Authorization")
        err = _check_auth(auth_h)
        if err is not None:
            return err

        try:
            body = await request.json()
            if not isinstance(body, dict):
                return JSONResponse({"error": "body must be an object"}, status_code=400)
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        model_str = body.get("model", "")
        if not model_str:
            return JSONResponse({"error": "model is required"}, status_code=400)

        try:
            graph_id, version = _parse_model(model_str)
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)

        messages: list[dict[str, Any]] = body.get("messages") or []
        if not isinstance(messages, list):
            return JSONResponse({"error": "messages must be an array"}, status_code=400)

        stream: bool = bool(body.get("stream", False))
        session_id: str | None = body.get("session_id") or None
        metadata: dict[str, Any] | None = body.get("metadata") or None
        if metadata is not None and not isinstance(metadata, dict):
            metadata = None

        try:
            run_id, content, prompt_tokens, completion_tokens = await _start_run_and_wait(
                graph_id=graph_id,
                messages=messages,
                session_id=session_id,
                metadata=metadata,
                version=version,
                run_manager=run_manager,
            )
        except FileNotFoundError:
            return JSONResponse({"error": f"Graph not found: {graph_id}"}, status_code=404)
        except PermissionError as exc:
            return JSONResponse({"error": str(exc)}, status_code=403)
        except Exception as exc:
            logger.exception("openai_compat run error graph=%s: %s", graph_id, exc)
            return JSONResponse({"error": str(exc)}, status_code=500)

        if not stream:
            resp_body = _build_openai_response(
                run_id, model_str, content, prompt_tokens, completion_tokens
            )
            return JSONResponse(resp_body)

        # Streaming: split content into chunks, emit SSE
        async def _sse_gen() -> AsyncIterator[str]:
            # role chunk
            role_chunk: dict[str, Any] = {
                "id": f"chatcmpl-{run_id}",
                "object": "chat.completion.chunk",
                "created": int(time.time()),
                "model": model_str,
                "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}],
            }
            yield f"data: {json.dumps(role_chunk)}\n\n"

            # content chunks
            text = content
            while text:
                piece = text[:_STREAM_CHUNK_SIZE]
                text = text[_STREAM_CHUNK_SIZE:]
                yield _chunk_event(run_id, model_str, piece)

            # finish chunk
            yield _chunk_event(run_id, model_str, "", finish_reason="stop")
            yield "data: [DONE]\n\n"

        return StreamingResponse(_sse_gen(), media_type="text/event-stream", headers=_SSE_HEADERS)

    async def get_models(request: Request) -> Response:
        auth_h = request.headers.get("Authorization")
        err = _check_auth(auth_h)
        if err is not None:
            return err

        graph_ids = await _list_graph_ids()
        data = [
            {
                "id": f"gc-graph:{gid}",
                "object": "model",
                "created": 0,
                "owned_by": "graphcaster",
            }
            for gid in graph_ids
        ]
        return JSONResponse({"object": "list", "data": data})

    return [
        Route(
            "/api/v1/openai/chat/completions",
            post_chat_completions,
            methods=["POST"],
        ),
        Route(
            "/api/v1/openai/models",
            get_models,
            methods=["GET"],
        ),
    ]
