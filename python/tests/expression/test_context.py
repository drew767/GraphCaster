# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.expression import ExpressionContext


class TestExpressionContext:
    def test_build_from_run_state(self) -> None:
        node_outputs = {
            "Task1": {"result": "success", "data": [1, 2, 3]},
            "Task2": {"error": None, "code": 0},
        }
        ctx = ExpressionContext.from_run_state(
            current_node_id="Task3",
            node_outputs=node_outputs,
        )
        assert ctx["json"] == {}
        assert ctx["nodes"]["Task1"]["json"]["result"] == "success"
        assert ctx["nodes"]["Task2"]["json"]["code"] == 0

    def test_build_with_input_data(self) -> None:
        ctx = ExpressionContext.from_run_state(
            current_node_id="Node1",
            node_outputs={},
            input_data={"message": "hello"},
        )
        assert ctx["json"]["message"] == "hello"

    def test_build_with_env(self) -> None:
        ctx = ExpressionContext.from_run_state(
            current_node_id="Node1",
            node_outputs={},
            env={"API_KEY": "secret123"},
        )
        assert ctx["env"]["API_KEY"] == "secret123"

    def test_build_with_item_context(self) -> None:
        ctx = ExpressionContext.from_run_state(
            current_node_id="Node1",
            node_outputs={},
            item={"index": 5, "value": "test"},
        )
        assert ctx["item"] is not None
        assert ctx["item"]["index"] == 5
        assert ctx["item"]["value"] == "test"

    def test_build_with_run_metadata(self) -> None:
        ctx = ExpressionContext.from_run_state(
            current_node_id="Node1",
            node_outputs={},
            run_id="run-123",
            graph_id="graph-456",
        )
        assert ctx["run"]["id"] == "run-123"
        assert ctx["run"]["graph_id"] == "graph-456"

    def test_context_is_immutable_copy(self) -> None:
        node_outputs: dict[str, dict[str, int]] = {"Task1": {"value": 1}}
        ctx = ExpressionContext.from_run_state(
            current_node_id="Task2",
            node_outputs=node_outputs,
        )
        node_outputs["Task1"]["value"] = 999
        assert ctx["nodes"]["Task1"]["json"]["value"] == 1
