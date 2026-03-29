# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import sys

from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner


def _minimal_llm_agent_doc(agent_py_literal: str) -> GraphDocument:
    """start → llm_agent → exit; agent is inline Python -c script."""
    gid = "test-graph-llm-agent-001"
    raw = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid, "title": "llm_agent test"},
        "nodes": [
            {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "a1",
                "type": "llm_agent",
                "position": {"x": 100, "y": 0},
                "data": {
                    "title": "Agent",
                    "command": [sys.executable, "-c", agent_py_literal],
                    "timeoutSec": 30,
                    "maxAgentSteps": 0,
                },
            },
            {"id": "x1", "type": "exit", "position": {"x": 200, "y": 0}, "data": {"title": "Done"}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "s1",
                "sourceHandle": "out_default",
                "target": "a1",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "e2",
                "source": "a1",
                "sourceHandle": "out_default",
                "target": "x1",
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }
    return GraphDocument.from_dict(raw)


def test_llm_agent_subprocess_happy_path() -> None:
    script = (
        "import json,sys\n"
        "j=json.loads(sys.stdin.readline())\n"
        "sys.stdout.write(json.dumps({'type':'agent_delegate_start'})+'\\n')\n"
        "sys.stdout.write(json.dumps({'type':'agent_step','phase':'llm','message':'ok'})+'\\n')\n"
        "sys.stdout.write(json.dumps({'type':'agent_finished','result':{'node':j.get('nodeId')}})+'\\n')\n"
        "sys.stdout.flush()\n"
    )
    doc = _minimal_llm_agent_doc(script)
    events: list[dict] = []
    ctx: dict = {"last_result": True}
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context=ctx)
    types = [e.get("type") for e in events]
    assert "agent_step" in types
    assert "process_complete" in types
    complete = next(e for e in events if e.get("type") == "process_complete" and e.get("nodeId") == "a1")
    assert complete.get("success") is True
    assert any(e.get("type") == "run_success" for e in events)
    ar = ctx.get("node_outputs", {}).get("a1", {}).get("agentResult")
    assert isinstance(ar, dict) and ar.get("success") is True
    assert ar.get("result") == {"node": "a1"}


def test_llm_agent_missing_command_emits_structure_warning() -> None:
    gid = "test-graph-llm-agent-empty"
    raw = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid, "title": "empty cmd"},
        "nodes": [
            {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "a1",
                "type": "llm_agent",
                "position": {"x": 100, "y": 0},
                "data": {"title": "No argv"},
            },
            {"id": "x1", "type": "exit", "position": {"x": 200, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "s1",
                "sourceHandle": "out_default",
                "target": "a1",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "e2",
                "source": "a1",
                "sourceHandle": "out_default",
                "target": "x1",
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    warns = [e for e in events if e.get("type") == "structure_warning" and e.get("kind") == "llm_agent_empty_command"]
    assert len(warns) == 1
    assert not any(e.get("type") == "run_success" for e in events)
    finished = next(e for e in events if e.get("type") == "run_finished")
    assert finished.get("status") == "failed"
