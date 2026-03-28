# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

import pytest

from graph_caster.cursor_agent_argv import (
    CursorAgentPresetError,
    build_argv_and_cwd_for_gc_cursor_agent,
    expand_prompt_placeholders,
    resolve_agent_executable,
    resolve_cwd_base,
    resolve_workspace_root_from_graphs_root,
    validate_gc_cursor_agent_errors,
)
from graph_caster.models import GraphDocument
from graph_caster.process_exec import run_task_process
from graph_caster.runner import GraphRunner


def _fake_agent_path(tmp_path: Path) -> Path:
    if os.name == "nt":
        p = tmp_path / "agent.cmd"
        p.write_text("@exit /b 0\r\n", encoding="utf-8")
    else:
        p = tmp_path / "agent"
        p.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        p.chmod(0o755)
    return p


def test_resolve_workspace_root_graphs_named(tmp_path: Path) -> None:
    base = tmp_path / "graphs"
    base.mkdir()
    assert resolve_workspace_root_from_graphs_root(base) == tmp_path.resolve()


def test_resolve_workspace_root_other_name(tmp_path: Path) -> None:
    base = tmp_path / "mygraphs"
    base.mkdir()
    assert resolve_workspace_root_from_graphs_root(base) == base.resolve()


def test_validate_errors_empty_prompt() -> None:
    d = {"gcCursorAgent": {"presetVersion": 1}}
    assert validate_gc_cursor_agent_errors(d)


def test_validate_ok_minimal() -> None:
    d = {"gcCursorAgent": {"presetVersion": 1, "prompt": "hello"}}
    assert validate_gc_cursor_agent_errors(d) == []


def test_expand_placeholders() -> None:
    outs = {
        "n1": {
            "processResult": {"stdout": "OUT", "stderr": "ERR"},
        }
    }
    s = expand_prompt_placeholders("x {{out:n1.processResult.stdout}} y", outs)
    assert s == "x OUT y"


def test_build_argv_and_cwd(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = _fake_agent_path(tmp_path)
    monkeypatch.setenv("GC_CURSOR_AGENT", str(fake))
    graphs = tmp_path / "graphs"
    graphs.mkdir()
    ctx = {
        "_gc_graphs_root": str(graphs),
        "root_run_artifact_dir": str(tmp_path / "runs" / "a"),
    }
    data = {
        "gcCursorAgent": {
            "presetVersion": 1,
            "prompt": "do work",
            "cwdBase": "workspace_root",
            "printMode": True,
            "applyFileChanges": False,
        }
    }
    argv, cwd = build_argv_and_cwd_for_gc_cursor_agent(data, ctx)
    assert argv[0] == str(fake.resolve())
    assert "-p" in argv
    assert argv[-1] == "do work"
    assert cwd == tmp_path.resolve()


def test_build_argv_prompt_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = _fake_agent_path(tmp_path)
    monkeypatch.setenv("GC_CURSOR_AGENT", str(fake))
    graphs = tmp_path / "graphs"
    graphs.mkdir()
    (graphs / "p.txt").write_text("from file", encoding="utf-8")
    ctx = {"_gc_graphs_root": str(graphs)}
    data = {
        "gcCursorAgent": {
            "presetVersion": 1,
            "promptFile": "p.txt",
            "cwdBase": "graphs_root",
        }
    }
    argv, _cwd = build_argv_and_cwd_for_gc_cursor_agent(data, ctx)
    assert argv[-1] == "from file"


def test_resolve_agent_executable_missing(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("GC_CURSOR_AGENT", raising=False)
    if os.name == "nt":
        monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    with patch("shutil.which", return_value=None):
        with pytest.raises(CursorAgentPresetError, match="not found"):
            resolve_agent_executable()


def test_run_task_process_empty_gc_cursor_agent_spawn_error() -> None:
    captured: list[tuple[str, dict]] = []

    def emit(name: str, **kwargs: object) -> None:
        captured.append((name, dict(kwargs)))

    ctx: dict = {"node_outputs": {}}
    ok = run_task_process(
        node_id="t1",
        graph_id="g1",
        data={"gcCursorAgent": {}},
        ctx=ctx,
        emit=emit,
        should_cancel=None,
    )
    assert ok is False
    fails = [kw for n, kw in captured if n == "process_failed"]
    assert fails
    assert fails[0].get("reason") == "spawn_error"
    assert "prompt" in str(fails[0].get("message", "")).lower()


def test_run_task_process_gc_cursor_agent_not_object() -> None:
    captured: list[tuple[str, dict]] = []

    def emit(name: str, **kwargs: object) -> None:
        captured.append((name, dict(kwargs)))

    ok = run_task_process(
        node_id="t1",
        graph_id="g1",
        data={"gcCursorAgent": "bad"},
        ctx={"node_outputs": {}},
        emit=emit,
        should_cancel=None,
    )
    assert ok is False
    fails = [kw for n, kw in captured if n == "process_failed"]
    assert fails and fails[0].get("reason") == "spawn_error"
    assert "object" in str(fails[0].get("message", "")).lower()


def _fake_agent_prints(tmp_path: Path, line: str) -> Path:
    if os.name == "nt":
        p = tmp_path / "agent.cmd"
        p.write_text(f"@echo off\necho {line}\nexit /b 0\r\n", encoding="utf-8")
    else:
        p = tmp_path / "agent"
        p.write_text(f"#!/bin/sh\necho {line}\nexit 0\n", encoding="utf-8")
        p.chmod(0o755)
    return p


def test_run_task_process_stores_truncated_stdout_in_node_outputs(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake = _fake_agent_prints(tmp_path, "HELLO_OUT")
    monkeypatch.setenv("GC_CURSOR_AGENT", str(fake))
    graphs = tmp_path / "graphs"
    graphs.mkdir()
    ctx: dict = {
        "_gc_graphs_root": str(graphs),
        "root_run_artifact_dir": str(tmp_path / "art"),
        "node_outputs": {},
    }

    def emit(_name: str, **_kwargs: object) -> None:
        pass

    ok = run_task_process(
        node_id="t1",
        graph_id="g1",
        data={
            "gcCursorAgent": {
                "presetVersion": 1,
                "prompt": "x",
                "cwdBase": "workspace_root",
                "printMode": True,
            },
            "successMode": "exit_code",
        },
        ctx=ctx,
        emit=emit,
        should_cancel=None,
    )
    assert ok is True
    pr = ctx["node_outputs"]["t1"]["processResult"]
    assert "HELLO_OUT" in str(pr.get("stdout", ""))


def test_run_task_process_preset_spawn_records_argv(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake = _fake_agent_path(tmp_path)
    monkeypatch.setenv("GC_CURSOR_AGENT", str(fake))
    graphs = tmp_path / "graphs"
    graphs.mkdir()
    captured: list[dict] = []

    def emit(name: str, **kwargs: object) -> None:
        if name == "process_spawn":
            captured.append(dict(kwargs))

    ctx = {
        "_gc_graphs_root": str(graphs),
        "root_run_artifact_dir": str(tmp_path / "art"),
        "node_outputs": {},
    }
    ok = run_task_process(
        node_id="t1",
        graph_id="g1",
        data={
            "gcCursorAgent": {
                "presetVersion": 1,
                "prompt": "hi",
                "cwdBase": "artifact_dir",
                "printMode": True,
            },
            "successMode": "exit_code",
        },
        ctx=ctx,
        emit=emit,
        should_cancel=None,
    )
    assert ok is True
    assert len(captured) == 1
    assert captured[0]["argv"][-1] == "hi"


def test_runner_end_to_end_cursor_preset(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    fake = _fake_agent_path(tmp_path)
    monkeypatch.setenv("GC_CURSOR_AGENT", str(fake))
    graphs = tmp_path / "graphs"
    graphs.mkdir()
    raw = {
        "schemaVersion": 1,
        "meta": {"graphId": "11111111-1111-4111-8111-111111111111", "title": "t"},
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "a",
                "type": "task",
                "position": {"x": 0, "y": 0},
                "data": {
                    "gcCursorAgent": {"presetVersion": 1, "prompt": "x", "printMode": True},
                    "successMode": "exit_code",
                },
            },
            {"id": "e", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "s",
                "target": "a",
                "sourceHandle": "out_default",
                "targetHandle": "in_default",
            },
            {
                "id": "e2",
                "source": "a",
                "target": "e",
                "sourceHandle": "out_default",
                "targetHandle": "in_default",
            },
        ],
    }
    doc = GraphDocument.from_dict(raw)
    events: list[tuple[str, dict]] = []

    def sink(ev: dict) -> None:
        t = ev.get("type")
        if isinstance(t, str):
            d = {k: v for k, v in ev.items() if k != "type"}
            events.append((t, d))

    runner = GraphRunner(doc, sink, graphs_root=graphs)
    runner.run()
    types = [x[0] for x in events]
    assert "run_success" in types
    assert any(t == "process_spawn" for t, _ in events)


def test_runner_empty_gc_cursor_agent_emits_failure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("GC_CURSOR_AGENT", raising=False)
    if os.name == "nt":
        monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    with patch("shutil.which", return_value=None):
        graphs = tmp_path / "graphs"
        graphs.mkdir()
        raw = {
            "schemaVersion": 1,
            "meta": {"graphId": "33333333-3333-4333-8333-333333333333", "title": "t"},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "a",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {"gcCursorAgent": {}},
                },
                {"id": "e", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "s",
                    "target": "a",
                    "sourceHandle": "out_default",
                    "targetHandle": "in_default",
                },
                {
                    "id": "e2",
                    "source": "a",
                    "target": "e",
                    "sourceHandle": "out_default",
                    "targetHandle": "in_default",
                },
            ],
        }
        doc = GraphDocument.from_dict(raw)
        events: list[tuple[str, dict]] = []

        def sink(ev: dict) -> None:
            t = ev.get("type")
            if isinstance(t, str):
                events.append((t, {k: v for k, v in ev.items() if k != "type"}))

        GraphRunner(doc, sink, graphs_root=graphs).run()
        types = [x[0] for x in events]
        assert "run_success" not in types
        assert any(t == "process_failed" for t in types)
        finished = [d for t, d in events if t == "run_finished"]
        assert finished and finished[0].get("status") == "failed"


def test_resolve_cwd_base_artifact(tmp_path: Path) -> None:
    gr = tmp_path / "graphs"
    art = tmp_path / "runs" / "x"
    art.mkdir(parents=True)
    p = resolve_cwd_base("artifact_dir", graphs_root=gr, artifact_dir=art)
    assert p == art.resolve()

