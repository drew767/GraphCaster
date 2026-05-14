# Copyright GraphCaster. All Rights Reserved.

"""UX127b/UX128b — node mode (bypass / mute / disabled) runtime tests."""

from __future__ import annotations

from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner


def _three_node_graph(
    middle_mode: str = "normal",
    *,
    legacy_disabled: bool = False,
) -> GraphDocument:
    """start → middle → exit, with ``middle.mode`` set as requested."""
    middle_node: dict = {
        "id": "middle",
        "type": "task",
        "position": {"x": 100, "y": 0},
        "data": {},
    }
    if middle_mode != "normal":
        middle_node["mode"] = middle_mode
    if legacy_disabled:
        middle_node["data"]["disabled"] = True
    return GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": "test-modes", "title": "modes"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                middle_node,
                {"id": "x", "type": "exit", "position": {"x": 200, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e1",
                    "source": "s",
                    "sourceHandle": "out_default",
                    "target": "middle",
                    "targetHandle": "in_default",
                },
                {
                    "id": "e2",
                    "source": "middle",
                    "sourceHandle": "out_default",
                    "target": "x",
                    "targetHandle": "in_default",
                },
            ],
        }
    )


def _types(events: list[dict]) -> list[str]:
    return [e["type"] for e in events]


def test_normal_mode_executes_middle_and_reaches_exit() -> None:
    doc = _three_node_graph(middle_mode="normal")
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    types = _types(events)
    assert "node_skipped" not in types
    assert "node_bypassed" not in types
    assert "run_success" in types


def test_bypass_emits_event_and_continues_to_exit() -> None:
    doc = _three_node_graph(middle_mode="bypass")
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    types = _types(events)
    assert "node_bypassed" in types
    bypassed = next(e for e in events if e["type"] == "node_bypassed")
    assert bypassed["nodeId"] == "middle"
    # Pass-through is True because there is exactly one upstream (start) with stored output.
    assert bypassed["passThrough"] is True
    assert "run_success" in types
    # Exit must have fired.
    assert any(e["type"] == "run_success" and e.get("nodeId") == "x" for e in events)


def test_mute_emits_skipped_and_blocks_downstream() -> None:
    doc = _three_node_graph(middle_mode="mute")
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    types = _types(events)
    assert "node_skipped" in types
    skipped = next(e for e in events if e["type"] == "node_skipped")
    assert skipped["nodeId"] == "middle"
    assert skipped["mode"] == "mute"
    # Exit must NOT have been visited because mute blocks downstream traversal.
    assert not any(e["type"] == "node_enter" and e.get("nodeId") == "x" for e in events)


def test_disabled_mode_behaves_as_mute() -> None:
    doc = _three_node_graph(middle_mode="disabled")
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    types = _types(events)
    assert "node_skipped" in types
    assert not any(e["type"] == "node_enter" and e.get("nodeId") == "x" for e in events)


def test_legacy_data_disabled_bool_maps_to_mute_via_from_dict() -> None:
    """Legacy graphs with ``data.disabled: true`` migrate to ``mode='mute'`` on load."""
    doc = _three_node_graph(legacy_disabled=True)
    middle = next(n for n in doc.nodes if n.id == "middle")
    assert middle.mode == "mute"
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    assert any(e["type"] == "node_skipped" for e in events)


def test_node_mode_default_is_normal() -> None:
    doc = _three_node_graph(middle_mode="normal")
    middle = next(n for n in doc.nodes if n.id == "middle")
    assert middle.mode == "normal"


def test_invalid_mode_string_falls_back_to_normal() -> None:
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": "g"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {
                    "id": "n",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {},
                    "mode": "ridiculous",
                }
            ],
            "edges": [],
        }
    )
    assert doc.nodes[0].mode == "normal"
