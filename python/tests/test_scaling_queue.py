# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

from graph_caster.scaling.job_processor import process_run_job_payload
from graph_caster.scaling.queue_service import RunQueueService
from graph_caster.scaling.types import RunJob


def _minimal_doc(graph_id: str) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": "t"},
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
            }
        ],
    }


def test_run_job_roundtrip() -> None:
    j = RunJob(
        job_id="j1",
        graph_id="g1",
        run_id="r1",
        graphs_dir="/tmp/g",
        context={"a": 1},
        artifacts_base=None,
        workspace_root=None,
    )
    j2 = RunJob.from_dict(j.to_dict())
    assert j2.job_id == "j1"
    assert j2.context == {"a": 1}


def test_process_run_job_payload_happy_path(tmp_path: Path) -> None:
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    gdir = tmp_path / "graphs"
    gdir.mkdir()
    (gdir / f"{gid}.json").write_text(json.dumps(_minimal_doc(gid)), encoding="utf-8")
    out = process_run_job_payload(
        {
            "job_id": "j",
            "graph_id": gid,
            "run_id": "r",
            "graphs_dir": str(gdir),
            "context": {},
        },
    )
    assert out["ok"] is True
    assert out["run_id"] == "r"


def test_process_run_job_payload_missing_file(tmp_path: Path) -> None:
    gdir = tmp_path / "empty"
    gdir.mkdir()
    out = process_run_job_payload(
        {
            "job_id": "j",
            "graph_id": "nope",
            "run_id": "r",
            "graphs_dir": str(gdir),
            "context": {},
        },
    )
    assert out["ok"] is False


def test_run_queue_service_process_inline() -> None:
    from tempfile import TemporaryDirectory

    gid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    with TemporaryDirectory() as td:
        root = Path(td)
        gdir = root / "g"
        gdir.mkdir()
        (gdir / f"{gid}.json").write_text(json.dumps(_minimal_doc(gid)), encoding="utf-8")
        job = RunJob(job_id="j", graph_id=gid, run_id="r", graphs_dir=str(gdir), context={})
        out = RunQueueService.process_inline(job)
        assert out["ok"] is True
