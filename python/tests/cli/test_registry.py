"""Tests for the cli subcommand registry."""
from __future__ import annotations

from importlib import import_module

import pytest

from graph_caster.__main__ import _SUBCOMMANDS
from graph_caster.cli._registry import _COMMAND_MODULES, build_parser


def test_every_subcommand_has_a_module():
    missing = sorted(_SUBCOMMANDS - set(_COMMAND_MODULES.keys()))
    assert not missing, f"_SUBCOMMANDS without entries in _COMMAND_MODULES: {missing}"


def test_no_orphan_modules_in_registry():
    extra = sorted(set(_COMMAND_MODULES.keys()) - _SUBCOMMANDS)
    assert not extra, f"_COMMAND_MODULES references unknown subcommands: {extra}"


def test_build_parser_succeeds():
    parser = build_parser()
    assert parser.prog == "graph-caster"


@pytest.mark.parametrize("module_path", sorted(set(_COMMAND_MODULES.values())))
def test_each_command_module_exposes_register_and_execute(module_path: str):
    mod = import_module(module_path)
    assert callable(getattr(mod, "register", None)), f"{module_path} missing register()"
    assert callable(getattr(mod, "execute", None)), f"{module_path} missing execute()"


def test_help_invocation_does_not_crash(capsys):
    # build_parser().parse_args(["-h"]) raises SystemExit(0) — verify it's clean.
    parser = build_parser()
    with pytest.raises(SystemExit) as exc:
        parser.parse_args(["-h"])
    assert exc.value.code == 0
