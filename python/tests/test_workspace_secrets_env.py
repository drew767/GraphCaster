# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import sys
from pathlib import Path

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner
from graph_caster.process_exec import _parse_env_keys_list
from graph_caster.secrets_loader import (
    load_workspace_secrets,
    parse_dotenv_lines,
    secrets_file_fingerprint,
)


def _linear_doc(graph_id: str, *, task_data: dict, start: str = "s1", task: str = "t1", exit_id: str = "x1") -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": "ws"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": start, "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": task, "type": "task", "position": {"x": 0, "y": 0}, "data": task_data},
            {"id": exit_id, "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": start,
                "sourceHandle": "out_default",
                "target": task,
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "e2",
                "source": task,
                "sourceHandle": "out_default",
                "target": exit_id,
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }


def test_parse_env_keys_list_skips_invalid_names() -> None:
    assert _parse_env_keys_list(["OK", "bad-hyphen", "", "2bad", "Also_OK"]) == ["OK", "Also_OK"]


def test_secrets_file_fingerprint_no_workspace_and_no_file(tmp_path: Path) -> None:
    assert secrets_file_fingerprint(None) == "no_workspace"
    assert secrets_file_fingerprint(tmp_path) == "no_file"


def test_secrets_file_fingerprint_content_hash(tmp_path: Path) -> None:
    (tmp_path / ".graphcaster").mkdir()
    p = tmp_path / ".graphcaster" / "workspace.secrets.env"
    p.write_text("A=1\n", encoding="utf-8")
    h1 = secrets_file_fingerprint(tmp_path)
    p.write_text("A=2\n", encoding="utf-8")
    h2 = secrets_file_fingerprint(tmp_path)
    assert len(h1) == 64
    assert h1 != h2


def test_parse_dotenv_lines_comments_empty_quotes() -> None:
    text = "# head\n\nFOO=bar\nEMPTY=\nQ=\"x\"\n"
    d = parse_dotenv_lines(text)
    assert d["FOO"] == "bar"
    assert d["EMPTY"] == ""
    assert d["Q"] == "x"


def test_load_workspace_secrets_missing_file(tmp_path: Path) -> None:
    assert load_workspace_secrets(tmp_path) == {}


def test_task_env_keys_from_workspace_secrets_file(tmp_path: Path) -> None:
    workspace = tmp_path
    (workspace / ".graphcaster").mkdir(parents=True)
    (workspace / ".graphcaster" / "workspace.secrets.env").write_text(
        "MY_SECRET=hello_workspace\n",
        encoding="utf-8",
    )
    (workspace / "expected_secret.txt").write_text("hello_workspace", encoding="utf-8")
    graphs = workspace / "graphs"
    graphs.mkdir()
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    doc = GraphDocument.from_dict(
        _linear_doc(
            gid,
            task_data={
                "command": [
                    sys.executable,
                    "-c",
                    "import os, pathlib, sys; "
                    "exp = pathlib.Path('expected_secret.txt').read_text(encoding='utf-8').strip(); "
                    "sys.exit(0 if os.environ.get('MY_SECRET') == exp else 1)",
                ],
                "cwd": str(workspace),
                "envKeys": ["MY_SECRET"],
            },
        )
    )
    events: list[dict] = []
    GraphRunner(
        doc,
        sink=lambda e: events.append(e),
        host=RunHostContext(graphs_root=graphs),
    ).run(context={"last_result": True})
    assert events[-1].get("status") == "success"
    assert not any("hello_workspace" in json.dumps(e, default=str) for e in events)


def test_task_data_env_overrides_workspace_for_env_keys(tmp_path: Path) -> None:
    workspace = tmp_path
    (workspace / ".graphcaster").mkdir(parents=True)
    (workspace / ".graphcaster" / "workspace.secrets.env").write_text(
        "MY_SECRET=from_file\n",
        encoding="utf-8",
    )
    graphs = workspace / "graphs"
    graphs.mkdir()
    gid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    doc = GraphDocument.from_dict(
        _linear_doc(
            gid,
            task_data={
                "command": [
                    sys.executable,
                    "-c",
                    "import os, sys; sys.exit(0 if os.environ.get('MY_SECRET') == 'from_json' else 1)",
                ],
                "cwd": str(tmp_path),
                "envKeys": ["MY_SECRET"],
                "env": {"MY_SECRET": "from_json"},
            },
        )
    )
    events: list[dict] = []
    GraphRunner(
        doc,
        sink=lambda e: events.append(e),
        host=RunHostContext(graphs_root=graphs),
    ).run(context={"last_result": True})
    assert events[-1].get("status") == "success"


def test_node_execute_redacts_env_values_for_env_keys(tmp_path: Path) -> None:
    workspace = tmp_path
    (workspace / ".graphcaster").mkdir(parents=True)
    (workspace / ".graphcaster" / "workspace.secrets.env").write_text("MY_SECRET=x\n", encoding="utf-8")
    graphs = workspace / "graphs"
    graphs.mkdir()
    gid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    doc = GraphDocument.from_dict(
        _linear_doc(
            gid,
            task_data={
                "command": [sys.executable, "-c", "raise SystemExit(0)"],
                "cwd": str(tmp_path),
                "envKeys": ["MY_SECRET"],
                "env": {"MY_SECRET": "super_secret_inline"},
            },
        )
    )
    events: list[dict] = []
    GraphRunner(
        doc,
        sink=lambda e: events.append(e),
        host=RunHostContext(graphs_root=graphs),
    ).run(context={"last_result": True})
    ne = [e for e in events if e["type"] == "node_execute" and e.get("nodeId") == "t1"]
    assert len(ne) == 1
    env = ne[0]["data"].get("env")
    assert isinstance(env, dict)
    assert env.get("MY_SECRET") == "[redacted]"
    blob = json.dumps(events, default=str)
    assert "super_secret_inline" not in blob


def test_resolved_workspace_root_prefers_explicit(tmp_path: Path) -> None:
    g = tmp_path / "graphs"
    g.mkdir()
    custom = tmp_path / "custom_ws"
    custom.mkdir()
    host = RunHostContext(graphs_root=g, workspace_root=custom)
    assert host.resolved_workspace_root() == custom.resolve()


def test_resolved_workspace_root_parent_of_graphs(tmp_path: Path) -> None:
    g = tmp_path / "graphs"
    g.mkdir()
    host = RunHostContext(graphs_root=g)
    assert host.resolved_workspace_root() == tmp_path.resolve()
