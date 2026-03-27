# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import sys
from pathlib import Path

from graph_caster.__main__ import main
from graph_caster.artifacts import create_root_run_artifact_dir

_REPO_ROOT = Path(__file__).resolve().parents[2]
_PARTIAL_FIXTURE = _REPO_ROOT / "schemas" / "test-fixtures" / "partial-run-linear.json"


def _minimal_valid_doc(graph_id: str) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": "x"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
                "condition": None,
            }
        ],
    }


def test_main_no_args_prints_help(capsys) -> None:
    assert main([]) == 0
    assert "usage" in capsys.readouterr().out.lower()


def test_main_run_legacy_argv(capsys, tmp_path: Path) -> None:
    gid = "11111111-1111-4111-8111-111111111111"
    p = tmp_path / "g.json"
    p.write_text(json.dumps(_minimal_valid_doc(gid)), encoding="utf-8")
    assert main(["-d", str(p)]) == 0
    out = capsys.readouterr().out
    assert "run_success" in out


def test_main_run_explicit_subcommand(tmp_path: Path) -> None:
    gid = "22222222-2222-4222-8222-222222222222"
    p = tmp_path / "g.json"
    p.write_text(json.dumps(_minimal_valid_doc(gid)), encoding="utf-8")
    assert main(["run", "-d", str(p)]) == 0


def test_main_run_with_artifacts_base_emits_run_root_ready(capsys, tmp_path: Path) -> None:
    gid = "77777777-7777-4777-8777-777777777777"
    p = tmp_path / "g.json"
    p.write_text(json.dumps(_minimal_valid_doc(gid)), encoding="utf-8")
    base = tmp_path / "ws"
    base.mkdir()
    assert main(["run", "-d", str(p), "--artifacts-base", str(base)]) == 0
    assert "run_root_ready" in capsys.readouterr().out


def test_main_artifacts_size_total(capsys, tmp_path: Path) -> None:
    gid = "33333333-3333-4333-8333-333333333333"
    d = create_root_run_artifact_dir(tmp_path, gid)
    (d / "t.txt").write_bytes(b"abc")
    assert main(["artifacts-size", "--base", str(tmp_path)]) == 0
    assert int(capsys.readouterr().out.strip()) == 3


def test_main_artifacts_size_one_graph(capsys, tmp_path: Path) -> None:
    gid = "44444444-4444-4444-8444-444444444444"
    create_root_run_artifact_dir(tmp_path, gid)
    o = create_root_run_artifact_dir(tmp_path, "55555555-5555-4555-8555-555555555555")
    (o / "z").write_bytes(b"x")
    assert main(["artifacts-size", "--base", str(tmp_path), "--graph-id", gid]) == 0
    assert int(capsys.readouterr().out.strip()) == 0


def test_main_artifacts_clear_all(tmp_path: Path) -> None:
    create_root_run_artifact_dir(tmp_path, "66666666-6666-4666-8666-666666666666")
    assert (tmp_path / "runs").is_dir()
    assert main(["artifacts-clear", "--base", str(tmp_path), "--all"]) == 0
    assert not (tmp_path / "runs").exists()


def test_main_artifacts_size_invalid_graph_id() -> None:
    assert main(["artifacts-size", "--base", ".", "--graph-id", ".."]) == 2


def test_main_run_invalid_document_shape(capsys, tmp_path: Path) -> None:
    p = tmp_path / "bad.json"
    p.write_text('{"schemaVersion":1,"meta":{"schemaVersion":1,"graphId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"},"nodes":[{}],"edges":[]}', encoding="utf-8")
    assert main(["run", "-d", str(p)]) == 2
    err = capsys.readouterr().err
    assert "nodes[0]" in err or "id" in err.lower()


def _doc_with_graph_ref(gid: str, target: str) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid},
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "r",
                "type": "graph_ref",
                "position": {"x": 0, "y": 0},
                "data": {"targetGraphId": target},
            },
            {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e0",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "r",
                "targetHandle": "in_default",
            },
            {
                "id": "e1",
                "source": "r",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
            },
        ],
    }


def test_main_run_graphs_dir_cycle_exits_3_before_run(capsys, tmp_path: Path) -> None:
    ga = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    gb = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    graphs = tmp_path / "graphs"
    graphs.mkdir()
    (graphs / "a.json").write_text(json.dumps(_doc_with_graph_ref(ga, gb)), encoding="utf-8")
    (graphs / "b.json").write_text(json.dumps(_doc_with_graph_ref(gb, ga)), encoding="utf-8")
    root = tmp_path / "root.json"
    root.write_text(json.dumps(_minimal_valid_doc(ga)), encoding="utf-8")
    code = main(["run", "-d", str(root), "-g", str(graphs)])
    captured = capsys.readouterr()
    assert code == 3
    assert "cycle" in captured.err.lower()
    assert "run_started" not in captured.out


def test_main_run_until_node_partial_finished(capsys) -> None:
    assert _PARTIAL_FIXTURE.is_file()
    assert main(["run", "-d", str(_PARTIAL_FIXTURE), "--until-node", "tb_mid"]) == 0
    captured = capsys.readouterr()
    assert "partial" in captured.out and "run_finished" in captured.out
    assert "node_enter" in captured.out
    assert captured.err == ""


def test_main_run_until_node_unknown_id(capsys) -> None:
    assert main(["run", "-d", str(_PARTIAL_FIXTURE), "--until-node", "nope"]) == 2
    assert "not a node id" in capsys.readouterr().err


def test_main_run_until_node_ignores_start_stderr_note(capsys) -> None:
    code = main(["run", "-d", str(_PARTIAL_FIXTURE), "--until-node", "tb_mid", "-s", "tb_mid"])
    assert code == 0
    captured = capsys.readouterr()
    assert "ignoring --start" in captured.err
    types = [json.loads(line)["type"] for line in captured.out.splitlines() if line.strip()]
    assert types.count("node_enter") == 2


def test_main_context_json_invalid_returns_2(capsys, tmp_path: Path) -> None:
    bad = tmp_path / "ctx.json"
    bad.write_text("not-json", encoding="utf-8")
    assert main(["run", "-d", str(_PARTIAL_FIXTURE), "--context-json", str(bad)]) == 2
    assert "context-json" in capsys.readouterr().err


def _step_cache_cli_doc(gid: str, cwd: Path) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid, "title": "cli-step-cache"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "t1",
                "type": "task",
                "position": {"x": 0, "y": 0},
                "data": {
                    "command": [sys.executable, "-c", "print(1)"],
                    "cwd": str(cwd),
                    "stepCache": True,
                },
            },
            {"id": "x1", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "s1",
                "sourceHandle": "out_default",
                "target": "t1",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "e2",
                "source": "t1",
                "sourceHandle": "out_default",
                "target": "x1",
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }


def test_main_step_cache_requires_artifacts_base(capsys, tmp_path: Path) -> None:
    gid = "30303030-3030-4303-8303-303030303030"
    p = tmp_path / "g.json"
    p.write_text(json.dumps(_step_cache_cli_doc(gid, tmp_path)), encoding="utf-8")
    assert main(["run", "-d", str(p), "--step-cache"]) == 2
    assert "artifacts-base" in capsys.readouterr().err.lower()


def test_main_step_cache_second_run_emits_cache_hit(capsys, tmp_path: Path) -> None:
    gid = "40404040-4040-4404-8404-404040404040"
    p = tmp_path / "g.json"
    p.write_text(json.dumps(_step_cache_cli_doc(gid, tmp_path)), encoding="utf-8")
    base = tmp_path / "ws"
    base.mkdir()
    assert main(["run", "-d", str(p), "--artifacts-base", str(base), "--step-cache"]) == 0
    assert "node_cache_miss" in capsys.readouterr().out
    assert main(["run", "-d", str(p), "--artifacts-base", str(base), "--step-cache"]) == 0
    out2 = capsys.readouterr().out
    assert "node_cache_hit" in out2
