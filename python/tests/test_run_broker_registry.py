# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

from graph_caster.cli_run_args import build_graph_caster_run_argv


def test_build_run_argv_matches_tauri_order(tmp_path: Path) -> None:
    doc = tmp_path / "g.json"
    doc.write_text("{}", encoding="utf-8")
    ctx = tmp_path / "ctx.json"
    ctx.write_text(json.dumps({"node_outputs": {}}), encoding="utf-8")
    argv = build_graph_caster_run_argv(
        doc,
        run_id="rid-1",
        graphs_dir=tmp_path / "gdir",
        artifacts_base=tmp_path / "art",
        until_node="n1",
        context_json_path=ctx,
        step_cache=True,
        step_cache_dirty="a,b",
    )
    assert argv[:6] == ["run", "-d", str(doc), "--track-session", "--control-stdin", "--run-id"]
    assert argv[6] == "rid-1"
    tail = argv[7:]
    assert "-g" in tail
    assert str(tmp_path / "gdir") in tail
    assert "--artifacts-base" in tail
    assert "--step-cache" in tail
    assert "--step-cache-dirty" in tail
    assert "a,b" in tail
    assert "--until-node" in tail
    assert "n1" in tail
    assert "--context-json" in tail
    assert str(ctx) in tail
