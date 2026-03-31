# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from pathlib import Path

import pytest

from graph_caster.audit.audit_hook import (
    dispatch_run_finished_audit,
    register_run_finished_hook,
    reset_run_finished_hooks,
)
from graph_caster.run_audit import append_run_finished_audit_maybe


@pytest.fixture(autouse=True)
def _reset_hooks() -> None:
    reset_run_finished_hooks()
    yield
    reset_run_finished_hooks()


def test_dispatch_run_finished_audit_calls_hooks(tmp_path: Path) -> None:
    seen: list[tuple[dict, Path | None]] = []

    def h(payload: dict, wr: Path | None) -> None:
        seen.append((payload, wr))

    register_run_finished_hook(h)
    dispatch_run_finished_audit({"runId": "x"}, workspace_root=tmp_path)
    assert len(seen) == 1
    assert seen[0][0]["runId"] == "x"
    assert seen[0][1] == tmp_path.resolve()


def test_append_audit_dispatches_hook_without_jsonl(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_AUDIT_LOG_PATH", raising=False)
    monkeypatch.delenv("GC_AUDIT_LOG_AUTO", raising=False)
    seen: list[str] = []
    register_run_finished_hook(lambda p, _wr: seen.append(str(p.get("runId"))))
    append_run_finished_audit_maybe({"runId": "hooked"}, workspace_root=tmp_path)
    assert seen == ["hooked"]
