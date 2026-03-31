# Copyright Aura. All Rights Reserved.

from __future__ import annotations

from typing import Any, Callable

from graph_caster.agent.loop import AgentLoop, InRunnerLlm, LlmTextResult, LlmToolCall
from graph_caster.agent.tool_executor import ToolExecutor
from graph_caster.models import Node


def _user_message_from_node_data(data: dict[str, Any]) -> str:
    d = data or {}
    for key in ("inputText", "input", "prompt", "userMessage"):
        v = d.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


def _max_iterations(data: dict[str, Any]) -> int:
    raw = data.get("maxIterations", data.get("max_iterations", 10))
    try:
        n = int(raw)
        return max(1, min(50, n))
    except (TypeError, ValueError):
        return 10


def _default_echo_tools() -> ToolExecutor:
    ex = ToolExecutor()

    def echo(args: dict[str, Any]) -> str:
        return str(args.get("message", args))

    ex.register("echo", echo)
    return ex


class PatternDemoLlm(InRunnerLlm):
    """Deterministic LLM for demos/tests: one tool call then final answer."""

    def complete(
        self,
        messages: list[dict[str, Any]],
        *,
        tools: list[dict[str, Any]] | None,
    ) -> LlmToolCall | LlmTextResult:
        user_msgs = [m for m in messages if m.get("role") == "user"]
        tool_rounds = sum(1 for m in messages if m.get("role") == "tool")
        if tools and tool_rounds == 0 and user_msgs:
            last = str(user_msgs[-1].get("content") or "")
            return LlmToolCall("echo", {"message": last})
        return LlmTextResult("agent_done")


def execute_in_runner_agent(
    *,
    node: Node,
    graph_id: str,
    ctx: dict[str, Any],
    emit: Callable[..., None],
    llm: InRunnerLlm | None = None,
    tools: ToolExecutor | None = None,
) -> tuple[bool, dict[str, Any]]:
    """Run in-process agent loop; emit ``agent_tool_call`` / structured steps."""
    data = dict(node.data or {})
    msg = _user_message_from_node_data(data)
    if not msg:
        emit(
            "agent_failed",
            nodeId=node.id,
            graphId=graph_id,
            message="missing inputText/input/prompt/userMessage",
        )
        return False, {"agentResult": {"success": False, "error": "missing_prompt"}}

    system_prompt = data.get("systemPrompt") if isinstance(data.get("systemPrompt"), str) else None
    if system_prompt is not None and not str(system_prompt).strip():
        system_prompt = None

    executor = tools or _default_echo_tools()
    loop_llm = llm
    if loop_llm is None:
        factory = ctx.get("in_runner_llm_factory")
        if callable(factory):
            loop_llm = factory(ctx, data)
        else:
            loop_llm = PatternDemoLlm()

    loop = AgentLoop(loop_llm, executor, max_iterations=_max_iterations(data))
    emit(
        "agent_delegate_start",
        nodeId=node.id,
        graphId=graph_id,
        message="in_runner_agent",
    )
    trace: list[dict[str, Any]] = []
    step_i = 0
    try:
        for kind, payload in loop.steps(msg, system_prompt=system_prompt):
            if kind == "tool_call":
                assert isinstance(payload, LlmToolCall)
                emit(
                    "agent_tool_call",
                    nodeId=node.id,
                    graphId=graph_id,
                    toolName=payload.name,
                    arguments=payload.arguments,
                )
                trace.append({"step": "tool_call", "name": payload.name, "arguments": payload.arguments})
            elif kind == "tool_result":
                step_i += 1
                emit(
                    "agent_step",
                    nodeId=node.id,
                    graphId=graph_id,
                    step=step_i,
                    phase="tool_result",
                    message=str(payload)[:8000],
                )
                trace.append({"step": "tool_result", "observation": str(payload)[:8000]})
            else:
                emit(
                    "agent_finished",
                    nodeId=node.id,
                    graphId=graph_id,
                    result={"text": str(payload)[:8000]},
                )
                trace.append({"step": "final", "text": str(payload)})
    except Exception as e:  # noqa: BLE001
        emit(
            "agent_failed",
            nodeId=node.id,
            graphId=graph_id,
            message=str(e),
        )
        return False, {"agentResult": {"success": False, "error": str(e), "trace": trace}}

    final_text = ""
    for step in reversed(trace):
        if step.get("step") == "final":
            final_text = str(step.get("text") or "")
            break

    return True, {
        "agentResult": {"success": True, "text": final_text, "trace": trace},
    }
