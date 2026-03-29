# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.errors import ErrorCode
from graph_caster.models import GraphDocument, Node
from graph_caster.runtime_validate import first_runtime_node_blocker


def test_allows_task_without_command_or_preset() -> None:
    """Bare tasks fail at execute-time (legacy / docs examples), not before ``run_started``."""
    doc = GraphDocument(
        schema_version=1,
        graph_id="g",
        title="t",
        nodes=[
            Node(id="start", type="start", data={}, position={"x": 0.0, "y": 0.0}),
            Node(id="bad", type="task", data={"title": "x"}, position={"x": 0.0, "y": 0.0}),
        ],
        edges=[],
    )
    assert first_runtime_node_blocker(doc) is None


def test_blocks_malformed_gc_cursor_agent_preset_version() -> None:
    doc = GraphDocument(
        schema_version=1,
        graph_id="g",
        title="t",
        nodes=[
            Node(id="start", type="start", data={}, position={"x": 0.0, "y": 0.0}),
            Node(
                id="t",
                type="task",
                data={"gcCursorAgent": {"presetVersion": 99, "prompt": "x"}},
                position={"x": 0.0, "y": 0.0},
            ),
        ],
        edges=[],
    )
    b = first_runtime_node_blocker(doc)
    assert b is not None
    code, nid, _msg = b
    assert code == ErrorCode.GC2002
    assert nid == "t"


def test_allows_task_with_argv() -> None:
    doc = GraphDocument(
        schema_version=1,
        graph_id="g",
        title="t",
        nodes=[
            Node(id="start", type="start", data={}, position={"x": 0.0, "y": 0.0}),
            Node(
                id="ok",
                type="task",
                data={"argv": ["python", "-c", "print(1)"]},
                position={"x": 0.0, "y": 0.0},
            ),
        ],
        edges=[],
    )
    assert first_runtime_node_blocker(doc) is None
