# Copyright GraphCaster. All Rights Reserved.

"""Tests for F47 versioned node-type registry."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from graph_caster.node_registry import (
    NodeRegistry,
    UnknownNodeType,
    UnknownNodeVersion,
    _BUILTIN_SENTINEL,
    _BUILTIN_V1_TYPES,
    get_default_registry,
    reset_default_registry,
)
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def registry() -> NodeRegistry:
    """Return a fresh empty registry for each test."""
    return NodeRegistry()


def _make_handler(name: str):
    def handler(*args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        return name
    handler.__name__ = name
    return handler


# ---------------------------------------------------------------------------
# Registration basics
# ---------------------------------------------------------------------------


def test_register_and_resolve_exact(registry: NodeRegistry) -> None:
    h1 = _make_handler("task_v1")
    h2 = _make_handler("task_v2")
    registry.register("task", 1, h1, default=True)
    registry.register("task", 2, h2, default=True)

    assert registry.resolve("task", 1) is h1
    assert registry.resolve("task", 2) is h2


def test_resolve_none_returns_default(registry: NodeRegistry) -> None:
    h1 = _make_handler("task_v1")
    h2 = _make_handler("task_v2")
    registry.register("task", 1, h1)
    registry.register("task", 2, h2, default=True)

    assert registry.resolve("task", None) is h2


def test_resolve_none_auto_latest_when_no_explicit_default(registry: NodeRegistry) -> None:
    h1 = _make_handler("h1")
    h2 = _make_handler("h2")
    registry.register("task", 1, h1)
    registry.register("task", 2, h2)

    # No explicit default — should use highest version.
    assert registry.resolve("task", None) is h2


# ---------------------------------------------------------------------------
# Fallback (nearest lower version)
# ---------------------------------------------------------------------------


def test_missing_version_falls_back_to_nearest_lower(registry: NodeRegistry) -> None:
    h1 = _make_handler("task_v1")
    registry.register("task", 1, h1, default=True)

    # Request v1.5 — falls back to v1.
    fallback_calls: list[tuple] = []
    registry.set_fallback_listener(lambda t, req, used: fallback_calls.append((t, req, used)))

    result = registry.resolve("task", 1.5)
    assert result is h1
    assert len(fallback_calls) == 1
    assert fallback_calls[0] == ("task", 1.5, 1.0)


def test_missing_version_fallback_warning_event_emitted(registry: NodeRegistry) -> None:
    h1 = _make_handler("task_v1")
    h2 = _make_handler("task_v2")
    registry.register("task", 1, h1, default=True)
    registry.register("task", 2, h2)

    fallback_calls: list[tuple] = []
    registry.set_fallback_listener(lambda t, req, used: fallback_calls.append((t, req, used)))

    # Request v1.5 — falls back to v1 (not v2, which is higher).
    result = registry.resolve("task", 1.5)
    assert result is h1
    assert fallback_calls == [("task", 1.5, 1.0)]


def test_no_lower_version_raises(registry: NodeRegistry) -> None:
    h2 = _make_handler("task_v2")
    registry.register("task", 2, h2, default=True)

    with pytest.raises(UnknownNodeVersion):
        registry.resolve("task", 1)


def test_unknown_type_raises(registry: NodeRegistry) -> None:
    with pytest.raises(UnknownNodeType):
        registry.resolve("nonexistent_type", None)


def test_unknown_type_raises_for_explicit_version(registry: NodeRegistry) -> None:
    with pytest.raises(UnknownNodeType):
        registry.resolve("nonexistent_type", 1)


# ---------------------------------------------------------------------------
# latest_version
# ---------------------------------------------------------------------------


def test_latest_version(registry: NodeRegistry) -> None:
    registry.register("task", 1, _make_handler("h1"))
    registry.register("task", 2, _make_handler("h2"))
    registry.register("task", 2.1, _make_handler("h21"))

    assert registry.latest_version("task") == 2.1


def test_latest_version_unknown_raises(registry: NodeRegistry) -> None:
    with pytest.raises(UnknownNodeType):
        registry.latest_version("nope")


# ---------------------------------------------------------------------------
# Two versions registered — round-trip
# ---------------------------------------------------------------------------


def test_two_versions_round_trip(registry: NodeRegistry) -> None:
    h1 = _make_handler("task_v1")
    h2 = _make_handler("task_v2")
    registry.register("task", 1, h1, default=True)
    registry.register("task", 2, h2)

    assert registry.resolve("task", 1) is h1
    assert registry.resolve("task", 2) is h2
    assert registry.resolve("task", None) is h1  # default is v1


def test_override_default_to_latest(registry: NodeRegistry) -> None:
    h1 = _make_handler("task_v1")
    h2 = _make_handler("task_v2")
    registry.register("task", 1, h1, default=True)
    registry.register("task", 2, h2, default=True)  # override default

    assert registry.resolve("task", None) is h2


# ---------------------------------------------------------------------------
# Version validation
# ---------------------------------------------------------------------------


def test_register_version_below_1_raises(registry: NodeRegistry) -> None:
    with pytest.raises(ValueError):
        registry.register("task", 0, _make_handler("h"))


def test_register_non_callable_raises(registry: NodeRegistry) -> None:
    with pytest.raises(TypeError):
        registry.register("task", 1, "not_callable")  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Introspection helpers
# ---------------------------------------------------------------------------


def test_has_type(registry: NodeRegistry) -> None:
    assert not registry.has_type("task")
    registry.register("task", 1, _make_handler("h"))
    assert registry.has_type("task")


def test_registered_versions(registry: NodeRegistry) -> None:
    registry.register("task", 1, _make_handler("h1"))
    registry.register("task", 2, _make_handler("h2"))
    assert registry.registered_versions("task") == [1.0, 2.0]


def test_all_types(registry: NodeRegistry) -> None:
    registry.register("task", 1, _make_handler("h1"))
    registry.register("llm_agent", 1, _make_handler("h2"))
    assert registry.all_types() == ["llm_agent", "task"]


# ---------------------------------------------------------------------------
# Default module-level registry
# ---------------------------------------------------------------------------


def test_default_registry_has_builtin_types() -> None:
    reset_default_registry()
    reg = get_default_registry()
    for t in _BUILTIN_V1_TYPES:
        assert reg.has_type(t), f"Expected built-in type {t!r} in default registry"
        assert reg.resolve(t, 1) is _BUILTIN_SENTINEL


def test_default_registry_singleton() -> None:
    reset_default_registry()
    r1 = get_default_registry()
    r2 = get_default_registry()
    assert r1 is r2


def test_reset_default_registry() -> None:
    reset_default_registry()
    r1 = get_default_registry()
    reset_default_registry()
    r2 = get_default_registry()
    assert r1 is not r2


# ---------------------------------------------------------------------------
# Runner integration: node_version_fallback event emitted
# ---------------------------------------------------------------------------


def _make_simple_graph(task_type_version: float | None = None) -> GraphDocument:
    task_data: dict = {"command": "echo hi"}
    if task_type_version is not None:
        task_data["typeVersion"] = task_type_version  # type: ignore[assignment]

    # typeVersion lives on the node, not data — use raw JSON to test schema path.
    # But GraphDocument.from_dict reads data from node.data; typeVersion in data
    # is what the runner reads.  We put typeVersion in data for runner lookup.
    raw = {
        "schemaVersion": 1,
        "meta": {
            "schemaVersion": 1,
            "graphId": "ffffffff-ffff-4fff-8fff-ffffffffffff",
            "title": "registry test",
        },
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "t",
                "type": "task",
                "position": {"x": 100, "y": 0},
                "data": task_data,
            },
            {"id": "ex", "type": "exit", "position": {"x": 200, "y": 0}, "data": {}},
        ],
        "edges": [
            {"id": "e1", "source": "s", "target": "t"},
            {"id": "e2", "source": "t", "target": "ex", "condition": "true"},
        ],
    }
    return GraphDocument.from_dict(raw)


def test_runner_no_version_no_fallback_event() -> None:
    """Nodes without typeVersion produce no node_version_fallback events."""
    doc = _make_simple_graph(task_type_version=None)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    fallbacks = [e for e in events if e.get("type") == "node_version_fallback"]
    assert fallbacks == []


def test_runner_exact_version_no_fallback_event() -> None:
    """Nodes with typeVersion=1 resolve exactly — no fallback event."""
    doc = _make_simple_graph(task_type_version=1)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    fallbacks = [e for e in events if e.get("type") == "node_version_fallback"]
    assert fallbacks == []


def test_runner_missing_version_fallback_event() -> None:
    """Nodes with typeVersion=1.5 (no exact match) produce node_version_fallback."""
    doc = _make_simple_graph(task_type_version=1.5)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    fallbacks = [e for e in events if e.get("type") == "node_version_fallback"]
    assert len(fallbacks) == 1
    fb = fallbacks[0]
    assert fb["nodeType"] == "task"
    assert fb["requestedVersion"] == 1.5
    assert fb["usedVersion"] == 1.0


# ---------------------------------------------------------------------------
# Existing fixture-based runner tests still pass (sanity check via example)
# ---------------------------------------------------------------------------


def test_existing_runner_example_still_works() -> None:
    example_path = GRAPH_CASTER_ROOT / "schemas" / "graph-document.example.json"
    raw = json.loads(example_path.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    types = [e["type"] for e in events]
    assert "run_success" in types
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "success"
