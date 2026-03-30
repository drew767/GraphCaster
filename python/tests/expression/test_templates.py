# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.expression import ExpressionContext
from graph_caster.expression.templates import render_template


class TestTemplateRendering:
    def test_render_simple_substitution(self) -> None:
        ctx = ExpressionContext.from_run_state(
            current_node_id="Node1",
            node_outputs={},
            input_data={"name": "Alice"},
        )
        assert render_template("Hello, {{ $json.name }}!", ctx) == "Hello, Alice!"

    def test_render_node_reference(self) -> None:
        ctx = ExpressionContext.from_run_state(
            current_node_id="Node2",
            node_outputs={"Task1": {"message": "World"}},
        )
        assert (
            render_template('Greeting: {{ $node["Task1"].json.message }}', ctx) == "Greeting: World"
        )

    def test_render_expression_in_template(self) -> None:
        ctx = ExpressionContext.from_run_state(
            current_node_id="Node1",
            node_outputs={},
            input_data={"count": 5},
        )
        assert render_template("Count is {{ $json.count * 2 }}", ctx) == "Count is 10"

    def test_render_multiple_expressions(self) -> None:
        ctx = ExpressionContext.from_run_state(
            current_node_id="Node1",
            node_outputs={},
            input_data={"first": "John", "last": "Doe"},
        )
        assert render_template("{{ $json.first }} {{ $json.last }}", ctx) == "John Doe"

    def test_render_with_function(self) -> None:
        ctx = ExpressionContext.from_run_state(
            current_node_id="Node1",
            node_outputs={},
            input_data={"name": "alice"},
        )
        assert render_template("Name: {{ upper($json.name) }}", ctx) == "Name: ALICE"

    def test_render_preserves_non_template_text(self) -> None:
        ctx = ExpressionContext.empty()
        assert render_template("No expressions here", ctx) == "No expressions here"

    def test_render_handles_missing_variable_gracefully(self) -> None:
        ctx = ExpressionContext.empty()
        assert "Value:" in render_template("Value: {{ $json.missing }}", ctx)

    def test_render_dollar_brace_syntax(self) -> None:
        ctx = ExpressionContext.from_run_state(
            current_node_id="Node1",
            node_outputs={},
            input_data={"value": 42},
        )
        assert render_template("Answer: ${{ $json.value }}", ctx) == "Answer: 42"
