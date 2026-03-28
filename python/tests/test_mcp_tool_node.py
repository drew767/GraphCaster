# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pytest

from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner
from graph_caster.validate import find_mcp_tool_structure_warnings, find_unreachable_out_error_sources

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]
FIXTURE = GRAPH_CASTER_ROOT / "schemas" / "test-fixtures" / "mcp-tool-linear.json"


def _load_fixture() -> GraphDocument:
    return GraphDocument.from_dict(json.loads(FIXTURE.read_text(encoding="utf-8")))


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
