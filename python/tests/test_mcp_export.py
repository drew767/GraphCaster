# Copyright GraphCaster. All Rights Reserved.

"""Tests for F65: per-graph MCP tools (export-mcp / --per-graph-tools / --watch)."""

from __future__ import annotations

import asyncio
import json
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from graph_caster.host_context import RunHostContext
from graph_caster.mcp_server.per_graph_tools import (
    _sanitize_tool_name,
    derive_input_schema,
    derive_output_schema,
    register_per_graph_tools,
    build_single_graph_fastmcp,
    _WATCH_INTERVAL_SEC,
)
from graph_caster.models import Node


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_GID_1 = "11111111-1111-4111-8111-111111111111"
_GID_2 = "22222222-2222-4222-8222-222222222222"


def _minimal_graph(gid: str, title: str = "Test") -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid, "title": title},
        "nodes": [
            {"id": "s0", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "x0", "type": "exit", "position": {"x": 1, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e0",
                "source": "s0",
                "sourceHandle": "out_default",
                "target": "x0",
                "targetHandle": "in_default",
            }
        ],
    }


def _graph_with_inputs(gid: str, inputs: list[dict]) -> dict[str, Any]:
    doc = _minimal_graph(gid)
    doc["nodes"][0]["data"]["inputs"] = inputs
    return doc


def _graph_with_input_schema(gid: str, schema: dict) -> dict[str, Any]:
    doc = _minimal_graph(gid)
    doc["nodes"][0]["data"]["inputSchema"] = schema
    return doc


def _write_graph(graphs_dir: Path, filename: str, doc: dict) -> None:
    (graphs_dir / filename).write_text(json.dumps(doc, indent=2), encoding="utf-8")


# ---------------------------------------------------------------------------
# Unit tests: schema derivation
# ---------------------------------------------------------------------------


def test_sanitize_tool_name_uuid() -> None:
    name = _sanitize_tool_name("11111111-1111-4111-8111-111111111111")
    assert name.startswith("gc_")
    assert "-" not in name
    assert name == "gc_11111111_1111_4111_8111_111111111111"


def test_sanitize_tool_name_simple() -> None:
    assert _sanitize_tool_name("my-graph") == "gc_my_graph"


def test_derive_input_schema_from_inputs_list() -> None:
    node = Node(
        id="s0",
        type="start",
        position={"x": 0, "y": 0},
        data={
            "inputs": [
                {"name": "topic", "type": "string", "required": True, "description": "The topic"},
                {"name": "count", "type": "integer", "required": False},
            ]
        },
    )
    schema = derive_input_schema(node)
    assert schema["type"] == "object"
    assert "topic" in schema["properties"]
    assert schema["properties"]["topic"]["type"] == "string"
    assert schema["properties"]["topic"]["description"] == "The topic"
    assert "count" in schema["properties"]
    assert schema["properties"]["count"]["type"] == "integer"
    assert schema["required"] == ["topic"]


def test_derive_input_schema_explicit_json_schema() -> None:
    explicit = {
        "type": "object",
        "properties": {"q": {"type": "string"}},
        "required": ["q"],
    }
    node = Node(
        id="s0", type="start", position={"x": 0, "y": 0}, data={"inputSchema": explicit}
    )
    schema = derive_input_schema(node)
    assert schema == explicit


def test_derive_input_schema_default_empty() -> None:
    node = Node(id="s0", type="start", position={"x": 0, "y": 0}, data={})
    schema = derive_input_schema(node)
    assert schema["type"] == "object"
    assert schema["properties"] == {}
    assert "required" not in schema


def test_derive_output_schema_from_outputs_list() -> None:
    node = Node(
        id="x0",
        type="exit",
        position={"x": 1, "y": 0},
        data={"outputs": [{"name": "result", "type": "string"}]},
    )
    schema = derive_output_schema(node)
    assert "result" in schema["properties"]


# ---------------------------------------------------------------------------
# Integration: register_per_graph_tools
# ---------------------------------------------------------------------------


def test_register_per_graph_tools_tool_listed(tmp_path: Path) -> None:
    pytest.importorskip("mcp")
    from mcp.server.fastmcp import FastMCP

    graphs_dir = tmp_path / "graphs"
    graphs_dir.mkdir()
    _write_graph(graphs_dir, "a.json", _graph_with_inputs(
        _GID_1,
        [{"name": "topic", "type": "string", "required": True}],
    ))

    host = RunHostContext(graphs_root=graphs_dir)
    mcp = FastMCP("test")
    register_per_graph_tools(mcp, host, watch=False)

    tools = asyncio.run(mcp.list_tools())
    names = {t.name for t in tools}
    expected = _sanitize_tool_name(_GID_1)
    assert expected in names


def test_register_per_graph_tools_json_schema_correct(tmp_path: Path) -> None:
    pytest.importorskip("mcp")
    from mcp.server.fastmcp import FastMCP

    graphs_dir = tmp_path / "graphs"
    graphs_dir.mkdir()
    _write_graph(graphs_dir, "a.json", _graph_with_inputs(
        _GID_1,
        [{"name": "topic", "type": "string", "required": True, "description": "Topic text"}],
    ))

    host = RunHostContext(graphs_root=graphs_dir)
    mcp = FastMCP("test")
    register_per_graph_tools(mcp, host, watch=False)

    tools = asyncio.run(mcp.list_tools())
    tool = next(t for t in tools if t.name == _sanitize_tool_name(_GID_1))
    schema = tool.inputSchema
    assert "topic" in schema.get("properties", {})
    assert schema["properties"]["topic"]["type"] == "string"
    assert "topic" in (schema.get("required") or [])


def _extract_tool_result(result: Any) -> dict[str, Any]:
    """Normalize FastMCP call_tool() result to a plain dict.

    When invoked directly (not via the MCP protocol wire), FastMCP may return
    the raw dict from the handler (for our _PerGraphTool subclass that bypasses
    convert_result).  When invoked through the protocol it returns a sequence of
    ContentBlock objects.  This helper normalises both.
    """
    if isinstance(result, dict):
        return result
    if isinstance(result, (list, tuple)) and result:
        item = result[0]
        if hasattr(item, "text"):
            return json.loads(item.text)
    return {"ok": False, "error": f"unexpected result type: {type(result)}"}


def test_tool_call_triggers_run_and_returns_output(tmp_path: Path) -> None:
    """Calling the per-graph tool with valid inputs runs the graph and returns ok:true."""
    pytest.importorskip("mcp")
    from mcp.server.fastmcp import FastMCP

    graphs_dir = tmp_path / "graphs"
    graphs_dir.mkdir()
    doc = _graph_with_inputs(_GID_1, [{"name": "topic", "type": "string", "required": True}])
    _write_graph(graphs_dir, "a.json", doc)

    host = RunHostContext(graphs_root=graphs_dir)
    mcp = FastMCP("test")
    register_per_graph_tools(mcp, host, watch=False)

    tool_name = _sanitize_tool_name(_GID_1)
    tools = asyncio.run(mcp.list_tools())
    assert any(t.name == tool_name for t in tools)

    result = _extract_tool_result(asyncio.run(mcp.call_tool(tool_name, {"topic": "AI"})))
    assert result["ok"] is True
    assert result["status"] == "success"
    assert "runId" in result


def test_missing_required_input_returns_validation_error(tmp_path: Path) -> None:
    """Calling a tool without a required input should return an error, not crash."""
    pytest.importorskip("mcp")
    from mcp.server.fastmcp import FastMCP

    graphs_dir = tmp_path / "graphs"
    graphs_dir.mkdir()
    doc = _graph_with_inputs(_GID_1, [{"name": "topic", "type": "string", "required": True}])
    _write_graph(graphs_dir, "a.json", doc)

    host = RunHostContext(graphs_root=graphs_dir)
    mcp = FastMCP("test")
    register_per_graph_tools(mcp, host, watch=False)

    tool_name = _sanitize_tool_name(_GID_1)
    result = _extract_tool_result(asyncio.run(mcp.call_tool(tool_name, {})))
    assert result["ok"] is False
    assert "validationErrors" in result


def test_hot_reload_discovers_new_graph(tmp_path: Path) -> None:
    """Adding a graph file triggers re-registration of a new tool within poll interval."""
    pytest.importorskip("mcp")
    from mcp.server.fastmcp import FastMCP

    graphs_dir = tmp_path / "graphs"
    graphs_dir.mkdir()
    _write_graph(graphs_dir, "a.json", _minimal_graph(_GID_1, "First"))

    host = RunHostContext(graphs_root=graphs_dir)
    mcp = FastMCP("test")
    register_per_graph_tools(mcp, host, watch=True)

    tool1 = _sanitize_tool_name(_GID_1)
    tool2 = _sanitize_tool_name(_GID_2)

    initial_tools = {t.name for t in asyncio.run(mcp.list_tools())}
    assert tool1 in initial_tools
    assert tool2 not in initial_tools

    time.sleep(0.05)
    _write_graph(graphs_dir, "b.json", _minimal_graph(_GID_2, "Second"))
    Path(graphs_dir / "b.json").touch()

    deadline = time.monotonic() + _WATCH_INTERVAL_SEC * 2 + 1
    while time.monotonic() < deadline:
        names = {t.name for t in asyncio.run(mcp.list_tools())}
        if tool2 in names:
            break
        time.sleep(0.2)
    else:
        pytest.fail(f"tool {tool2!r} not registered after hot-reload wait")


# ---------------------------------------------------------------------------
# build_single_graph_fastmcp
# ---------------------------------------------------------------------------


def test_export_mcp_single_graph_tool(tmp_path: Path) -> None:
    pytest.importorskip("mcp")

    graphs_dir = tmp_path / "graphs"
    graphs_dir.mkdir()
    _write_graph(graphs_dir, "a.json", _minimal_graph(_GID_1, "MyGraph"))

    host = RunHostContext(graphs_root=graphs_dir)
    app = build_single_graph_fastmcp(host, _GID_1)

    tools = asyncio.run(app.list_tools())
    names = [t.name for t in tools]
    assert names == [_sanitize_tool_name(_GID_1)]


def test_export_mcp_unknown_graph_raises(tmp_path: Path) -> None:
    pytest.importorskip("mcp")

    graphs_dir = tmp_path / "graphs"
    graphs_dir.mkdir()

    host = RunHostContext(graphs_root=graphs_dir)
    with pytest.raises(ValueError, match="not found"):
        build_single_graph_fastmcp(host, "no-such-graph")


def test_export_mcp_only_one_tool(tmp_path: Path) -> None:
    """export-mcp exposes exactly one tool, even if more graphs exist."""
    pytest.importorskip("mcp")

    graphs_dir = tmp_path / "graphs"
    graphs_dir.mkdir()
    _write_graph(graphs_dir, "a.json", _minimal_graph(_GID_1, "A"))
    _write_graph(graphs_dir, "b.json", _minimal_graph(_GID_2, "B"))

    host = RunHostContext(graphs_root=graphs_dir)
    app = build_single_graph_fastmcp(host, _GID_1)

    tools = asyncio.run(app.list_tools())
    assert len(tools) == 1
    assert tools[0].name == _sanitize_tool_name(_GID_1)


# ---------------------------------------------------------------------------
# build_fastmcp integration: --per-graph-tools adds extra tools
# ---------------------------------------------------------------------------


def test_build_fastmcp_per_graph_tools_extends_base(tmp_path: Path) -> None:
    pytest.importorskip("mcp")
    from graph_caster.mcp_server.server import build_fastmcp

    graphs_dir = tmp_path / "graphs"
    graphs_dir.mkdir()
    _write_graph(graphs_dir, "a.json", _minimal_graph(_GID_1, "A"))

    host = RunHostContext(graphs_root=graphs_dir)
    app = build_fastmcp(host, per_graph_tools=True, watch=False)

    tools = {t.name for t in asyncio.run(app.list_tools())}
    assert "graphcaster_list_graphs" in tools
    assert "graphcaster_run_graph" in tools
    assert "graphcaster_cancel_run" in tools
    assert _sanitize_tool_name(_GID_1) in tools


def test_build_fastmcp_no_per_graph_tools_baseline(tmp_path: Path) -> None:
    pytest.importorskip("mcp")
    from graph_caster.mcp_server.server import build_fastmcp

    graphs_dir = tmp_path / "graphs"
    graphs_dir.mkdir()
    _write_graph(graphs_dir, "a.json", _minimal_graph(_GID_1, "A"))

    host = RunHostContext(graphs_root=graphs_dir)
    app = build_fastmcp(host, per_graph_tools=False)

    tools = {t.name for t in asyncio.run(app.list_tools())}
    assert tools == {"graphcaster_list_graphs", "graphcaster_run_graph", "graphcaster_cancel_run"}
