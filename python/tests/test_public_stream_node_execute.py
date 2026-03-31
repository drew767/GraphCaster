# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import sys
from pathlib import Path

from graph_caster.runner.graph_runner import GraphRunner
from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.run_event_sink import (
    CallableRunEventSink,
    NdjsonAppendFileSink,
    NodeExecutePublicStreamSink,
    TeeRunEventSink,
)
from graph_caster.cli_run_args import build_graph_caster_run_argv


def _cmd_py() -> list[str]:
    return [sys.executable, "-c", "print(1)"]


def test_node_execute_public_stream_sink_strips_data() -> None:
    got: list[dict] = []

    inner = CallableRunEventSink(lambda e: got.append(dict(e)))
    sink = NodeExecutePublicStreamSink(inner, omit_node_execute_payload=True)
    sink.emit({"type": "node_execute", "nodeId": "n1", "nodeType": "task", "data": {"secret": 1}})
    assert len(got) == 1
    assert got[0]["type"] == "node_execute"
    assert got[0]["nodeId"] == "n1"
    assert "data" not in got[0]

    sink.emit({"type": "run_started", "rootGraphId": "g"})
    assert got[1]["type"] == "run_started"


def test_node_execute_public_stream_sink_no_strip_when_disabled() -> None:
    got: list[dict] = []
    sink = NodeExecutePublicStreamSink(
        CallableRunEventSink(lambda e: got.append(dict(e))),
        omit_node_execute_payload=False,
    )
    sink.emit({"type": "node_execute", "nodeId": "n1", "data": {"x": 1}})
    assert got[0].get("data") == {"x": 1}


def test_public_stream_tee_keeps_data_on_file_sink(tmp_path: Path) -> None:
    gid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "t"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "t1",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {"command": _cmd_py(), "cwd": str(tmp_path)},
                },
                {"id": "x1", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "s1",
                    "target": "t1",
                    "sourceHandle": "out_default",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e2",
                    "source": "t1",
                    "target": "x1",
                    "sourceHandle": "out_default",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )

    stream_lines: list[dict] = []
    log_path = tmp_path / "capture.ndjson"

    stream = NodeExecutePublicStreamSink(
        CallableRunEventSink(lambda e: stream_lines.append(dict(e))),
        omit_node_execute_payload=True,
    )
    file_sink = NdjsonAppendFileSink(log_path)
    sink = TeeRunEventSink(stream, file_sink)

    GraphRunner(doc, sink=sink, host=RunHostContext(), persist_run_events=False).run()

    exec_ev = [e for e in stream_lines if e.get("type") == "node_execute" and e.get("nodeId") == "t1"]
    assert len(exec_ev) == 1
    assert "data" not in exec_ev[0]

    raw_lines = log_path.read_text(encoding="utf-8").strip().splitlines()
    parsed = [json.loads(line) for line in raw_lines]
    file_exec = [e for e in parsed if e.get("type") == "node_execute"]
    t1_file = [e for e in file_exec if e.get("nodeId") == "t1"]
    assert len(t1_file) == 1
    assert "data" in t1_file[0]


def test_build_graph_caster_run_argv_public_stream_flag(tmp_path: Path) -> None:
    doc = tmp_path / "g.json"
    doc.write_text("{}", encoding="utf-8")
    argv = build_graph_caster_run_argv(doc, run_id="r1", public_stream=True)
    assert "--public-stream" in argv


def test_build_graph_caster_run_argv_no_public_stream_by_default(tmp_path: Path) -> None:
    doc = tmp_path / "g.json"
    doc.write_text("{}", encoding="utf-8")
    argv = build_graph_caster_run_argv(doc, run_id="r1")
    assert "--public-stream" not in argv
