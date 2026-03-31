# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json

from graph_caster.ai_routing import (
    build_ai_route_request,
    encode_ai_route_wire_body,
    resolve_ai_route_choice,
    usable_ai_route_out_edges,
)
from graph_caster.models import Edge, GraphDocument, Node
from graph_caster.runner import GraphRunner
from graph_caster.validate import find_ai_route_structure_warnings


def _doc_ai_route_two_branches() -> GraphDocument:
    nodes = [
        Node("s", "start", {"x": 0, "y": 0}, {}),
        Node("a", "ai_route", {"x": 1, "y": 0}, {"title": "R", "endpointUrl": "http://example.invalid/route"}),
        Node("x", "exit", {"x": 2, "y": 0}, {}),
        Node("y", "exit", {"x": 2, "y": 1}, {}),
    ]
    edges = [
        Edge("e0", "s", "out_default", "a", "in_default", None, None),
        Edge(
            "e1",
            "a",
            "out_default",
            "x",
            "in_default",
            None,
            {"routeDescription": "path X"},
        ),
        Edge(
            "e2",
            "a",
            "out_default",
            "y",
            "in_default",
            None,
            {"routeDescription": "path Y"},
        ),
    ]
    return GraphDocument(
        schema_version=1,
        graph_id="g-ai",
        nodes=nodes,
        edges=edges,
    )


def test_usable_ai_route_out_edges_order() -> None:
    doc = _doc_ai_route_two_branches()
    out = usable_ai_route_out_edges(doc, "a")
    assert [e.id for e in out] == ["e1", "e2"]


def test_find_ai_route_warnings_missing_descriptions() -> None:
    nodes = [
        Node("s", "start", {"x": 0, "y": 0}, {}),
        Node("a", "ai_route", {"x": 1, "y": 0}, {}),
        Node("x", "task", {"x": 2, "y": 0}, {"command": "echo"}),
        Node("y", "task", {"x": 2, "y": 1}, {"command": "echo"}),
    ]
    edges = [
        Edge("e0", "s", "out_default", "a", "in_default", None, None),
        Edge("e1", "a", "out_default", "x", "in_default", None, None),
        Edge("e2", "a", "out_default", "y", "in_default", None, None),
    ]
    doc = GraphDocument(1, "g-w", nodes, edges)
    w = find_ai_route_structure_warnings(doc)
    assert any(x["kind"] == "ai_route_missing_route_descriptions" for x in w)


def test_ai_route_mock_provider_choice_2() -> None:
    doc = _doc_ai_route_two_branches()
    ctx: dict = {
        "last_result": True,
        "node_outputs": {"s": {"nodeType": "start", "data": {}}},
        "run_id": "rid-1",
    }

    def provider(body: dict) -> dict:
        assert body["schemaVersion"] == 1
        assert len(body["outgoing"]) == 2
        return {"choiceIndex": 2}

    ctx["ai_route_provider"] = provider
    node = doc.nodes[1]
    assert node.type == "ai_route"
    out = resolve_ai_route_choice(
        doc=doc,
        node=node,
        ctx=ctx,
        run_id="rid-1",
        preds=["s"],
        provider_override=provider,
    )
    assert out.chosen is not None
    assert out.chosen.id == "e2"


def test_ai_route_single_outgoing_skips_http() -> None:
    nodes = [
        Node("s", "start", {"x": 0, "y": 0}, {}),
        Node("a", "ai_route", {"x": 1, "y": 0}, {}),
        Node("x", "exit", {"x": 2, "y": 0}, {}),
    ]
    edges = [
        Edge("e0", "s", "out_default", "a", "in_default", None, None),
        Edge("e1", "a", "out_default", "x", "in_default", None, None),
    ]
    doc = GraphDocument(1, "g1", nodes, edges)
    node = doc.nodes[1]
    out = resolve_ai_route_choice(
        doc=doc,
        node=node,
        ctx={"last_result": True, "node_outputs": {}, "run_id": "r"},
        run_id="r",
        preds=["s"],
        provider_override=None,
    )
    assert out.chosen is not None and out.chosen.id == "e1"
    assert out.error_reason is None


def test_ai_route_wire_body_size_matches_limit_gate() -> None:
    doc = _doc_ai_route_two_branches()
    node = doc.nodes[1]
    out = usable_ai_route_out_edges(doc, "a")
    ctx = {"last_result": True, "node_outputs": {"s": {"nodeType": "start"}}, "run_id": "r"}
    body, err = build_ai_route_request(
        doc=doc,
        node=node,
        outgoing=out,
        ctx=ctx,
        run_id="r",
        max_request_bytes=65536,
        preds=["s"],
    )
    assert err is None and body is not None
    raw = encode_ai_route_wire_body(body)
    assert len(raw) <= 65536
    pretty = json.dumps(body, ensure_ascii=False).encode("utf-8")
    assert len(pretty) >= len(raw)


def test_graph_runner_ai_route_node_exit_after_failed() -> None:
    doc = _doc_ai_route_two_branches()
    events: list[dict] = []

    def provider(_body: dict) -> dict:
        return {"choiceIndex": 99}

    GraphRunner(doc, sink=lambda e: events.append(e)).run(
        context={
            "last_result": True,
            "node_outputs": {"s": {"nodeType": "start"}},
            "ai_route_provider": provider,
        }
    )
    failed_i = next(i for i, e in enumerate(events) if e["type"] == "ai_route_failed")
    exit_a = [i for i, e in enumerate(events) if e["type"] == "node_exit" and e.get("nodeId") == "a"]
    assert len(exit_a) == 1
    assert failed_i < exit_a[0]


def test_graph_runner_ai_route_node_exit_after_routing() -> None:
    doc = _doc_ai_route_two_branches()
    events: list[dict] = []

    def provider(body: dict) -> dict:
        return {"choiceIndex": 1}

    GraphRunner(doc, sink=lambda e: events.append(e)).run(
        context={
            "last_result": True,
            "node_outputs": {"s": {"nodeType": "start"}},
            "ai_route_provider": provider,
        }
    )
    decided_i = next(i for i, e in enumerate(events) if e["type"] == "ai_route_decided")
    exit_a = [i for i, e in enumerate(events) if e["type"] == "node_exit" and e.get("nodeId") == "a"]
    assert len(exit_a) == 1
    assert decided_i < exit_a[0]


def test_graph_runner_ai_route_emits_events() -> None:
    doc = _doc_ai_route_two_branches()
    events: list[dict] = []

    def provider(body: dict) -> dict:
        return {"choiceIndex": 1}

    GraphRunner(doc, sink=lambda e: events.append(e)).run(
        context={
            "last_result": True,
            "node_outputs": {"s": {"nodeType": "start"}},
            "ai_route_provider": provider,
        }
    )
    types = [e["type"] for e in events]
    assert "ai_route_invoke" in types
    assert "ai_route_decided" in types
    assert "branch_skipped" in types
    skipped = [e for e in events if e["type"] == "branch_skipped"]
    assert any(s.get("reason") == "ai_route_not_selected" for s in skipped)
    decided = next(e for e in events if e["type"] == "ai_route_decided")
    assert decided["choiceIndex"] == 1
    assert decided["edgeId"] == "e1"


def test_build_ai_route_request_redacts_nested_authorization() -> None:
    doc = _doc_ai_route_two_branches()
    node = doc.nodes[1]
    out = usable_ai_route_out_edges(doc, "a")
    ctx = {
        "last_result": True,
        "node_outputs": {
            "s": {
                "nodeType": "start",
                "headers": {"authorization": "Bearer super-secret", "x-trace": "1"},
            },
        },
        "run_id": "r",
    }
    body, err = build_ai_route_request(
        doc=doc,
        node=node,
        outgoing=out,
        ctx=ctx,
        run_id="r",
        max_request_bytes=65536,
        preds=["s"],
    )
    assert err is None and body is not None
    lno = body["lastNodeOutput"]
    assert isinstance(lno, dict)
    assert lno["headers"]["authorization"] == "[redacted]"
    assert lno["headers"]["x-trace"] == "1"


def test_build_ai_route_request_too_large() -> None:
    doc = _doc_ai_route_two_branches()
    node = doc.nodes[1]
    out = usable_ai_route_out_edges(doc, "a")
    huge = {"x": "y" * 200_000}
    ctx = {"last_result": True, "node_outputs": {"s": huge}, "run_id": "r"}
    body, err = build_ai_route_request(
        doc=doc,
        node=node,
        outgoing=out,
        ctx=ctx,
        run_id="r",
        max_request_bytes=1,
        preds=["s"],
    )
    assert body is None and err == "request_too_large"


def test_edge_json_roundtrip_data() -> None:
    raw = {
        "schemaVersion": 1,
        "meta": {"graphId": "g-edge", "schemaVersion": 1},
        "nodes": [{"id": "n1", "type": "task", "position": {"x": 0, "y": 0}, "data": {}}],
        "edges": [
            {
                "id": "e1",
                "source": "a",
                "target": "n1",
                "data": {"routeDescription": "hello"},
            }
        ],
    }
    doc = GraphDocument.from_dict(raw)
    assert doc.edges[0].data is not None
    assert doc.edges[0].data.get("routeDescription") == "hello"
