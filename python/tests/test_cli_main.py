# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

from graph_caster.__main__ import main
from graph_caster.artifacts import create_root_run_artifact_dir


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
