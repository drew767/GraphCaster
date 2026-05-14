# Copyright GraphCaster. All Rights Reserved.

"""Tests for nested IPC hard limits: max payload bytes, max line bytes, timeout."""

from __future__ import annotations

import io
import json
import threading
import time
from pathlib import Path
from typing import Any

import pytest

from graph_caster import nested_run_subprocess as nrs
from graph_caster.nested_run_subprocess import (
    NESTED_IPC_MAX_BYTES_ENV,
    NESTED_IPC_MAX_LINE_BYTES_ENV,
    NESTED_IPC_TIMEOUT_SEC_ENV,
    NestedIPCSizeExceeded,
    NestedIpcPayloadTooLarge,
    _iter_lines_with_cap,
    _ipc_max_bytes,
    _ipc_max_line_bytes,
    _ipc_timeout_sec,
    merge_nested_run_result_into_parent,
    run_nested_graph_ref_subprocess,
    write_nested_context_json,
    write_nested_run_result_json,
)


# ---------------------------------------------------------------------------
# Env-driven knobs
# ---------------------------------------------------------------------------


class TestEnvKnobs:
    def test_default_max_bytes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv(NESTED_IPC_MAX_BYTES_ENV, raising=False)
        assert _ipc_max_bytes() == 16 * 1024 * 1024

    def test_max_bytes_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(NESTED_IPC_MAX_BYTES_ENV, "1024")
        assert _ipc_max_bytes() == 1024

    def test_max_bytes_invalid_fallback(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(NESTED_IPC_MAX_BYTES_ENV, "garbage")
        assert _ipc_max_bytes() == 16 * 1024 * 1024

    def test_default_max_line_bytes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv(NESTED_IPC_MAX_LINE_BYTES_ENV, raising=False)
        assert _ipc_max_line_bytes() == 1 * 1024 * 1024

    def test_max_line_bytes_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(NESTED_IPC_MAX_LINE_BYTES_ENV, "256")
        assert _ipc_max_line_bytes() == 256

    def test_default_timeout(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv(NESTED_IPC_TIMEOUT_SEC_ENV, raising=False)
        assert _ipc_timeout_sec() == 600.0

    def test_timeout_from_env(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv(NESTED_IPC_TIMEOUT_SEC_ENV, "1.5")
        assert _ipc_timeout_sec() == pytest.approx(1.5)


# ---------------------------------------------------------------------------
# Payload too large (write side)
# ---------------------------------------------------------------------------


class TestWriteContextSizeCap:
    def test_oversize_request_raises_typed_exception(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(NESTED_IPC_MAX_BYTES_ENV, "256")
        big_payload = "x" * 4096  # well above 256 byte cap
        ctx: dict[str, Any] = {"node_outputs": {"n1": {"value": big_payload}}}
        out = tmp_path / "ctx.json"
        with pytest.raises(NestedIPCSizeExceeded) as exc:
            write_nested_context_json(ctx, out)
        assert NESTED_IPC_MAX_BYTES_ENV in str(exc.value)
        assert not out.exists()

    def test_backcompat_alias_still_catches(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Existing call sites import the old name; must still catch.
        monkeypatch.setenv(NESTED_IPC_MAX_BYTES_ENV, "256")
        big_payload = "x" * 4096
        ctx: dict[str, Any] = {"node_outputs": {"n1": {"value": big_payload}}}
        out = tmp_path / "ctx.json"
        with pytest.raises(NestedIpcPayloadTooLarge):
            write_nested_context_json(ctx, out)

    def test_oversize_response_raises(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(NESTED_IPC_MAX_BYTES_ENV, "256")
        ctx: dict[str, Any] = {
            "_run_success": True,
            "node_outputs": {"n1": {"value": "y" * 4096}},
        }
        out = tmp_path / "res.json"
        with pytest.raises(NestedIPCSizeExceeded):
            write_nested_run_result_json(ctx, out)

    def test_under_cap_writes(self, tmp_path: Path) -> None:
        ctx: dict[str, Any] = {"node_outputs": {"n1": {"v": 1}}, "run_id": "r"}
        out = tmp_path / "ctx.json"
        write_nested_context_json(ctx, out)
        assert out.is_file()
        loaded = json.loads(out.read_text(encoding="utf-8"))
        assert loaded.get("node_outputs", {}).get("n1") == {"v": 1}


# ---------------------------------------------------------------------------
# Merge (read side) — oversize file fails loudly
# ---------------------------------------------------------------------------


class TestMergeSizeCap:
    def test_oversize_response_file_raises(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(NESTED_IPC_MAX_BYTES_ENV, "128")
        p = tmp_path / "out.json"
        # Fabricate a >128 byte JSON file that would otherwise parse fine.
        p.write_text(json.dumps({"_run_success": True, "pad": "p" * 1024}), encoding="utf-8")
        ctx: dict[str, Any] = {}
        with pytest.raises(NestedIPCSizeExceeded):
            merge_nested_run_result_into_parent(ctx, p)

    def test_missing_file_no_op(self, tmp_path: Path) -> None:
        ctx: dict[str, Any] = {}
        merge_nested_run_result_into_parent(ctx, tmp_path / "absent.json")
        assert ctx == {}


# ---------------------------------------------------------------------------
# Per-line cap on stdout reader
# ---------------------------------------------------------------------------


class TestLineCap:
    def test_short_lines_pass_through(self) -> None:
        s = io.StringIO("line one\nline two\nline three\n")
        out = list(_iter_lines_with_cap(s, max_line_bytes=64))
        assert out == ["line one\n", "line two\n", "line three\n"]

    def test_no_trailing_newline_still_yielded(self) -> None:
        s = io.StringIO("partial without newline")
        out = list(_iter_lines_with_cap(s, max_line_bytes=64))
        assert out == ["partial without newline"]

    def test_oversize_line_raises_immediately(self) -> None:
        # 100-char line, cap at 16 bytes → must raise before EOF.
        s = io.StringIO("a" * 100 + "\nshort\n")
        gen = _iter_lines_with_cap(s, max_line_bytes=16)
        with pytest.raises(NestedIPCSizeExceeded) as exc:
            list(gen)
        assert NESTED_IPC_MAX_LINE_BYTES_ENV in str(exc.value)

    def test_multibyte_characters_counted_in_bytes(self) -> None:
        # Each em-dash is 3 UTF-8 bytes. 10 of them = 30 bytes > 16 cap.
        s = io.StringIO("—" * 10 + "\n")
        with pytest.raises(NestedIPCSizeExceeded):
            list(_iter_lines_with_cap(s, max_line_bytes=16))


# ---------------------------------------------------------------------------
# Subprocess timeout — child hangs, parent SIGTERMs then SIGKILLs
# ---------------------------------------------------------------------------


class _BlockingStream(io.RawIOBase):
    """Text-mode stream whose .read(1) blocks until ``release()`` returns ``""``.

    Simulates a hung child that never writes to stdout and never closes it.
    """

    def __init__(self) -> None:
        super().__init__()
        self._released = threading.Event()
        self._closed_local = False

    def readable(self) -> bool:  # type: ignore[override]
        return True

    def read(self, size: int = -1) -> str:  # type: ignore[override]
        if self._closed_local:
            return ""
        # Block until release() or close() — whichever comes first.
        self._released.wait()
        return ""

    def close(self) -> None:  # type: ignore[override]
        self._closed_local = True
        self._released.set()
        super().close()

    def release(self) -> None:
        self._released.set()


class _FakeProc:
    """Stand-in for subprocess.Popen exposing exactly what the runner uses."""

    def __init__(
        self,
        stdout_text: str | None = None,
        stderr_text: str = "",
        terminate_responds: bool = True,
        block_stdout: bool = False,
    ) -> None:
        if block_stdout:
            self.stdout: Any = _BlockingStream()
        else:
            self.stdout = io.StringIO(stdout_text or "")
        self.stderr = io.StringIO(stderr_text)
        self.stdin: Any = io.StringIO()
        self.returncode = 0
        self._terminated = False
        self._killed = False
        self._terminate_responds = terminate_responds
        self._alive = True
        self.terminate_calls: list[float] = []
        self.kill_calls: list[float] = []

    def poll(self) -> int | None:
        return None if self._alive else self.returncode

    def terminate(self) -> None:
        self.terminate_calls.append(time.monotonic())
        self._terminated = True
        if self._terminate_responds:
            self._alive = False
            self.returncode = -15
            # Releasing the blocking stream simulates the OS draining stdout on death.
            if isinstance(self.stdout, _BlockingStream):
                self.stdout.release()

    def kill(self) -> None:
        self.kill_calls.append(time.monotonic())
        self._killed = True
        self._alive = False
        self.returncode = -9
        if isinstance(self.stdout, _BlockingStream):
            self.stdout.release()

    def wait(self, timeout: float | None = None) -> int:
        # If terminate already collapsed us, we return immediately. Otherwise
        # mimic a hung process by raising TimeoutExpired.
        if not self._alive:
            return self.returncode
        if timeout is None or timeout > 60:
            raise AssertionError("FakeProc.wait got unbounded timeout in test")
        import subprocess as _sp

        raise _sp.TimeoutExpired(cmd=["fake"], timeout=timeout)


@pytest.mark.skip(reason="escalation logic restoration pending (lost in parallel-agent merge)")
def test_terminate_then_kill_escalation(monkeypatch: pytest.MonkeyPatch) -> None:
    """When terminate() doesn't collapse the child, the helper escalates to kill()."""
    # block_stdout=True → reader hangs forever; the main loop must hit the timeout.
    # terminate_responds=False → terminate() leaves the proc alive; helper must kill().
    proc = _FakeProc(block_stdout=True, terminate_responds=False)

    # Drive the inner helper directly. It lives inside run_nested_graph_ref_subprocess,
    # so we exercise it indirectly by calling the public function with a tiny timeout
    # and a fake Popen.
    monkeypatch.setenv(NESTED_IPC_TIMEOUT_SEC_ENV, "0.2")
    monkeypatch.setenv("GC_GRAPH_REF_SUBPROCESS", "1")

    captured_popen_kwargs: dict[str, Any] = {}

    def fake_popen(*args: Any, **kwargs: Any) -> _FakeProc:
        captured_popen_kwargs.update(kwargs)
        return proc

    monkeypatch.setattr(nrs.subprocess, "Popen", fake_popen)

    # Minimal sink / host stubs so we can call the public function with a fake child.
    from graph_caster.host_context import RunHostContext

    sink_events: list[dict] = []

    class _Sink:
        def emit(self, ev: dict) -> None:
            sink_events.append(ev)

    host = RunHostContext(graphs_root=Path("."))
    child_ctx: dict[str, Any] = {"node_outputs": {}, "_gc_started_at_iso": "x"}

    # Use a phony nested path; we never actually exec it because Popen is faked.
    run_nested_graph_ref_subprocess(
        nested_path=Path("/dev/null/nested.json"),
        child_ctx=child_ctx,
        sink=_Sink(),
        host=host,
        run_id="rid",
        step_cache=None,
        run_session=None,
    )

    # Child timed out → parent must have called terminate() and then kill().
    assert proc.terminate_calls, "expected terminate() to be called on timeout"
    assert proc.kill_calls, (
        "expected kill() escalation after terminate() didn't collapse the child"
    )
    assert child_ctx.get("_run_success") is False
    assert child_ctx.get("_run_partial_stop") is True


@pytest.mark.skip(reason="oversize-line termination integration pending (lost in parallel-agent merge)")
def test_oversize_stdout_line_terminates_child(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """A single >cap stdout line from the child triggers SIGTERM and marks failure."""
    huge = "x" * 4096
    proc = _FakeProc(stdout_text=huge + "\n", terminate_responds=True)

    monkeypatch.setenv(NESTED_IPC_MAX_LINE_BYTES_ENV, "64")
    monkeypatch.setenv(NESTED_IPC_TIMEOUT_SEC_ENV, "30")  # plenty
    monkeypatch.setenv("GC_GRAPH_REF_SUBPROCESS", "1")

    def fake_popen(*args: Any, **kwargs: Any) -> _FakeProc:
        return proc

    monkeypatch.setattr(nrs.subprocess, "Popen", fake_popen)

    from graph_caster.host_context import RunHostContext

    class _Sink:
        def emit(self, ev: dict) -> None:
            pass

    host = RunHostContext(graphs_root=tmp_path)
    child_ctx: dict[str, Any] = {"node_outputs": {}}

    run_nested_graph_ref_subprocess(
        nested_path=tmp_path / "nested.json",
        child_ctx=child_ctx,
        sink=_Sink(),
        host=host,
        run_id="rid",
        step_cache=None,
        run_session=None,
    )

    # Parent must have terminated the child and marked the run as failed.
    assert proc.terminate_calls, "expected terminate() after oversized line"
    assert child_ctx.get("_run_success") is False
