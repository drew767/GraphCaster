# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import threading
from typing import Any

from graph_caster.models import GraphDocument, Edge, Node
from graph_caster.runner import GraphRunner
from graph_caster.run_sessions import (
    RunSession,
    RunSessionRegistry,
    get_default_run_registry,
    reset_default_run_registry,
)


def _linear_comment_chain(*, graph_id: str, n_middle: int) -> GraphDocument:
    nodes: list[Node] = [
        Node(id="start1", type="start", position={"x": 0, "y": 0}, data={}),
    ]
    edges: list[Edge] = []
    prev = "start1"
    for i in range(n_middle):
        nid = f"c{i}"
        nodes.append(Node(id=nid, type="comment", position={"x": 0, "y": 0}, data={}))
        edges.append(
            Edge(
                id=f"e_{prev}_{nid}",
                source=prev,
                target=nid,
                source_handle="out_default",
                target_handle="in_default",
                condition=None,
            )
        )
        prev = nid
    nodes.append(Node(id="exit1", type="exit", position={"x": 0, "y": 0}, data={}))
    edges.append(
        Edge(
            id=f"e_{prev}_exit1",
            source=prev,
            target="exit1",
            source_handle="out_default",
            target_handle="in_default",
            condition=None,
        )
    )
    return GraphDocument(
        schema_version=1,
        graph_id=graph_id,
        title=None,
        author=None,
        viewport={"x": 0, "y": 0, "zoom": 1},
        nodes=nodes,
        edges=edges,
    )


def test_session_registry_completes_with_success() -> None:
    reg = RunSessionRegistry()
    doc = _linear_comment_chain(graph_id="11111111-1111-1111-1111-111111111111", n_middle=1)
    events: list[dict[str, Any]] = []
    runner = GraphRunner(doc, sink=lambda e: events.append(e), session_registry=reg)
    runner.run(context={"last_result": True})
    finished = [e for e in events if e.get("type") == "run_finished"]
    assert len(finished) == 1
    assert finished[0].get("status") == "success"
    rid = finished[0]["runId"]
    s = reg.get(rid)
    assert s is not None
    assert s.status == "success"
    assert s.finished_at is not None


def test_duplicate_active_run_id_raises() -> None:
    reg = RunSessionRegistry()
    s1 = RunSession(run_id="same-id", root_graph_id="g1")
    s2 = RunSession(run_id="same-id", root_graph_id="g2")
    reg.register(s1)
    try:
        reg.register(s2)
        raise AssertionError("expected ValueError")
    except ValueError as e:
        assert "same-id" in str(e)


def test_request_cancel_marks_finished_cancelled() -> None:
    reg = RunSessionRegistry()
    doc = _linear_comment_chain(graph_id="22222222-2222-2222-2222-222222222222", n_middle=4)
    started = threading.Event()
    resume = threading.Event()
    run_ids: list[str] = []
    events: list[dict[str, Any]] = []

    def sink(ev: dict[str, Any]) -> None:
        events.append(ev)
        if ev.get("type") == "run_started":
            run_ids.append(ev["runId"])
            started.set()
            assert resume.wait(timeout=5.0)

    runner = GraphRunner(doc, sink=sink, session_registry=reg)

    def work() -> None:
        runner.run(context={"last_result": True})

    th = threading.Thread(target=work)
    th.start()
    assert started.wait(timeout=3.0)
    rid = run_ids[0]
    assert reg.request_cancel(rid)
    resume.set()
    th.join(timeout=5.0)
    assert not th.is_alive()
    finished = [e for e in events if e.get("type") == "run_finished"]
    assert len(finished) == 1
    assert finished[0].get("status") == "cancelled"
    s = reg.get(rid)
    assert s is not None
    assert s.status == "cancelled"


def test_without_registry_run_finished_success_or_failed_only() -> None:
    doc = _linear_comment_chain(graph_id="33333333-3333-3333-3333-333333333333", n_middle=0)
    events: list[dict[str, Any]] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    fin = [e for e in events if e["type"] == "run_finished"][0]
    assert fin["status"] == "success"


def test_prepare_context_clears_cancel_flags_for_reused_context() -> None:
    doc = _linear_comment_chain(graph_id="66666666-6666-4666-8666-666666666666", n_middle=0)
    ctx: dict[str, Any] = {"last_result": True}
    ctx["_run_cancelled"] = True
    ctx["_gc_process_cancelled"] = True
    events: list[dict[str, Any]] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context=ctx)
    assert events[-1].get("status") == "success"
    assert "_run_cancelled" not in ctx
    assert "_gc_process_cancelled" not in ctx


def test_reset_default_run_registry_clears_singleton() -> None:
    reset_default_run_registry()
    a = get_default_run_registry()
    b = get_default_run_registry()
    assert a is b
    reset_default_run_registry()
    c = get_default_run_registry()
    assert c is not a


def test_cancel_observed_when_nesting_depth_positive() -> None:
    doc = _linear_comment_chain(graph_id="44444444-4444-4444-4444-444444444444", n_middle=25)
    sess = RunSession(run_id="55555555-5555-4555-8555-555555555555", root_graph_id=doc.graph_id)
    gate = threading.Event()
    resume = threading.Event()
    ctx: dict[str, Any] = {
        "last_result": True,
        "nesting_depth": 1,
        "run_id": sess.run_id,
        "_gc_run_session": sess,
    }

    def sink(ev: dict[str, Any]) -> None:
        if ev.get("type") == "node_enter" and ev.get("nodeId") == "c10":
            gate.set()
            assert resume.wait(timeout=5.0)

    def work() -> None:
        GraphRunner(doc, sink=sink, run_id=sess.run_id).run_from("start1", context=ctx)

    th = threading.Thread(target=work)
    th.start()
    assert gate.wait(timeout=3.0)
    sess.cancel_event.set()
    resume.set()
    th.join(timeout=5.0)
    assert not th.is_alive()
    assert ctx.get("_run_cancelled") is True
