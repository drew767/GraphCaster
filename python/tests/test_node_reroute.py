# Copyright GraphCaster. All Rights Reserved.

"""Tests for the Reroute node (F74)."""

from __future__ import annotations

import asyncio
import importlib

import pytest


def _load_reroute():
    mod = importlib.import_module("graph_caster.nodes.reroute")
    return mod.RerouteNode


class TestRerouteNodeClass:
    def test_type_attribute(self):
        RerouteNode = _load_reroute()
        assert RerouteNode.type == "reroute"

    def test_display_name(self):
        RerouteNode = _load_reroute()
        assert RerouteNode.display_name == "Reroute"

    def test_category(self):
        RerouteNode = _load_reroute()
        assert RerouteNode.category == "flow"

    def test_has_one_input_named_input(self):
        RerouteNode = _load_reroute()
        assert len(RerouteNode.inputs) == 1
        assert RerouteNode.inputs[0].name == "input"

    def test_has_one_output_named_output(self):
        RerouteNode = _load_reroute()
        assert len(RerouteNode.outputs) == 1
        assert RerouteNode.outputs[0].name == "output"

    def test_run_passes_value_unchanged(self):
        RerouteNode = _load_reroute()
        node = RerouteNode()
        result = asyncio.run(node.run(ctx=None, input={"key": "value"}))
        assert result == {"output": {"key": "value"}}

    def test_run_passes_none_when_no_input(self):
        RerouteNode = _load_reroute()
        node = RerouteNode()
        result = asyncio.run(node.run(ctx=None))
        assert result == {"output": None}

    def test_run_passes_string_unchanged(self):
        RerouteNode = _load_reroute()
        node = RerouteNode()
        result = asyncio.run(node.run(ctx=None, input="hello"))
        assert result == {"output": "hello"}

    def test_run_passes_list_unchanged(self):
        RerouteNode = _load_reroute()
        node = RerouteNode()
        payload = [1, 2, 3]
        result = asyncio.run(node.run(ctx=None, input=payload))
        assert result["output"] is payload

    def test_registered_in_node_api_registry(self):
        _load_reroute()
        from graph_caster.node_api.registry import get_registered
        cls = get_registered("reroute", 1.0)
        assert cls is not None
        assert cls.type == "reroute"
