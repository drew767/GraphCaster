# Copyright GraphCaster. All Rights Reserved.

"""Tests for ToolRegistry and default built-in tool registration (F64)."""

from __future__ import annotations

import pytest

from graph_caster.tools.registry import ToolRegistry, ToolSpec, get_default_registry


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _noop(**kwargs):
    return None


def _make_spec(name: str = "my_tool") -> ToolSpec:
    return ToolSpec(
        name=name,
        display_name="My Tool",
        description="A test tool.",
        parameters={"type": "object", "properties": {}},
        callable=_noop,
    )


# ---------------------------------------------------------------------------
# Register / get / list round-trip
# ---------------------------------------------------------------------------

class TestToolRegistry:
    def test_register_and_get(self):
        reg = ToolRegistry()
        spec = _make_spec("echo")
        reg.register(spec)
        assert reg.get("echo") is spec

    def test_get_unknown_returns_none(self):
        reg = ToolRegistry()
        assert reg.get("does_not_exist") is None

    def test_list_empty(self):
        reg = ToolRegistry()
        assert reg.list() == []

    def test_list_after_register(self):
        reg = ToolRegistry()
        spec_a = _make_spec("alpha")
        spec_b = _make_spec("beta")
        reg.register(spec_a)
        reg.register(spec_b)
        names = {s.name for s in reg.list()}
        assert names == {"alpha", "beta"}

    def test_overwrite(self):
        reg = ToolRegistry()
        spec1 = _make_spec("x")
        spec2 = _make_spec("x")
        reg.register(spec1)
        reg.register(spec2)
        assert reg.get("x") is spec2
        assert len(reg.list()) == 1


# ---------------------------------------------------------------------------
# Default registry has all 10 builtins
# ---------------------------------------------------------------------------

_EXPECTED_BUILTINS = {
    "wikipedia_search",
    "web_search",
    "calc",
    "http_get",
    "time_now",
    "regex_extract",
    "json_parse",
    "b64_encode",
    "b64_decode",
    "uuid_new",
    "weather",
}


class TestDefaultRegistry:
    def test_has_all_builtins(self):
        reg = get_default_registry()
        names = {s.name for s in reg.list()}
        assert _EXPECTED_BUILTINS.issubset(names), (
            f"Missing builtins: {_EXPECTED_BUILTINS - names}"
        )

    def test_builtin_specs_have_callable(self):
        reg = get_default_registry()
        for spec in reg.list():
            assert callable(spec.callable), f"{spec.name}.callable is not callable"

    def test_builtin_specs_have_parameters(self):
        reg = get_default_registry()
        for spec in reg.list():
            assert isinstance(spec.parameters, dict), f"{spec.name}.parameters must be a dict"
            assert spec.parameters.get("type") == "object", (
                f"{spec.name}.parameters must be a JSON Schema object"
            )

    def test_unknown_returns_none(self):
        reg = get_default_registry()
        assert reg.get("__totally_unknown__") is None

    def test_singleton_is_same_instance(self):
        assert get_default_registry() is get_default_registry()
