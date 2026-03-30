# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

import pytest

from graph_caster.run_audit import append_run_finished_audit_maybe


def test_audit_explicit_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    p = tmp_path / "audit.jsonl"
    monkeypatch.setenv("GC_AUDIT_LOG_PATH", str(p))
    append_run_finished_audit_maybe({"runId": "x", "status": "success"}, workspace_root=None)
    lines = p.read_text(encoding="utf-8").strip().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["runId"] == "x"


def test_audit_auto_off_without_flag(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_AUDIT_LOG_PATH", raising=False)
    monkeypatch.delenv("GC_AUDIT_LOG_AUTO", raising=False)
    p = tmp_path / ".graphcaster" / "run_audit.jsonl"
    append_run_finished_audit_maybe({"runId": "y"}, workspace_root=tmp_path)
    assert not p.is_file()


def test_audit_auto_with_flag(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_AUDIT_LOG_AUTO", "1")
    monkeypatch.delenv("GC_AUDIT_LOG_PATH", raising=False)
    append_run_finished_audit_maybe({"runId": "z"}, workspace_root=tmp_path)
    p = tmp_path / ".graphcaster" / "run_audit.jsonl"
    assert p.is_file()
    assert "z" in p.read_text(encoding="utf-8")
