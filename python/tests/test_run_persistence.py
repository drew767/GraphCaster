# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

import pytest

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner

_GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]


def _minimal_doc(gid: str) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid, "title": "t"},
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


def test_persist_run_events_writes_ndjson_and_summary(tmp_path: Path) -> None:
    gid = "11111111-1111-4111-8111-111111111111"
    doc = GraphDocument.from_dict(_minimal_doc(gid))
    mem: list[dict] = []
    GraphRunner(
        doc,
        sink=lambda e: mem.append(e),
        host=RunHostContext(artifacts_base=tmp_path),
        persist_run_events=True,
    ).run(context={"last_result": True})
    ready = next(e for e in mem if e["type"] == "run_root_ready")
    run_dir = Path(ready["rootRunArtifactDir"])
    log = run_dir / "events.ndjson"
    assert log.is_file()
    lines = [ln for ln in log.read_text(encoding="utf-8").split("\n") if ln.strip()]
    types = [json.loads(ln)["type"] for ln in lines]
    assert types[0] == "run_root_ready"
    assert "run_started" in types
    assert types[-1] == "run_finished"
    summary_path = run_dir / "run-summary.json"
    assert summary_path.is_file()
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    assert summary.get("schemaVersion") == 1
    assert summary["rootGraphId"] == gid
    assert summary["status"] == "success"
    assert summary.get("runId")


def test_read_persisted_events_ndjson_sets_truncated(tmp_path: Path) -> None:
    from graph_caster.artifacts import read_persisted_events_ndjson_capped

    gid = "33333333-3333-4333-8333-333333333333"
    d = tmp_path / "runs" / gid / "r1"
    d.mkdir(parents=True)
    (d / "events.ndjson").write_bytes(b"x" * 500)
    text, truncated = read_persisted_events_ndjson_capped(tmp_path, gid, "r1", 100)
    assert truncated is True
    assert len(text.encode("utf-8")) == 100


def test_summary_write_failure_still_closes_sink_and_completes_session(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from graph_caster.run_sessions import RunSessionRegistry

    gid = "44444444-4444-4444-8444-444444444444"
    doc = GraphDocument.from_dict(_minimal_doc(gid))
    reg = RunSessionRegistry()
    rid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

    def _boom(*_a: object, **_k: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr("graph_caster.artifacts.write_run_summary", _boom)
    runner = GraphRunner(
        doc,
        sink=lambda _e: None,
        host=RunHostContext(artifacts_base=tmp_path),
        run_id=rid,
        session_registry=reg,
        persist_run_events=True,
    )
    with pytest.raises(OSError, match="disk full"):
        runner.run(context={"last_result": True})
    assert runner._persist_file_sink is None
    sess = reg.get(rid)
    assert sess is not None
    assert sess.status == "success"


def test_example_graph_persist_order_has_root_ready_before_started(tmp_path: Path) -> None:
    raw = json.loads(
        (_GRAPH_CASTER_ROOT / "schemas" / "graph-document.example.json").read_text(encoding="utf-8")
    )
    doc = GraphDocument.from_dict(raw)
    mem: list[dict] = []
    GraphRunner(
        doc,
        sink=lambda e: mem.append(e),
        host=RunHostContext(artifacts_base=tmp_path),
        persist_run_events=True,
    ).run(context={"last_result": True})
    types = [e["type"] for e in mem]
    i_ready = types.index("run_root_ready")
    i_started = types.index("run_started")
    assert i_ready < i_started


def test_list_persisted_run_entries_matches_disk(tmp_path: Path) -> None:
    from graph_caster.artifacts import list_persisted_run_entries

    gid = "22222222-2222-4222-8222-222222222222"
    d = tmp_path / "runs" / gid / "20991231T235959_deadbeef"
    d.mkdir(parents=True)
    (d / "events.ndjson").write_text("{}\n", encoding="utf-8")
    rows = list_persisted_run_entries(tmp_path, gid)
    assert len(rows) == 1
    assert rows[0]["runDirName"] == "20991231T235959_deadbeef"
    assert rows[0]["hasEvents"] is True
    assert rows[0]["hasSummary"] is False
