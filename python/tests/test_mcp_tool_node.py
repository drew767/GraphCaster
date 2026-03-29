# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

from graph_caster.host_context import RunHostContext
from graph_caster.mcp_client.client import McpToolCallOutcome
from graph_caster.models import GraphDocument
from graph_caster.node_output_cache import StepCachePolicy
from graph_caster.runner import GraphRunner
import graph_caster.runner.node_visits as node_visits_impl
from graph_caster.validate import find_mcp_tool_structure_warnings, find_unreachable_out_error_sources

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]
FIXTURE = GRAPH_CASTER_ROOT / "schemas" / "test-fixtures" / "mcp-tool-linear.json"


def _load_fixture() -> GraphDocument:
    return GraphDocument.from_dict(json.loads(FIXTURE.read_text(encoding="utf-8")))


def test_mcp_tool_step_cache_second_run_hit(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["nodes"][1]["data"]["stepCache"] = True
    doc = GraphDocument.from_dict(raw)
    calls: list[int] = []

    def _fake_run_mcp_tool_call(**_kwargs: object) -> McpToolCallOutcome:
        calls.append(1)
        return McpToolCallOutcome(ok=True, result={"cached_test": True}, error=None, code=None)

    monkeypatch.setattr(node_visits_impl, "run_mcp_tool_call", _fake_run_mcp_tool_call)
    pol = StepCachePolicy(enabled=True, dirty_nodes=frozenset())
    host = RunHostContext(artifacts_base=tmp_path)
    ev1: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev1.append(e), host=host, step_cache=pol).run(
        context={"last_result": True},
    )
    assert len(calls) == 1
    assert any(e.get("type") == "mcp_tool_invoke" for e in ev1)
    assert not any(e.get("type") == "node_cache_hit" for e in ev1)

    ev2: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev2.append(e), host=host, step_cache=pol).run(
        context={"last_result": True},
    )
    assert len(calls) == 1
    assert not any(e.get("type") == "mcp_tool_invoke" for e in ev2)
    hits = [e for e in ev2 if e.get("type") == "node_cache_hit"]
    assert len(hits) == 1
    res_ev = [e for e in ev2 if e.get("type") == "mcp_tool_result"]
    assert len(res_ev) == 1
    assert res_ev[0].get("fromStepCache") is True


def test_mcp_tool_step_cache_disabled_when_provider_override(tmp_path: Path) -> None:
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["nodes"][1]["data"]["stepCache"] = True
    doc = GraphDocument.from_dict(raw)

    def _prov(_payload: dict) -> dict:
        return {"ok": True, "result": {"p": True}}

    pol = StepCachePolicy(enabled=True, dirty_nodes=frozenset())
    host = RunHostContext(artifacts_base=tmp_path)
    ev1: list[dict] = []
    ev2: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev1.append(e), host=host, step_cache=pol).run(
        context={"last_result": True, "mcp_tool_provider": _prov},
    )
    GraphRunner(doc, sink=lambda e: ev2.append(e), host=host, step_cache=pol).run(
        context={"last_result": True, "mcp_tool_provider": _prov},
    )
    assert sum(1 for e in ev1 if e.get("type") == "mcp_tool_invoke") == 1
    assert sum(1 for e in ev2 if e.get("type") == "mcp_tool_invoke") == 1
    assert not any(e.get("type") == "node_cache_hit" for e in ev1)
    assert not any(e.get("type") == "node_cache_hit" for e in ev2)


def test_mcp_tool_step_cache_dirty_then_repopulate_hit(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["nodes"][1]["data"]["stepCache"] = True
    doc = GraphDocument.from_dict(raw)
    calls: list[int] = []

    def _fake_run_mcp_tool_call(**_kwargs: object) -> McpToolCallOutcome:
        calls.append(1)
        return McpToolCallOutcome(ok=True, result={"n": len(calls)}, error=None, code=None)

    monkeypatch.setattr(node_visits_impl, "run_mcp_tool_call", _fake_run_mcp_tool_call)
    host = RunHostContext(artifacts_base=tmp_path)
    pol_clean = StepCachePolicy(enabled=True, dirty_nodes=frozenset())
    GraphRunner(doc, sink=lambda _e: None, host=host, step_cache=pol_clean).run(
        context={"last_result": True},
    )
    assert len(calls) == 1

    pol_dirty = StepCachePolicy(enabled=True, dirty_nodes=frozenset({"m1"}))
    ev_dirty: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev_dirty.append(e), host=host, step_cache=pol_dirty).run(
        context={"last_result": True},
    )
    assert len(calls) == 2
    assert any(
        e.get("type") == "node_cache_miss" and e.get("reason") == "dirty" for e in ev_dirty
    )

    ev_hit: list[dict] = []
    GraphRunner(doc, sink=lambda e: ev_hit.append(e), host=host, step_cache=pol_clean).run(
        context={"last_result": True},
    )
    assert len(calls) == 2
    assert any(e.get("type") == "node_cache_hit" for e in ev_hit)
    assert not any(e.get("type") == "mcp_tool_invoke" for e in ev_hit)


def test_mcp_tool_step_cache_arguments_change_misses(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["nodes"][1]["data"]["stepCache"] = True
    doc_a = GraphDocument.from_dict(raw)
    raw_b = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw_b["nodes"][1]["data"]["stepCache"] = True
    raw_b["nodes"][1]["data"]["arguments"] = {"msg": "other"}
    doc_b = GraphDocument.from_dict(raw_b)

    def _fake_run_mcp_tool_call(**_kwargs: object) -> McpToolCallOutcome:
        return McpToolCallOutcome(ok=True, result={"ok": True}, error=None, code=None)

    monkeypatch.setattr(node_visits_impl, "run_mcp_tool_call", _fake_run_mcp_tool_call)
    pol = StepCachePolicy(enabled=True, dirty_nodes=frozenset())
    host = RunHostContext(artifacts_base=tmp_path)
    GraphRunner(doc_a, sink=lambda _e: None, host=host, step_cache=pol).run(context={"last_result": True})
    ev: list[dict] = []
    GraphRunner(doc_b, sink=lambda e: ev.append(e), host=host, step_cache=pol).run(context={"last_result": True})
    assert any(e.get("type") == "mcp_tool_invoke" for e in ev)
    assert not any(e.get("type") == "node_cache_hit" for e in ev)


def test_mcp_tool_provider_success() -> None:
    doc = _load_fixture()

    def _prov(payload: dict) -> dict:
        assert payload["toolName"] == "echo"
        assert payload["nodeId"] == "m1"
        return {"ok": True, "result": {"echoed": True}}

    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(
        context={"last_result": True, "mcp_tool_provider": _prov}
    )
    types = [e["type"] for e in events]
    assert "mcp_tool_invoke" in types
    assert "mcp_tool_result" in types
    assert "run_success" in types


def test_mcp_tool_provider_failure_out_error() -> None:
    doc = _load_fixture()
    # Add error edge from m1 to exit via out_error — need a second target; use duplicate exit pattern: add task node as error sink
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["nodes"].append(
        {"id": "err1", "type": "exit", "position": {"x": 400, "y": 100}, "data": {"title": "Err exit"}}
    )
    raw["edges"].append(
        {
            "id": "e_err",
            "source": "m1",
            "sourceHandle": "out_error",
            "target": "err1",
            "targetHandle": "in_default",
            "condition": None,
        }
    )
    doc2 = GraphDocument.from_dict(raw)

    def _prov(_payload: dict) -> dict:
        return {"ok": False, "error": "boom", "code": "test"}

    events: list[dict] = []
    GraphRunner(doc2, sink=lambda e: events.append(e)).run(
        context={"last_result": True, "mcp_tool_provider": _prov}
    )
    assert any(e["type"] == "mcp_tool_failed" for e in events)
    traversals = [e for e in events if e["type"] == "edge_traverse" and e.get("route") == "error"]
    assert traversals, "expected error-route edge after mcp failure"


def test_find_mcp_tool_structure_warnings() -> None:
    doc = _load_fixture()
    assert find_mcp_tool_structure_warnings(doc) == []
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["nodes"][1]["data"]["toolName"] = ""
    doc_bad = GraphDocument.from_dict(raw)
    kinds = {w["kind"] for w in find_mcp_tool_structure_warnings(doc_bad)}
    assert "mcp_tool_empty_tool_name" in kinds


def test_mcp_tool_emits_out_error_allowed() -> None:
    raw = json.loads(FIXTURE.read_text(encoding="utf-8"))
    raw["edges"].append(
        {
            "id": "e_err",
            "source": "m1",
            "sourceHandle": "out_error",
            "target": "x1",
            "targetHandle": "in_default",
            "condition": None,
        }
    )
    doc = GraphDocument.from_dict(raw)
    assert "m1" not in find_unreachable_out_error_sources(doc)


@pytest.mark.skipif(
    os.environ.get("GC_MCP_INTEGRATION", "").strip().lower() not in ("1", "true", "yes", "on"),
    reason="set GC_MCP_INTEGRATION=1 to run stdio e2e (requires pip install -e '.[mcp]')",
)
def test_mcp_tool_stdio_fastmcp_smoke(tmp_path: Path) -> None:
    pytest.importorskip("mcp.server.fastmcp")
    srv = tmp_path / "srv.py"
    srv.write_text(
        """
from mcp.server.fastmcp import FastMCP
mcp = FastMCP("t")
@mcp.tool()
def ping() -> str:
    return "pong"
if __name__ == "__main__":
    mcp.run(transport="stdio")
""",
        encoding="utf-8",
    )
    raw = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": "g-mcp-smoke", "title": "smoke"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "m1",
                "type": "mcp_tool",
                "position": {"x": 0, "y": 0},
                "data": {
                    "transport": "stdio",
                    "toolName": "ping",
                    "arguments": {},
                    "timeoutSec": 30,
                    "argv": [sys.executable, str(srv)],
                },
            },
            {"id": "x1", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "s1",
                "sourceHandle": "out_default",
                "target": "m1",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "e2",
                "source": "m1",
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
    assert any(e["type"] == "mcp_tool_result" for e in events), events
