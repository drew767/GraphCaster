# Copyright GraphCaster. All Rights Reserved.

"""Subprocess-isolated ``graph_ref`` execution (opt-in via ``GC_GRAPH_REF_SUBPROCESS``).

Allow-listed keys written to ``--context-json`` for the child process (no session objects,
no internal runner-only handles):

- ``node_outputs``
- ``nesting_depth``
- ``max_nesting_depth``
- ``root_run_artifact_dir``
- ``_parent_graph_ref_node_id``
- ``_gc_nested_doc_revisions`` (maps ``targetGraphId`` → revision hex for F17 step-cache parity)
- ``last_result``
- ``_gc_started_at_iso``
- ``run_id``

Long strings under ``node_outputs`` / ``processResult`` (``stdout``, ``stderr``) are truncated
to ``MAX_CHAINED_PROCESS_OUTPUT_TEXT_LEN`` before JSON serialization (same cap as chained task
output for cache keys and edge conditions).

Child writes ``--nested-context-out`` with ``node_outputs``, ``_run_success``, ``_run_cancelled``,
``last_result``, ``_run_partial_stop`` for the parent merge (flat merge of nested node ids into
the shared ``node_outputs`` dict, same as in-process nested runs).
"""

from __future__ import annotations

import copy
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

from graph_caster.cli_run_args import build_graph_caster_run_argv
from graph_caster.cursor_agent_argv import MAX_CHAINED_PROCESS_OUTPUT_TEXT_LEN
from graph_caster.host_context import RunHostContext
from graph_caster.node_output_cache import StepCachePolicy
from graph_caster.run_event_sink import RunEventSink
from graph_caster.run_sessions import RunSession

NESTED_CONTEXT_INPUT_KEYS: frozenset[str] = frozenset(
    {
        "node_outputs",
        "nesting_depth",
        "max_nesting_depth",
        "root_run_artifact_dir",
        "_parent_graph_ref_node_id",
        "_gc_nested_doc_revisions",
        "last_result",
        "_gc_started_at_iso",
        "run_id",
        "trigger",
    }
)

GRAPH_REF_SUBPROCESS_ENV = "GC_GRAPH_REF_SUBPROCESS"


def graph_ref_subprocess_enabled() -> bool:
    v = os.environ.get(GRAPH_REF_SUBPROCESS_ENV, "").strip().lower()
    return v in ("1", "true", "yes", "on")


def _truncate_strings(obj: Any, max_len: int) -> Any:
    if isinstance(obj, str):
        if len(obj) <= max_len:
            return obj
        return obj[:max_len] + "…"
    if isinstance(obj, dict):
        return {k: _truncate_strings(v, max_len) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_truncate_strings(x, max_len) for x in obj]
    return obj


def _payload_for_nested_context_write(ctx: dict[str, Any]) -> dict[str, Any]:
    raw: dict[str, Any] = {}
    for k in NESTED_CONTEXT_INPUT_KEYS:
        if k not in ctx:
            continue
        raw[k] = copy.deepcopy(ctx[k])
    if "node_outputs" in raw and isinstance(raw["node_outputs"], dict):
        raw["node_outputs"] = _truncate_strings(
            raw["node_outputs"], MAX_CHAINED_PROCESS_OUTPUT_TEXT_LEN
        )
    return json.loads(json.dumps(raw, default=str))


def write_nested_context_json(ctx: dict[str, Any], path: Path) -> None:
    path.write_text(
        json.dumps(_payload_for_nested_context_write(ctx), ensure_ascii=False),
        encoding="utf-8",
    )


def write_nested_run_result_json(ctx: dict[str, Any], path: Path) -> None:
    payload: dict[str, Any] = {
        "_run_success": bool(ctx.get("_run_success", False)),
        "_run_cancelled": bool(ctx.get("_run_cancelled", False)),
        "last_result": bool(ctx.get("last_result", False)),
        "_run_partial_stop": bool(ctx.get("_run_partial_stop", False)),
    }
    outs = ctx.get("node_outputs")
    if isinstance(outs, dict):
        truncated = _truncate_strings(outs, MAX_CHAINED_PROCESS_OUTPUT_TEXT_LEN)
        payload["node_outputs"] = json.loads(json.dumps(truncated, default=str))
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def merge_nested_run_result_into_parent(ctx: dict[str, Any], path: Path) -> None:
    """Merge snapshot written by our nested child CLI (``--nested-context-out``).

    Call only for paths created by the parent orchestrator for that child; do not pass
    arbitrary user-controlled files (JSON could spoof ``_run_success``).
    """
    if not path.is_file():
        return
    try:
        text = path.read_text(encoding="utf-8").strip()
        if not text:
            return
        raw = json.loads(text)
    except (OSError, UnicodeError, json.JSONDecodeError):
        return
    if not isinstance(raw, dict):
        return
    outs = raw.get("node_outputs")
    if isinstance(outs, dict):
        bucket = ctx.setdefault("node_outputs", {})
        bucket.update(copy.deepcopy(outs))
    ctx["_run_success"] = bool(raw.get("_run_success", False))
    if raw.get("_run_cancelled"):
        ctx["_run_cancelled"] = True
    if "last_result" in raw:
        ctx["last_result"] = bool(raw["last_result"])
    if raw.get("_run_partial_stop"):
        ctx["_run_partial_stop"] = True


def run_nested_graph_ref_subprocess(
    *,
    nested_path: Path,
    child_ctx: dict[str, Any],
    sink: RunEventSink,
    host: RunHostContext,
    run_id: str | None,
    step_cache: StepCachePolicy | None,
    run_session: RunSession | None,
    public_stream: bool = False,
) -> None:
    """Run nested graph in a subprocess; sets ``child_ctx`` success/cancel flags and ``node_outputs`` merge."""

    if run_id is None or not str(run_id).strip():
        child_ctx["_run_success"] = False
        return

    fd_in, p_in = tempfile.mkstemp(prefix="gc-nested-ctx-", suffix=".json")
    fd_out, p_out = tempfile.mkstemp(prefix="gc-nested-out-", suffix=".json")
    os.close(fd_in)
    os.close(fd_out)
    ctx_in = Path(p_in)
    ctx_out = Path(p_out)
    proc: subprocess.Popen[str] | None = None
    stderr_done = threading.Event()

    try:
        try:
            write_nested_context_json(child_ctx, ctx_in)
        except (OSError, TypeError, ValueError):
            child_ctx["_run_success"] = False
            return

        enable_stdin = run_session is not None
        step_on = (
            step_cache is not None
            and step_cache.enabled
            and host.artifacts_base is not None
        )
        dirty_csv = ""
        if step_on and step_cache is not None:
            dirty_csv = ",".join(sorted(step_cache.dirty_nodes))

        no_persist = host.artifacts_base is not None

        argv_tail = build_graph_caster_run_argv(
            nested_path,
            run_id=str(run_id).strip(),
            graphs_dir=host.graphs_root,
            workspace_root=host.workspace_root,
            artifacts_base=host.artifacts_base,
            context_json_path=ctx_in,
            step_cache=step_on,
            step_cache_dirty=dirty_csv,
            no_persist_run_events=no_persist,
            enable_session_stdin=enable_stdin,
            nested_context_out=ctx_out,
            public_stream=bool(public_stream),
        )
        cmd = [sys.executable, "-m", "graph_caster", *argv_tail]

        stdin_arg: Any = subprocess.DEVNULL
        if enable_stdin:
            stdin_arg = subprocess.PIPE

        proc = subprocess.Popen(
            cmd,
            stdin=stdin_arg,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )

        def _drain_stderr() -> None:
            try:
                if proc.stderr is not None:
                    for line in proc.stderr:
                        sys.stderr.write(line)
                    proc.stderr.close()
            finally:
                stderr_done.set()

        threading.Thread(target=_drain_stderr, daemon=True).start()

        out_q: queue.Queue[tuple[str, Any]] = queue.Queue()

        def _pump_stdout() -> None:
            try:
                if proc.stdout is not None:
                    for line in proc.stdout:
                        out_q.put(("line", line))
                    proc.stdout.close()
            finally:
                out_q.put(("eof", None))

        threading.Thread(target=_pump_stdout, daemon=True).start()

        rid_s = str(run_id).strip()
        saw_eof = False

        def _consume_line(raw_line: str) -> None:
            _emit_line(sink, raw_line)

        def _cancel_child() -> None:
            if proc.stdin is not None and enable_stdin:
                try:
                    proc.stdin.write(
                        json.dumps({"type": "cancel_run", "runId": rid_s}, ensure_ascii=False) + "\n"
                    )
                    proc.stdin.flush()
                except BrokenPipeError:
                    pass
            time.sleep(0.15)
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
            child_ctx["_run_cancelled"] = True

        while not saw_eof:
            if run_session is not None and run_session.cancel_event.is_set():
                _cancel_child()
                break
            try:
                kind, data = out_q.get(timeout=0.1)
            except queue.Empty:
                continue
            if kind == "eof":
                saw_eof = True
                break
            if kind == "line" and isinstance(data, str):
                _consume_line(data)

        while True:
            try:
                kind, data = out_q.get_nowait()
            except queue.Empty:
                break
            if kind == "eof":
                saw_eof = True
                break
            if kind == "line" and isinstance(data, str):
                _consume_line(data)

        proc.wait()
        stderr_done.wait(timeout=5)
        try:
            if proc.stdin is not None:
                proc.stdin.close()
        except OSError:
            pass

        if ctx_out.is_file():
            merge_nested_run_result_into_parent(child_ctx, ctx_out)
        else:
            child_ctx["_run_success"] = False

        # Snapshot from child ``finally`` is authoritative; exit code is an extra guard only.
        if proc.returncode != 0:
            child_ctx["_run_success"] = False
        if child_ctx.get("_run_cancelled"):
            child_ctx["_run_success"] = False

    finally:
        if proc is not None:
            try:
                if proc.stdin is not None:
                    proc.stdin.close()
            except OSError:
                pass
            if proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=5)
                except (subprocess.TimeoutExpired, OSError):
                    try:
                        proc.kill()
                        proc.wait(timeout=5)
                    except OSError:
                        pass
            stderr_done.wait(timeout=5)
        try:
            ctx_in.unlink(missing_ok=True)
            ctx_out.unlink(missing_ok=True)
        except OSError:
            pass


def _emit_line(sink: RunEventSink, line: str) -> None:
    s = line.strip()
    if not s:
        return
    try:
        ev = json.loads(s)
    except json.JSONDecodeError:
        return
    if not isinstance(ev, dict):
        return
    sink.emit(ev)
