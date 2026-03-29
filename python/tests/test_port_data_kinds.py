# Copyright GraphCaster. All Rights Reserved.

from graph_caster.handle_contract import HANDLE_IN_DEFAULT, HANDLE_OUT_DEFAULT, HANDLE_OUT_ERROR
from graph_caster.models import Edge, GraphDocument, Node
from graph_caster.port_data_kinds import (
    classify_port_kind_pair,
    coerce_port_kind_override,
    find_port_data_kind_warnings,
    port_data_kind_for_source,
    port_data_kind_for_target,
)


def _doc(edges: list[Edge]) -> GraphDocument:
    return GraphDocument(
        schema_version=1,
        graph_id="ffffffff-ffff-4fff-8fff-ffffffffffff",
        title="t",
        nodes=[
            Node(id="start1", type="start", position={"x": 0, "y": 0}, data={}),
            Node(id="t1", type="task", position={"x": 0, "y": 0}, data={"command": "echo"}),
            Node(id="exit1", type="exit", position={"x": 0, "y": 0}, data={}),
        ],
        edges=edges,
    )


def test_port_kinds_main_flow_json() -> None:
    assert port_data_kind_for_source("start", HANDLE_OUT_DEFAULT) == "json"
    assert port_data_kind_for_target("task", HANDLE_IN_DEFAULT) == "json"
    assert port_data_kind_for_source("task", HANDLE_OUT_ERROR) == "any"


def test_classify_matrix() -> None:
    assert classify_port_kind_pair("any", "json") == "ok"
    assert classify_port_kind_pair("json", "json") == "ok"
    assert classify_port_kind_pair("json", "primitive") == "warn"
    assert classify_port_kind_pair("primitive", "json") == "warn"


def test_coerce_port_kind_override() -> None:
    assert coerce_port_kind_override(None) is None
    assert coerce_port_kind_override("json") == "json"
    assert coerce_port_kind_override("  primitive  ") == "primitive"
    assert coerce_port_kind_override("bogus") is None
    assert coerce_port_kind_override(1) is None


def test_find_warnings_skips_invalid_handles() -> None:
    doc = _doc(
        [
            Edge(
                id="e0",
                source="start1",
                target="t1",
                source_handle="out_error",
                target_handle=HANDLE_IN_DEFAULT,
                condition=None,
            )
        ]
    )
    assert find_port_data_kind_warnings(doc) == []


def test_find_warnings_json_to_primitive(monkeypatch) -> None:
    from graph_caster.port_data_kinds import port_data_kind_for_target as real_target

    def fake_target(node_type: str, handle: str):
        if node_type == "task" and handle == HANDLE_IN_DEFAULT:
            return "primitive"
        return real_target(node_type, handle)

    monkeypatch.setattr("graph_caster.port_data_kinds.port_data_kind_for_target", fake_target)
    doc = _doc(
        [
            Edge(
                id="e1",
                source="start1",
                target="t1",
                source_handle=HANDLE_OUT_DEFAULT,
                target_handle=HANDLE_IN_DEFAULT,
                condition=None,
            )
        ]
    )
    w = find_port_data_kind_warnings(doc)
    assert len(w) == 1
    assert w[0]["kind"] == "port_data_kind_mismatch"
    assert w[0]["sourceKind"] == "json"
    assert w[0]["targetKind"] == "primitive"


def test_find_warnings_edge_override_clears_mismatch(monkeypatch) -> None:
    from graph_caster.port_data_kinds import port_data_kind_for_target as real_target

    def fake_target(node_type: str, handle: str):
        if node_type == "task" and handle == HANDLE_IN_DEFAULT:
            return "primitive"
        return real_target(node_type, handle)

    monkeypatch.setattr("graph_caster.port_data_kinds.port_data_kind_for_target", fake_target)
    doc = _doc(
        [
            Edge(
                id="e1",
                source="start1",
                target="t1",
                source_handle=HANDLE_OUT_DEFAULT,
                target_handle=HANDLE_IN_DEFAULT,
                condition=None,
                data={"targetPortKind": "json"},
            )
        ]
    )
    assert find_port_data_kind_warnings(doc) == []


def test_find_warnings_invalid_override_ignored(monkeypatch) -> None:
    from graph_caster.port_data_kinds import port_data_kind_for_target as real_target

    def fake_target(node_type: str, handle: str):
        if node_type == "task" and handle == HANDLE_IN_DEFAULT:
            return "primitive"
        return real_target(node_type, handle)

    monkeypatch.setattr("graph_caster.port_data_kinds.port_data_kind_for_target", fake_target)
    doc = _doc(
        [
            Edge(
                id="e1",
                source="start1",
                target="t1",
                source_handle=HANDLE_OUT_DEFAULT,
                target_handle=HANDLE_IN_DEFAULT,
                condition=None,
                data={"targetPortKind": "not-a-kind"},
            )
        ]
    )
    w = find_port_data_kind_warnings(doc)
    assert len(w) == 1
    assert w[0]["kind"] == "port_data_kind_mismatch"


def test_find_warnings_override_introduces_mismatch() -> None:
    """Registry says json→json ok; edge data forces target effective kind to primitive."""
    doc = _doc(
        [
            Edge(
                id="e1",
                source="start1",
                target="t1",
                source_handle=HANDLE_OUT_DEFAULT,
                target_handle=HANDLE_IN_DEFAULT,
                condition=None,
                data={"targetPortKind": "primitive"},
            )
        ]
    )
    w = find_port_data_kind_warnings(doc)
    assert len(w) == 1
    assert w[0]["kind"] == "port_data_kind_mismatch"
    assert w[0]["sourceKind"] == "json"
    assert w[0]["targetKind"] == "primitive"


def test_find_warnings_skips_comment_edge() -> None:
    doc = GraphDocument(
        schema_version=1,
        graph_id="ffffffff-ffff-4fff-8fff-ffffffffffff",
        title="t",
        nodes=[
            Node(id="start1", type="start", position={"x": 0, "y": 0}, data={}),
            Node(id="c1", type="comment", position={"x": 0, "y": 0}, data={}),
        ],
        edges=[
            Edge(
                id="ec",
                source="start1",
                target="c1",
                source_handle=HANDLE_OUT_DEFAULT,
                target_handle=HANDLE_IN_DEFAULT,
                condition=None,
            )
        ],
    )
    assert find_port_data_kind_warnings(doc) == []
