# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import sys
import types

import pytest

from graph_caster.run_plugin_hook import invoke_run_finished_module_maybe


def test_plugin_hook_calls_on_run_finished(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[object] = []

    def on_run_finished(payload: object) -> None:
        called.append(payload)

    mod = types.ModuleType("gc_test_plugin_x")
    mod.on_run_finished = on_run_finished  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "gc_test_plugin_x", mod)
    monkeypatch.setenv("GC_RUN_PLUGIN_MODULE", "gc_test_plugin_x")
    invoke_run_finished_module_maybe({"runId": "1"})
    assert len(called) == 1
    assert called[0] == {"runId": "1"}


def test_plugin_hook_noop_without_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_RUN_PLUGIN_MODULE", raising=False)
    invoke_run_finished_module_maybe({"runId": "2"})
