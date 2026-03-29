# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

import pytest

from graph_caster.cursor_agent_argv import expand_prompt_placeholders
from graph_caster.models import GraphDocument
from graph_caster.runtime_validate import first_runtime_node_blocker


def _fixture_path() -> Path:
    root = Path(__file__).resolve().parents[2]
    return root / "schemas" / "test-fixtures" / "cursor-agent-linear.json"


def test_cursor_agent_linear_fixture_passes_runtime_validate() -> None:
    raw = json.loads(_fixture_path().read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    assert first_runtime_node_blocker(doc) is None


def test_expand_out_placeholder_stdout() -> None:
    ctx_out = {
        "prev": {
            "processResult": {
                "stdout": "hello out",
                "stderr": "",
            }
        }
    }
    s = expand_prompt_placeholders("x {{out:prev.processResult.stdout}} y", ctx_out)
    assert s == "x hello out y"


@pytest.mark.skipif(not __import__("os").environ.get("GC_CURSOR_AGENT"), reason="Set GC_CURSOR_AGENT for live Cursor CLI smoke test")
def test_build_argv_smoke_when_gc_cursor_agent_set(tmp_path: Path) -> None:
    raw = json.loads(_fixture_path().read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    task = next(n for n in doc.nodes if n.type == "task")
    data = task.data
    from graph_caster.cursor_agent_argv import build_argv_and_cwd_for_gc_cursor_agent

    graphs_root = tmp_path / "graphs"
    graphs_root.mkdir(parents=True, exist_ok=True)
    ctx: dict = {
        "_gc_graphs_root": str(graphs_root),
        "root_run_artifact_dir": str(tmp_path / "runs"),
    }
    argv, _cwd = build_argv_and_cwd_for_gc_cursor_agent(data, ctx)
    assert isinstance(argv, list) and len(argv) >= 2
