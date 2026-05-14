# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import os
import queue
import subprocess
import sys
import time
from pathlib import Path

from graph_caster.exec.env_merge import (
    _ENV_KEY_NAME_RE,
    _build_task_subprocess_env,
    _parse_env_keys_list,
    redact_task_data_for_node_execute,
    task_declares_env_keys,
)
from graph_caster.exec.io_pump import (
    _MAX_READLINE_CHARS,
    _STDOUT_CAP,
    _communicate_with_streaming,
    _drain_process_output_queue,
    _emit_one_process_output,
    _pipe_reader_lines_to_queue,
)
from graph_caster.exec.process_errors import (
    _eval_success,
    _record_task_process_result,
    _terminate_process_graceful,
    _truncate_for_process_result_storage,
)


# ============================================================
# env_merge.py
# ============================================================


def test_env_key_name_re_matches_valid_names() -> None:
    assert _ENV_KEY_NAME_RE.fullmatch("FOO") is not None
    assert _ENV_KEY_NAME_RE.fullmatch("_X") is not None
    assert _ENV_KEY_NAME_RE.fullmatch("a1_b2") is not None
    assert _ENV_KEY_NAME_RE.fullmatch("1bad") is None
    assert _ENV_KEY_NAME_RE.fullmatch("bad-name") is None
    assert _ENV_KEY_NAME_RE.fullmatch("") is None


def test_parse_env_keys_list_deduplicates_and_filters() -> None:
    assert _parse_env_keys_list(["A", "A", "B"]) == ["A", "B"]
    assert _parse_env_keys_list([" A ", "B"]) == ["A", "B"]
    assert _parse_env_keys_list(["bad-name", "OK"]) == ["OK"]
    assert _parse_env_keys_list(["", None, 7, "X"]) == ["X"]
    assert _parse_env_keys_list("notalist") == []


def test_task_declares_env_keys() -> None:
    assert task_declares_env_keys({"envKeys": ["A"]}) is True
    assert task_declares_env_keys({"envKeys": []}) is False
    assert task_declares_env_keys({}) is False
    assert task_declares_env_keys({"envKeys": ["bad-name"]}) is False


def test_build_task_subprocess_env_no_keys_no_explicit_returns_none() -> None:
    assert _build_task_subprocess_env({}, None) is None
    assert _build_task_subprocess_env({"env": {}}, None) is None
    assert _build_task_subprocess_env({"envKeys": []}, {"X": "y"}) is None


def test_build_task_subprocess_env_pulls_from_workspace_secrets() -> None:
    env = _build_task_subprocess_env(
        {"envKeys": ["MY_KEY"]}, {"MY_KEY": "secret", "OTHER": "ignored"}
    )
    assert env is not None
    assert env["MY_KEY"] == "secret"
    assert "OTHER" not in env or env.get("OTHER") != "ignored"


def test_build_task_subprocess_env_explicit_overrides_workspace() -> None:
    env = _build_task_subprocess_env(
        {"envKeys": ["MY_KEY"], "env": {"MY_KEY": "explicit"}},
        {"MY_KEY": "from_ws"},
    )
    assert env is not None
    assert env["MY_KEY"] == "explicit"


def test_build_task_subprocess_env_inherits_parent_env() -> None:
    env = _build_task_subprocess_env({"env": {"NEW_VAR": "v"}}, None)
    assert env is not None
    # Should include something from os.environ (e.g. PATH on most systems)
    inherited = any(k in env for k in os.environ.keys())
    assert inherited


def test_redact_task_data_for_node_execute_no_keys_returns_input() -> None:
    data = {"env": {"X": "v"}}
    out = redact_task_data_for_node_execute(data)
    assert out is data  # returned unchanged when no envKeys


def test_redact_task_data_for_node_execute_redacts_listed_keys() -> None:
    data = {"envKeys": ["SECRET"], "env": {"SECRET": "leak", "PLAIN": "ok"}}
    out = redact_task_data_for_node_execute(data)
    assert out is not data  # deep-copied
    assert out["env"]["SECRET"] == "[redacted]"
    assert out["env"]["PLAIN"] == "ok"
    # Original untouched
    assert data["env"]["SECRET"] == "leak"


# ============================================================
# process_errors.py
# ============================================================


def test_truncate_for_process_result_storage_short_unchanged() -> None:
    assert _truncate_for_process_result_storage("hi", 10) == "hi"


def test_truncate_for_process_result_storage_long_truncated_with_ellipsis() -> None:
    out = _truncate_for_process_result_storage("a" * 50, 10)
    assert len(out) == 10
    assert out.endswith("...")


def test_truncate_for_process_result_storage_small_max_no_ellipsis() -> None:
    out = _truncate_for_process_result_storage("abcdef", 2)
    assert out == "ab"


def test_eval_success_exit_code_default_zero() -> None:
    assert _eval_success("exit_code", returncode=0, stdout="", cwd=Path("."), data={}) is True
    assert _eval_success("exit_code", returncode=1, stdout="", cwd=Path("."), data={}) is False


def test_eval_success_exit_code_custom_list() -> None:
    d = {"successExitCodes": [0, 2]}
    assert _eval_success("exit_code", returncode=2, stdout="", cwd=Path("."), data=d) is True
    assert _eval_success("exit_code", returncode=1, stdout="", cwd=Path("."), data=d) is False


def test_eval_success_stdout_contains() -> None:
    d = {"stdoutContains": "ok"}
    assert _eval_success("stdout", returncode=0, stdout="that's ok!", cwd=Path("."), data=d) is True
    assert _eval_success("stdout_contains", returncode=0, stdout="nope", cwd=Path("."), data=d) is False
    assert _eval_success("stdout", returncode=0, stdout="anything", cwd=Path("."), data={}) is False


def test_eval_success_marker_file(tmp_path: Path) -> None:
    marker = tmp_path / "done.flag"
    d = {"markerFile": "done.flag"}
    assert _eval_success("marker_file", returncode=0, stdout="", cwd=tmp_path, data=d) is False
    marker.write_text("done", encoding="utf-8")
    assert _eval_success("marker_file", returncode=0, stdout="", cwd=tmp_path, data=d) is True


def test_eval_success_unknown_mode_returns_false() -> None:
    assert _eval_success("bogus", returncode=0, stdout="", cwd=Path("."), data={}) is False


def test_record_task_process_result_writes_into_ctx() -> None:
    ctx: dict = {}
    _record_task_process_result(
        ctx, "n1", exit_code=0, success=True, timed_out=False, stdout="hi", stderr="warn"
    )
    pr = ctx["node_outputs"]["n1"]["processResult"]
    assert pr["exitCode"] == 0
    assert pr["success"] is True
    assert pr["timedOut"] is False
    assert pr["cancelled"] is False
    assert pr["stdoutChars"] == 2
    assert pr["stderrChars"] == 4
    assert pr["stdout"] == "hi"
    assert pr["stderr"] == "warn"


def test_record_task_process_result_preserves_existing_entry() -> None:
    ctx: dict = {"node_outputs": {"n1": {"existing": "keep_me"}}}
    _record_task_process_result(
        ctx, "n1", exit_code=1, success=False, timed_out=True, stdout="", stderr="", cancelled=True
    )
    entry = ctx["node_outputs"]["n1"]
    assert entry["existing"] == "keep_me"
    assert entry["processResult"]["cancelled"] is True
    assert entry["processResult"]["timedOut"] is True


def test_terminate_process_graceful_already_dead_noop() -> None:
    proc = subprocess.Popen(
        [sys.executable, "-c", "pass"], stdout=subprocess.PIPE, stderr=subprocess.PIPE
    )
    proc.wait()
    # Should not raise on already-terminated process
    _terminate_process_graceful(proc, grace_sec=0.1)
    assert proc.poll() is not None


def test_terminate_process_graceful_kills_long_running() -> None:
    proc = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(30)"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    t0 = time.monotonic()
    _terminate_process_graceful(proc, grace_sec=0.5)
    elapsed = time.monotonic() - t0
    assert proc.poll() is not None
    assert elapsed < 10.0  # should be quick


# ============================================================
# io_pump.py
# ============================================================


def test_pipe_reader_lines_to_queue_handles_none() -> None:
    q: queue.Queue = queue.Queue()
    _pipe_reader_lines_to_queue(None, "stdout", q)
    assert q.empty()


def test_pipe_reader_lines_to_queue_reads_lines() -> None:
    import io

    pipe = io.StringIO("line1\nline2\nline3")
    q: queue.Queue = queue.Queue()
    _pipe_reader_lines_to_queue(pipe, "stdout", q)
    items = []
    while not q.empty():
        items.append(q.get_nowait())
    assert items == [
        ("stdout", "line1\n", True),
        ("stdout", "line2\n", True),
        ("stdout", "line3", False),
    ]


def test_pipe_reader_truncates_long_lines() -> None:
    import io

    long_line = "x" * (_MAX_READLINE_CHARS + 100) + "\n"
    pipe = io.StringIO(long_line)
    q: queue.Queue = queue.Queue()
    _pipe_reader_lines_to_queue(pipe, "stdout", q)
    label, text, eol = q.get_nowait()
    assert label == "stdout"
    assert len(text) == _MAX_READLINE_CHARS


def test_emit_one_process_output_stdout_appends_and_emits() -> None:
    events: list = []

    def emit(event_type: str, **kw):
        events.append({"type": event_type, **kw})

    out_parts: list[str] = []
    err_parts: list[str] = []
    seq = {"stdout": 0, "stderr": 0}
    _emit_one_process_output(
        "stdout",
        "hello\n",
        True,
        out_parts,
        err_parts,
        emit,
        node_id="n1",
        graph_id="g1",
        attempt=0,
        seq=seq,
    )
    assert out_parts == ["hello\n"]
    assert err_parts == []
    assert seq["stdout"] == 1
    assert events[0]["type"] == "process_output"
    assert events[0]["stream"] == "stdout"
    assert events[0]["text"] == "hello\n"
    assert events[0]["seq"] == 0


def test_emit_one_process_output_stderr_appends_and_emits() -> None:
    events: list = []

    def emit(event_type: str, **kw):
        events.append({"type": event_type, **kw})

    out_parts: list[str] = []
    err_parts: list[str] = []
    seq = {"stdout": 0, "stderr": 0}
    _emit_one_process_output(
        "stderr",
        "err\n",
        True,
        out_parts,
        err_parts,
        emit,
        node_id="n1",
        graph_id="g1",
        attempt=0,
        seq=seq,
    )
    assert err_parts == ["err\n"]
    assert out_parts == []
    assert seq["stderr"] == 1
    assert events[0]["stream"] == "stderr"


def test_drain_process_output_queue_empties_queue() -> None:
    q: queue.Queue = queue.Queue()
    q.put(("stdout", "a\n", True))
    q.put(("stderr", "b\n", True))
    events: list = []
    out_parts: list[str] = []
    err_parts: list[str] = []
    seq = {"stdout": 0, "stderr": 0}
    _drain_process_output_queue(
        q,
        out_parts,
        err_parts,
        lambda e, **kw: events.append((e, kw)),
        node_id="n1",
        graph_id="g1",
        attempt=0,
        seq=seq,
    )
    assert q.empty()
    assert out_parts == ["a\n"]
    assert err_parts == ["b\n"]
    assert len(events) == 2


def test_communicate_with_streaming_captures_stdout(tmp_path: Path) -> None:
    proc = subprocess.Popen(
        [sys.executable, "-c", "print('hello'); print('world')"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    events: list = []

    def emit(event_type: str, **kw):
        events.append({"type": event_type, **kw})

    stdout, stderr, timed_out, cancelled = _communicate_with_streaming(
        proc,
        emit,
        node_id="n1",
        graph_id="g1",
        attempt=0,
        timeout=None,
        should_cancel=None,
    )
    assert proc.returncode == 0
    assert "hello" in stdout
    assert "world" in stdout
    assert stderr == ""
    assert timed_out is False
    assert cancelled is False
    assert len(stdout) <= _STDOUT_CAP


def test_communicate_with_streaming_timeout_terminates(tmp_path: Path) -> None:
    proc = subprocess.Popen(
        [sys.executable, "-c", "import time; time.sleep(30)"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
    )
    events: list = []
    stdout, stderr, timed_out, cancelled = _communicate_with_streaming(
        proc,
        lambda e, **kw: events.append((e, kw)),
        node_id="n1",
        graph_id="g1",
        attempt=0,
        timeout=0.4,
        should_cancel=None,
    )
    assert timed_out is True
    assert cancelled is False
    assert proc.poll() is not None


# ============================================================
# llm_agent_process re-export validation
# ============================================================


def test_run_llm_agent_process_reexported_from_process_exec() -> None:
    from graph_caster.exec.llm_agent_process import run_llm_agent_process as direct
    from graph_caster.process_exec import run_llm_agent_process as reexported

    assert direct is reexported
