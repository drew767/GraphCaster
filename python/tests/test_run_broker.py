# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.registry import RunBrokerRegistry


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


def test_run_broker_health() -> None:
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_run_broker_stream_minimal_graph() -> None:
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    payload = {
        "documentJson": json.dumps(_minimal_valid_doc(gid)),
        "runId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }
    r = client.post("/runs", json=payload)
    assert r.status_code == 200, r.text
    j = r.json()
    rid = j["runId"]
    assert rid == payload["runId"]
    assert isinstance(j.get("viewerToken"), str) and len(j["viewerToken"]) >= 8
    rb = j.get("runBroker")
    assert isinstance(rb, dict)
    assert rb.get("phase") == "running"
    assert rb.get("queuePosition") == 0

    buf = ""
    with client.stream("GET", f"/runs/{rid}/stream") as response:
        assert response.status_code == 200
        for chunk in response.iter_text():
            buf += chunk
            if "run_finished" in buf:
                break

    assert "run_started" in buf
    assert "run_success" in buf or '"type":"run_success"' in buf
    assert "run_finished" in buf


def test_run_broker_queues_second_run_when_max_concurrent_reached(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_MAX_RUNS", "1")
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "11111111-1111-4111-8111-111111111111"
    doc = json.dumps(_minimal_valid_doc(gid))
    rid1 = "22222222-2222-4222-8222-222222222222"
    rid2 = "33333333-3333-4333-8333-333333333333"
    r1 = client.post("/runs", json={"documentJson": doc, "runId": rid1})
    assert r1.status_code == 200, r1.text
    assert r1.json()["runBroker"]["phase"] == "running"
    r2 = client.post("/runs", json={"documentJson": doc, "runId": rid2})
    assert r2.status_code == 200, r2.text
    j2 = r2.json()
    assert j2["runBroker"]["phase"] == "queued"
    assert j2["runBroker"]["queuePosition"] == 1

    buf = ""
    with client.stream("GET", f"/runs/{rid1}/stream") as response:
        for chunk in response.iter_text():
            buf += chunk
            if "exit" in buf:
                break

    buf2 = ""
    with client.stream("GET", f"/runs/{rid2}/stream") as response:
        assert response.status_code == 200
        for chunk in response.iter_text():
            buf2 += chunk
            if "run_finished" in buf2:
                break
    assert "run_started" in buf2


def test_run_broker_pending_queue_full_returns_503(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_MAX_RUNS", "1")
    monkeypatch.setenv("GC_RUN_BROKER_PENDING_MAX", "1")
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "99999999-9999-4999-8999-999999999999"
    doc = json.dumps(_minimal_valid_doc(gid))
    assert client.post("/runs", json={"documentJson": doc, "runId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}).status_code == 200
    assert client.post("/runs", json={"documentJson": doc, "runId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}).status_code == 200
    r3 = client.post("/runs", json={"documentJson": doc, "runId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc"})
    assert r3.status_code == 503
    assert r3.json().get("error") == "pending_queue_full"


def test_run_broker_rejects_duplicate_active_run_id() -> None:
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    doc = json.dumps(_minimal_valid_doc(gid))
    rid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    r1 = client.post("/runs", json={"documentJson": doc, "runId": rid})
    assert r1.status_code == 200
    r2 = client.post("/runs", json={"documentJson": doc, "runId": rid})
    assert r2.status_code == 400

    buf = ""
    with client.stream("GET", f"/runs/{rid}/stream") as response:
        for chunk in response.iter_text():
            buf += chunk
            if "exit" in buf:
                break


def test_persisted_runs_list_events_summary(tmp_path) -> None:
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    base = tmp_path / "ws"
    run_dir = base / "runs" / gid / "20991231T000000_abcd1234"
    run_dir.mkdir(parents=True)
    (run_dir / "events.ndjson").write_text(
        '{"type":"run_started","rootGraphId":"' + gid + '"}\n',
        encoding="utf-8",
    )
    (run_dir / "run-summary.json").write_text('{"status":"success"}\n', encoding="utf-8")
    r = client.post("/persisted-runs/list", json={"artifactsBase": str(base), "graphId": gid})
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["runDirName"] == "20991231T000000_abcd1234"
    assert items[0]["hasEvents"] is True
    assert items[0]["hasSummary"] is True
    r2 = client.post(
        "/persisted-runs/events",
        json={
            "artifactsBase": str(base),
            "graphId": gid,
            "runDirName": "20991231T000000_abcd1234",
            "maxBytes": 1000,
        },
    )
    assert r2.status_code == 200
    j2 = r2.json()
    assert "run_started" in j2["text"]
    assert j2.get("truncated") is False
    r3 = client.post(
        "/persisted-runs/summary",
        json={"artifactsBase": str(base), "graphId": gid, "runDirName": "20991231T000000_abcd1234"},
    )
    assert r3.status_code == 200
    assert json.loads(r3.json()["text"])["status"] == "success"


def test_persisted_runs_events_truncated_and_huge_max_bytes_capped(tmp_path) -> None:
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    base = tmp_path / "ws"
    run_dir = base / "runs" / gid / "ttrunc"
    run_dir.mkdir(parents=True)
    (run_dir / "events.ndjson").write_bytes(b"a" * 200)
    r = client.post(
        "/persisted-runs/events",
        json={
            "artifactsBase": str(base),
            "graphId": gid,
            "runDirName": "ttrunc",
            "maxBytes": 80,
        },
    )
    assert r.status_code == 200
    jr = r.json()
    assert jr["truncated"] is True
    assert len(jr["text"].encode("utf-8")) == 80
    r2 = client.post(
        "/persisted-runs/events",
        json={
            "artifactsBase": str(base),
            "graphId": gid,
            "runDirName": "ttrunc",
            "maxBytes": 9_999_999_999,
        },
    )
    assert r2.status_code == 200
    assert r2.json()["truncated"] is False


def test_run_catalog_list_and_rebuild(tmp_path) -> None:
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    base = tmp_path / "wscat"
    run_dir = base / "runs" / gid / "20991231T000000_cat"
    run_dir.mkdir(parents=True)
    summary = {
        "schemaVersion": 1,
        "runId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "rootGraphId": gid,
        "status": "success",
        "startedAt": "2099-01-01T00:00:00+00:00",
        "finishedAt": "2099-01-01T00:00:01+00:00",
    }
    (run_dir / "run-summary.json").write_text(json.dumps(summary), encoding="utf-8")
    r0 = client.post("/run-catalog/list", json={"artifactsBase": str(base)})
    assert r0.status_code == 200, r0.text
    assert r0.json()["items"] == []
    rr = client.post("/run-catalog/rebuild", json={"artifactsBase": str(base)})
    assert rr.status_code == 200, rr.text
    assert rr.json()["rebuilt"] == 1
    r1 = client.post("/run-catalog/list", json={"artifactsBase": str(base)})
    assert r1.status_code == 200
    items = r1.json()["items"]
    assert len(items) == 1
    assert items[0]["runId"] == summary["runId"]
    r2 = client.post(
        "/run-catalog/list",
        json={"artifactsBase": str(base), "graphId": gid, "status": "success", "limit": 10, "offset": 0},
    )
    assert r2.status_code == 200
    assert len(r2.json()["items"]) == 1


def test_run_broker_unknown_stream_404() -> None:
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    r = client.get("/runs/no-such-id/stream")
    assert r.status_code == 404


def test_run_broker_token_accepts_header_or_query(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_TOKEN", "sekrit")
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    assert client.get("/health").status_code == 401
    assert client.get("/health", params={"token": "wrong"}).status_code == 401
    assert client.get("/health", params={"token": "sekrit"}).status_code == 200
    assert client.get("/health", headers={"X-GC-Dev-Token": "sekrit"}).status_code == 200


def test_run_broker_stream_accepts_token_query(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_TOKEN", "tok")
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    payload = {
        "documentJson": json.dumps(_minimal_valid_doc(gid)),
        "runId": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    }
    r = client.post("/runs", json=payload, headers={"X-GC-Dev-Token": "tok"})
    assert r.status_code == 200, r.text
    rid = r.json()["runId"]
    assert client.get(f"/runs/{rid}/stream").status_code == 401
    buf = ""
    with client.stream("GET", f"/runs/{rid}/stream", params={"token": "tok"}) as response:
        assert response.status_code == 200
        for chunk in response.iter_text():
            buf += chunk
            if "run_finished" in buf:
                break
    assert "run_started" in buf


def test_run_broker_ws_minimal_graph() -> None:
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "99999999-9999-4999-8999-999999999999"
    payload = {
        "documentJson": json.dumps(_minimal_valid_doc(gid)),
        "runId": "88888888-8888-4888-8888-888888888888",
    }
    r = client.post("/runs", json=payload)
    assert r.status_code == 200, r.text
    j = r.json()
    rid = j["runId"]
    vt = j["viewerToken"]
    lines: list[str] = []
    exit_code: int | None = None
    with client.websocket_connect(f"/runs/{rid}/ws?viewerToken={vt}") as ws:
        while True:
            msg = ws.receive_json()
            assert msg.get("runId") == rid
            ch = msg.get("channel")
            if ch == "stdout" and isinstance(msg.get("line"), str):
                lines.append(msg["line"])
            elif ch == "exit":
                exit_code = msg.get("code")
                break
    blob = "\n".join(lines)
    assert "run_started" in blob
    assert "run_finished" in blob
    assert isinstance(exit_code, int)


def test_run_broker_ws_rejects_bad_viewer_token() -> None:
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "77777777-7777-4777-8777-777777777777"
    payload = {
        "documentJson": json.dumps(_minimal_valid_doc(gid)),
        "runId": "66666666-6666-4666-8666-666666666666",
    }
    r = client.post("/runs", json=payload)
    assert r.status_code == 200, r.text
    rid = r.json()["runId"]
    with pytest.raises(Exception):
        with client.websocket_connect(f"/runs/{rid}/ws?viewerToken=nope"):
            ws.receive_json()


def test_run_broker_ws_accepts_broker_dev_token_query(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_TOKEN", "wsdev")
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "44444444-4444-4444-8444-444444444444"
    payload = {
        "documentJson": json.dumps(_minimal_valid_doc(gid)),
        "runId": "33333333-3333-4333-8333-333333333333",
    }
    r = client.post("/runs", json=payload, headers={"X-GC-Dev-Token": "wsdev"})
    assert r.status_code == 200, r.text
    j = r.json()
    rid = j["runId"]
    vt = j["viewerToken"]
    got_exit = False
    with client.websocket_connect(
        f"/runs/{rid}/ws?viewerToken={vt}&token=wsdev",
    ) as ws:
        while True:
            msg = ws.receive_json()
            if msg.get("channel") == "exit":
                got_exit = True
                break
    assert got_exit


def test_run_broker_ws_accepts_push_ref_alias() -> None:
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "55555555-5555-4555-8555-555555555555"
    payload = {
        "documentJson": json.dumps(_minimal_valid_doc(gid)),
        "runId": "44444444-4444-4444-8444-444444444444",
    }
    r = client.post("/runs", json=payload)
    assert r.status_code == 200, r.text
    j = r.json()
    rid = j["runId"]
    vt = j["viewerToken"]
    got_exit = False
    with client.websocket_connect(f"/runs/{rid}/ws?pushRef={vt}") as ws:
        while True:
            msg = ws.receive_json()
            if msg.get("channel") == "exit":
                got_exit = True
                break
    assert got_exit


def test_broadcaster_splits_newlines_in_sse_out() -> None:
    from graph_caster.run_broker.broadcaster import FanOutMsg, RunBroadcaster

    b = RunBroadcaster(run_id="sse-newline-test")
    q = b.subscribe()

    async def collect() -> str:
        parts: list[str] = []
        async for chunk in b.stream_queue(q):
            parts.append(chunk)
        return "".join(parts)

    b.broadcast(FanOutMsg("out", "a\nb"))
    b.broadcast(FanOutMsg("exit", 0))
    joined = asyncio.run(collect())
    assert "data: a\n" in joined
    assert "data: b\n" in joined
    assert "event: exit\n" in joined


def test_broadcaster_stamps_sequence_on_events() -> None:
    """Broadcaster should stamp monotonic seq on each JSON object on the out channel."""
    from graph_caster.run_broker.broadcaster import FanOutMsg, RunBroadcaster

    broadcaster = RunBroadcaster(run_id="test-run")
    sub_q = broadcaster.subscribe()

    broadcaster.broadcast(FanOutMsg("out", '{"type": "process_output", "line": "a"}'))
    broadcaster.broadcast(FanOutMsg("out", '{"type": "process_output", "line": "b"}'))
    broadcaster.broadcast(FanOutMsg("exit", 0))

    events: list[object] = []
    while not sub_q.empty():
        msg = sub_q.get_nowait()
        if msg.kind == "out":
            data = json.loads(msg.payload)
            events.append(data.get("seq"))
        elif msg.kind == "exit":
            events.append(f"exit:{msg.payload}")

    assert events[0] == 1
    assert events[1] == 2
    assert events[2] == "exit:0"


def test_broadcaster_priority_mode_preserves_critical_events() -> None:
    """In priority mode, critical events survive when the subscriber queue is under pressure."""
    from graph_caster.run_broker.bounded_queue import MessagePriority
    from graph_caster.run_broker.broadcaster import (
        FanOutMsg,
        RunBroadcaster,
        RunBroadcasterConfig,
    )

    config = RunBroadcasterConfig(max_sub_queue_depth=3, use_priority_queue=True)
    broadcaster = RunBroadcaster(run_id="test-run", config=config)
    sub_q = broadcaster.subscribe()

    for i in range(5):
        broadcaster.broadcast_with_priority(
            FanOutMsg("out", f'{{"line": "{i}"}}'),
            MessagePriority.LOW,
        )

    broadcaster.broadcast_with_priority(
        FanOutMsg("out", '{"type": "run_started"}'),
        MessagePriority.CRITICAL,
    )

    events: list[FanOutMsg] = []
    while True:
        try:
            events.append(sub_q.get(timeout=0.5))
        except Exception:
            break

    payloads = [e.payload for e in events if e.kind == "out"]
    assert any("run_started" in str(p) for p in payloads)


def test_registry_run_manager_merges_trigger_into_context_json(tmp_path) -> None:
    from graph_caster.run_broker.registry_run_manager import BrokerRegistryRunManager

    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    gdir = tmp_path / "graphs"
    gdir.mkdir()
    (gdir / f"{gid}.json").write_text(
        json.dumps(_minimal_valid_doc(gid)),
        encoding="utf-8",
    )
    reg = RunBrokerRegistry()
    captured: dict = {}

    class SP:
        run_id = "rid-captured"

    def fake_spawn(body: dict) -> SP:
        captured.clear()
        captured.update(body)
        return SP()

    reg.spawn_from_body = fake_spawn  # type: ignore[method-assign]
    m = BrokerRegistryRunManager(reg, graphs_dir=gdir)

    async def _go() -> None:
        await m.start_run(
            gid,
            context={"inputs": {"a": 1}},
            trigger_context={"type": "api", "graph_id": gid},
        )

    asyncio.run(_go())
    ctx = captured.get("contextJson")
    assert ctx is not None
    assert ctx["inputs"] == {"a": 1}
    assert ctx["trigger"] == {"type": "api", "graph_id": gid}


def _doc_with_webhook_trigger(graph_id: str) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": "wh"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "wh",
                "type": "trigger_webhook",
                "position": {"x": 0, "y": 0},
                "data": {"path": "/hook", "method": "POST", "auth": "none"},
            },
            {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e0",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "e1",
                "source": "wh",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }


def test_webhook_graph_trigger_spawns_run(
    tmp_path: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(tmp_path))
    p = tmp_path / f"{gid}.json"
    p.write_text(json.dumps(_doc_with_webhook_trigger(gid)), encoding="utf-8")

    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    r = client.post("/webhooks/trigger/" + gid + "/hook", json={"hello": "world"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert "runId" in j
    rid = j["runId"]
    buf = ""
    with client.stream("GET", f"/runs/{rid}/stream") as response:
        assert response.status_code == 200
        for chunk in response.iter_text():
            buf += chunk
            if "node_execute" in buf and "trigger_webhook" in buf:
                break
    assert "trigger_webhook" in buf
    assert "run_finished" in buf


def test_webhook_graph_trigger_response_mode_wait(
    tmp_path: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    gid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(tmp_path))
    art = tmp_path / "artifacts"
    art.mkdir()
    monkeypatch.setenv("GC_RUN_BROKER_ARTIFACTS_BASE", str(art))
    doc = _doc_with_webhook_trigger(gid)
    for n in doc["nodes"]:
        if n["id"] == "wh":
            n["data"] = {
                "path": "/hook",
                "method": "POST",
                "auth": "none",
                "responseMode": "wait",
            }
    p = tmp_path / f"{gid}.json"
    p.write_text(json.dumps(doc), encoding="utf-8")

    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    r = client.post("/webhooks/trigger/" + gid + "/hook", json={"k": 1})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j.get("status") == "success"
    assert "runId" in j
    assert j.get("outputs") is None


def test_webhook_graph_trigger_bearer_auth(
    tmp_path: object, monkeypatch: pytest.MonkeyPatch
) -> None:
    gid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(tmp_path))
    doc = _doc_with_webhook_trigger(gid)
    for n in doc["nodes"]:
        if n["id"] == "wh":
            n["data"] = {
                "path": "/secure",
                "method": "POST",
                "auth": "bearer",
                "secret": "tok",
            }
    p = tmp_path / f"{gid}.json"
    p.write_text(json.dumps(doc), encoding="utf-8")

    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    r0 = client.post("/webhooks/trigger/" + gid + "/secure", json={})
    assert r0.status_code == 401
    r1 = client.post(
        "/webhooks/trigger/" + gid + "/secure",
        json={},
        headers={"Authorization": "Bearer tok"},
    )
    assert r1.status_code == 200, r1.text


def test_prometheus_text_includes_fork_threadpool_gauge(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GC_GRAPH_FORK_THREADPOOL_MAX", "8")
    reg = RunBrokerRegistry()
    text = reg.prometheus_metrics_text()
    assert "gc_graph_fork_threadpool_max_config 8" in text


def test_build_graph_caster_run_argv_includes_start_node_id() -> None:
    from pathlib import Path

    from graph_caster.cli_run_args import build_graph_caster_run_argv

    argv = build_graph_caster_run_argv(
        Path("/tmp/doc.json"),
        run_id="rid",
        start_node_id="wh-start",
    )
    assert "--start" in argv
    assert argv[argv.index("--start") + 1] == "wh-start"
