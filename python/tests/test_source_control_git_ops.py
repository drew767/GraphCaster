# Copyright GraphCaster. All Rights Reserved.

"""Tests for SourceControlManager with mocked subprocess, 8 tests."""

from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from graph_caster.source_control.git_ops import (
    Commit,
    GitCommandError,
    SourceControlManager,
)


def _make_proc(stdout: str = "", stderr: str = "", returncode: int = 0) -> MagicMock:
    p = MagicMock(spec=subprocess.CompletedProcess)
    p.stdout = stdout
    p.stderr = stderr
    p.returncode = returncode
    return p


def _patch_run(manager: SourceControlManager, results: list[MagicMock]):
    """Patch manager._run to return items from results in order."""
    call_results = iter(results)

    async def _fake_run(*args, check=True, capture_output=True):
        proc = next(call_results)
        if check and proc.returncode != 0:
            raise GitCommandError(proc.returncode, proc.stderr, [manager._git, *args])
        return proc

    return patch.object(manager, "_run", side_effect=_fake_run)


@pytest.mark.anyio
async def test_get_status_no_repo(tmp_path: Path):
    mgr = SourceControlManager(tmp_path / "ws")
    status = await mgr.get_status()
    assert status["connected"] is False
    assert status["branch"] == ""


@pytest.mark.anyio
async def test_get_status_with_repo(tmp_path: Path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / ".git").mkdir()
    mgr = SourceControlManager(ws)
    results = [
        _make_proc("main\n"),                  # rev-parse branch
        _make_proc("2\t1\n"),                   # rev-list ahead/behind
        _make_proc(" M graphs/foo.json\n"),     # status --porcelain
    ]
    with _patch_run(mgr, results):
        status = await mgr.get_status()
    assert status["connected"] is True
    assert status["branch"] == "main"
    assert status["behind"] == 2
    assert status["ahead"] == 1
    assert len(status["pending_changes"]) == 1


@pytest.mark.anyio
async def test_list_branches_no_repo(tmp_path: Path):
    mgr = SourceControlManager(tmp_path / "ws")
    branches = await mgr.list_branches()
    assert branches == []


@pytest.mark.anyio
async def test_list_branches(tmp_path: Path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / ".git").mkdir()
    mgr = SourceControlManager(ws)
    branch_output = "* main\n  feature/x\n  remotes/origin/main\n"
    results = [_make_proc(branch_output)]
    with _patch_run(mgr, results):
        branches = await mgr.list_branches()
    assert "main" in branches
    assert "feature/x" in branches


@pytest.mark.anyio
async def test_pull_success(tmp_path: Path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / ".git").mkdir()
    mgr = SourceControlManager(ws)
    results = [_make_proc("Already up to date.\n")]
    with _patch_run(mgr, results):
        result = await mgr.pull()
    assert "applied" in result
    assert result["conflicts"] == []


@pytest.mark.anyio
async def test_pull_with_conflict(tmp_path: Path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / ".git").mkdir()
    mgr = SourceControlManager(ws)
    conflict_result = _make_proc(stdout="", stderr="conflict", returncode=1)
    files_result = _make_proc("graphs/conflicted.json\n")
    abort_result = _make_proc("")
    with _patch_run(mgr, [conflict_result, files_result, abort_result]):
        result = await mgr.pull()
    assert result["applied"] == []
    assert "graphs/conflicted.json" in result["conflicts"]


@pytest.mark.anyio
async def test_get_history(tmp_path: Path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / ".git").mkdir()
    mgr = SourceControlManager(ws)
    log_output = "abc123\x00Alice\x002024-01-01T00:00:00Z\x00initial commit\n"
    results = [_make_proc(log_output)]
    with _patch_run(mgr, results):
        commits = await mgr.get_history(limit=10)
    assert len(commits) == 1
    assert commits[0].sha == "abc123"
    assert commits[0].author == "Alice"
    assert commits[0].message == "initial commit"


@pytest.mark.anyio
async def test_diff(tmp_path: Path):
    ws = tmp_path / "ws"
    ws.mkdir()
    (ws / ".git").mkdir()
    mgr = SourceControlManager(ws)
    stat_result = _make_proc(" 1 file changed, 5 insertions(+)\n")
    files_result = _make_proc("graphs/foo.json\n")
    with _patch_run(mgr, [stat_result, files_result]):
        result = await mgr.diff("abc123", "def456")
    assert result["a"] == "abc123"
    assert result["b"] == "def456"
    assert "graphs/foo.json" in result["files"]
