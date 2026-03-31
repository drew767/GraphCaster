# Copyright Aura. All Rights Reserved.

from __future__ import annotations

from graph_caster.agent.in_runner_exec import PatternDemoLlm, execute_in_runner_agent
from graph_caster.agent.loop import AgentLoop
from graph_caster.agent.tool_executor import ToolExecutor
from graph_caster.models import GraphDocument, Node
from graph_caster.runner import GraphRunner
from graph_caster.validate import find_agent_structure_warnings


def test_agent_loop_tool_then_final() -> None:
    ex = ToolExecutor()

    def echo(args: dict) -> str:
        return str(args.get("message", args))

    ex.register("echo", echo)
    loop = AgentLoop(PatternDemoLlm(), ex, max_iterations=5)
    trace = loop.steps("hello")
    kinds = [k for k, _ in trace]
    assert "tool_call" in kinds
    assert "tool_result" in kinds
    assert trace[-1][0] == "final"
    assert trace[-1][1] == "agent_done"


def test_execute_in_runner_agent_emits_events() -> None:
    events: list[dict] = []

    def emit(etype: str, **kw: object) -> None:
        events.append({"type": etype, **kw})

    node = Node(
        id="a1",
        type="agent",
        position={"x": 0, "y": 0},
        data={"inputText": "test prompt", "title": "Agent"},
    )
    ok, patch = execute_in_runner_agent(
        node=node,
        graph_id="g1",
        ctx={},
        emit=emit,
    )
    assert ok
    types = [e["type"] for e in events]
    assert "agent_delegate_start" in types
    assert "agent_tool_call" in types
    assert "agent_step" in types
    assert "agent_finished" in types
    assert patch["agentResult"]["success"] is True
    assert patch["agentResult"]["text"] == "agent_done"


def test_find_agent_structure_warning_missing_prompt() -> None:
    raw: dict = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "title": "t"},
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "a", "type": "agent", "position": {"x": 0, "y": 0}, "data": {"title": "A"}},
            {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "a",
                "targetHandle": "in_default",
            },
            {
                "id": "e2",
                "source": "a",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
            },
        ],
    }
    doc = GraphDocument.from_dict(raw)
    ws = find_agent_structure_warnings(doc)
    assert any(w.get("kind") == "agent_missing_prompt" for w in ws)


def test_runner_linear_agent_reaches_exit() -> None:
    raw: dict = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "title": "agent run"},
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "ag",
                "type": "agent",
                "position": {"x": 0, "y": 0},
                "data": {"title": "Agent", "inputText": "hello"},
            },
            {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "ag",
                "targetHandle": "in_default",
            },
            {
                "id": "e2",
                "source": "ag",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
            },
        ],
    }
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run()
    types = [e["type"] for e in events]
    assert "agent_tool_call" in types
    assert "run_success" in types
    out = next((e for e in events if e["type"] == "node_exit" and e.get("nodeId") == "ag"), None)
    assert out is not None
