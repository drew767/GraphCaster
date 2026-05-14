# Copyright GraphCaster. All Rights Reserved.

"""Tests for the declarative node API (F95): GraphCasterNode, fields, schema_gen, registry."""

from __future__ import annotations

import asyncio
from typing import Any, ClassVar

import pytest

from graph_caster.node_api import (
    GraphCasterNode,
    Input,
    Output,
    node_data_schema,
    register_class,
    get_registered,
)
from graph_caster.node_api.schema_gen import _field_type_schema


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class MyAddNode(GraphCasterNode):
    type: ClassVar[str] = "my_add"
    display_name: ClassVar[str] = "Add"
    inputs: ClassVar[list[Input]] = [
        Input("a", int, required=True),
        Input("b", int, default=0),
    ]
    outputs: ClassVar[list[Output]] = [Output("sum", int)]

    async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
        return {"sum": kwargs["a"] + kwargs.get("b", 0)}


# ---------------------------------------------------------------------------
# Field type mapping
# ---------------------------------------------------------------------------

class TestFieldTypeSchema:
    def test_str(self):
        assert _field_type_schema(str) == {"type": "string"}

    def test_int(self):
        assert _field_type_schema(int) == {"type": "integer"}

    def test_float(self):
        assert _field_type_schema(float) == {"type": "number"}

    def test_bool(self):
        assert _field_type_schema(bool) == {"type": "boolean"}

    def test_json_literal(self):
        assert _field_type_schema("json") == {}

    def test_secret_literal(self):
        assert _field_type_schema("secret") == {"type": "string"}

    def test_list_str(self):
        result = _field_type_schema("list[str]")
        assert result == {"type": "array", "items": {"type": "string"}}

    def test_unknown_returns_empty(self):
        assert _field_type_schema("unknown_custom_type") == {}


# ---------------------------------------------------------------------------
# Schema generation
# ---------------------------------------------------------------------------

class TestNodeDataSchema:
    def test_my_add_node_required(self):
        schema = node_data_schema(MyAddNode)
        assert schema["type"] == "object"
        assert "a" in schema["properties"]
        assert "b" in schema["properties"]
        assert schema["required"] == ["a"]

    def test_my_add_node_types(self):
        schema = node_data_schema(MyAddNode)
        assert schema["properties"]["a"] == {"type": "integer"}
        assert schema["properties"]["b"] == {"type": "integer"}

    def test_no_required_when_all_optional(self):
        class AllOptional(GraphCasterNode):
            type: ClassVar[str] = "_test_all_optional"
            inputs: ClassVar[list[Input]] = [Input("x", str)]
            outputs: ClassVar[list[Output]] = []

            async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
                return {}

        schema = node_data_schema(AllOptional)
        assert "required" not in schema

    def test_options_become_enum(self):
        class WithOptions(GraphCasterNode):
            type: ClassVar[str] = "_test_options"
            inputs: ClassVar[list[Input]] = [
                Input("mode", str, options=["a", "b", "c"])
            ]
            outputs: ClassVar[list[Output]] = []

            async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
                return {}

        schema = node_data_schema(WithOptions)
        assert schema["properties"]["mode"]["enum"] == ["a", "b", "c"]

    def test_range_adds_minimum_maximum(self):
        class WithRange(GraphCasterNode):
            type: ClassVar[str] = "_test_range"
            inputs: ClassVar[list[Input]] = [
                Input("level", float, range=(0.0, 1.0))
            ]
            outputs: ClassVar[list[Output]] = []

            async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
                return {}

        schema = node_data_schema(WithRange)
        prop = schema["properties"]["level"]
        assert prop["minimum"] == 0.0
        assert prop["maximum"] == 1.0

    def test_multiline_adds_keyword(self):
        class WithMultiline(GraphCasterNode):
            type: ClassVar[str] = "_test_multiline"
            inputs: ClassVar[list[Input]] = [
                Input("body", str, multiline=True)
            ]
            outputs: ClassVar[list[Output]] = []

            async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
                return {}

        schema = node_data_schema(WithMultiline)
        assert schema["properties"]["body"].get("x-multiline") is True

    def test_schema_classmethod_delegates_to_schema_gen(self):
        schema = MyAddNode.schema()
        assert schema == node_data_schema(MyAddNode)


# ---------------------------------------------------------------------------
# run() execution
# ---------------------------------------------------------------------------

class TestNodeRun:
    def test_run_add_kwargs(self):
        node = MyAddNode()
        result = asyncio.run(node.run(None, a=3, b=4))
        assert result == {"sum": 7}

    def test_run_add_default_b(self):
        node = MyAddNode()
        result = asyncio.run(node.run(None, a=10))
        assert result == {"sum": 10}

    def test_run_returns_dict(self):
        node = MyAddNode()
        result = asyncio.run(node.run(None, a=1, b=2))
        assert isinstance(result, dict)


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

class TestRegistry:
    def test_register_and_retrieve(self):
        class _RegNode(GraphCasterNode):
            type: ClassVar[str] = "_test_reg_retrieve"
            inputs: ClassVar[list[Input]] = []
            outputs: ClassVar[list[Output]] = []

            async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
                return {}

        register_class(_RegNode)
        assert get_registered("_test_reg_retrieve") is _RegNode

    def test_register_rejects_missing_type(self):
        class _NoType(GraphCasterNode):
            inputs: ClassVar[list[Input]] = []
            outputs: ClassVar[list[Output]] = []

            async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
                return {}

        with pytest.raises((ValueError, AttributeError)):
            register_class(_NoType)

    def test_register_rejects_duplicate_input_names(self):
        class _DupInputs(GraphCasterNode):
            type: ClassVar[str] = "_test_dup_inputs"
            inputs: ClassVar[list[Input]] = [
                Input("x", str),
                Input("x", int),
            ]
            outputs: ClassVar[list[Output]] = []

            async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
                return {}

        with pytest.raises(ValueError, match="duplicate input"):
            register_class(_DupInputs)

    def test_register_rejects_duplicate_output_names(self):
        class _DupOutputs(GraphCasterNode):
            type: ClassVar[str] = "_test_dup_outputs"
            inputs: ClassVar[list[Input]] = []
            outputs: ClassVar[list[Output]] = [
                Output("y", str),
                Output("y", int),
            ]

            async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
                return {}

        with pytest.raises(ValueError, match="duplicate output"):
            register_class(_DupOutputs)


# ---------------------------------------------------------------------------
# Reference port: CommentNode
# ---------------------------------------------------------------------------

class TestCommentNodePort:
    def test_comment_node_registered(self):
        import graph_caster.node_api.builtin_nodes  # ensure side-effects run
        assert get_registered("comment") is not None

    def test_comment_node_run_returns_empty(self):
        from graph_caster.node_api.builtin_nodes import CommentNode

        node = CommentNode()
        result = asyncio.run(node.run(None, text="hello"))
        assert result == {}

    def test_comment_node_schema(self):
        from graph_caster.node_api.builtin_nodes import CommentNode

        schema = CommentNode.schema()
        assert "text" in schema["properties"]
        assert schema["properties"]["text"].get("x-multiline") is True
        assert "required" not in schema

    def test_comment_node_no_outputs(self):
        from graph_caster.node_api.builtin_nodes import CommentNode

        assert CommentNode.outputs == []

    def test_comment_identical_to_runner_behavior(self):
        """CommentNode.run() returns {} — matches runner which simply skips comment nodes."""
        from graph_caster.node_api.builtin_nodes import CommentNode

        node = CommentNode()
        result = asyncio.run(node.run(None))
        assert result == {}


# ---------------------------------------------------------------------------
# Top-level __init__ exports
# ---------------------------------------------------------------------------

class TestTopLevelExports:
    def test_graph_caster_exports_node_api(self):
        import graph_caster

        assert hasattr(graph_caster, "GraphCasterNode")
        assert hasattr(graph_caster, "Input")
        assert hasattr(graph_caster, "Output")
        assert hasattr(graph_caster, "NodeContext")
