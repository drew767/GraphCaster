# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import queue
import subprocess
import threading
import time
from collections.abc import Mapping
from typing import Any, Callable

from graph_caster.exec.io_pump import (
    _MAX_READLINE_CHARS,
    _STDOUT_CAP,
    _STREAM_QUEUE_MAX,
    _STREAM_READER_JOIN_SEC,
    EmitFn,
)
from graph_caster.exec.process_errors import (
    _CANCEL_POLL_SEC,
    _record_task_process_result,
    _terminate_process_graceful,
)


def _parse_input_payload(raw_ip: Any) -> Any:
    if isinstance(raw_ip, str) and raw_ip.strip() != "":
        try:
            return json.loads(raw_ip)
        except json.JSONDecodeError:
            return raw_ip
    if raw_ip is not None and not isinstance(raw_ip, str):
        return raw_ip
    return None


def run_llm_agent_process(
    *,
    node_id: str,
    graph_id: str,
    data: dict[str, Any],
    ctx: dict[str, Any],
    upstream_outputs: dict[str, Any],
    emit: EmitFn,
    should_cancel: Callable[[], bool] | None = None,
    workspace_secrets: Mapping[str, str] | None = None,
) -> bool:
    """
    Spawn ``llm_agent`` delegated process: one JSON line on stdin; stdout is NDJSON agent protocol.
    Success requires exit code 0 and a terminal ``agent_finished`` line.

    Retries match ``task``: ``retryCount`` / ``maxRetries``, ``retryBackoffSec`` — new subprocess per attempt;
    ``process_retry`` between attempts; cancel or spawn/stdin errors are not retried.
    """
    from graph_caster.agent_delegate import (
        AgentDelegateRuntimeState,
        apply_agent_delegate_stdout_line,
        build_llm_agent_stdin_text,
    )
    from graph_caster.process_exec import (
        _argv_from_data,
        _build_task_subprocess_env,
        _float_positive,
        _int_non_negative,
        _resolve_cwd,
    )

    argv = _argv_from_data(data)
    if not argv:
        emit(
            "process_failed",
            nodeId=node_id,
            graphId=graph_id,
            reason="config",
            message="llm_agent: missing command/argv",
            attempt=0,
        )
        ctx["last_result"] = False
        _record_task_process_result(
            ctx,
            node_id,
            exit_code=-1,
            success=False,
            timed_out=False,
            stdout="",
            stderr="",
            cancelled=False,
        )
        return False

    cwd = _resolve_cwd(data, ctx)
    try:
        cwd.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass

    timeout = _float_positive(data, "timeoutSec", None)
    if timeout is None:
        timeout = _float_positive(data, "timeout_seconds", None)
    subproc_env = _build_task_subprocess_env(data, workspace_secrets)
    max_agent_steps = _int_non_negative(data, "maxAgentSteps", 0)

    rid = ctx.get("run_id")
    if rid is not None:
        rid_s = str(rid).strip() or None
    else:
        rid_s = None

    iparsed = _parse_input_payload(data.get("inputPayload"))

    stdin_text = build_llm_agent_stdin_text(
        graph_id=graph_id,
        node_id=node_id,
        run_id=rid_s,
        upstream_outputs=upstream_outputs,
        input_payload=iparsed,
    )

    retries = _int_non_negative(data, "retryCount", 0)
    if "maxRetries" in data:
        retries = max(retries, _int_non_negative(data, "maxRetries", 0))
    backoff = _float_positive(data, "retryBackoffSec", 1.0) or 1.0

    attempt = 0
    while True:
        if should_cancel is not None and should_cancel():
            ctx["last_result"] = False
            ctx["_gc_process_cancelled"] = True
            return False

        emit(
            "process_spawn",
            nodeId=node_id,
            graphId=graph_id,
            argv=argv,
            cwd=str(cwd),
            attempt=attempt,
        )

        try:
            proc = subprocess.Popen(
                argv,
                cwd=str(cwd),
                env=subproc_env,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except OSError as e:
            emit(
                "process_failed",
                nodeId=node_id,
                graphId=graph_id,
                reason="spawn_error",
                message=str(e),
                attempt=attempt,
            )
            ctx["last_result"] = False
            _record_task_process_result(
                ctx,
                node_id,
                exit_code=-1,
                success=False,
                timed_out=False,
                stdout="",
                stderr="",
                cancelled=False,
            )
            return False

        try:
            if proc.stdin:
                proc.stdin.write(stdin_text)
                proc.stdin.flush()
                proc.stdin.close()
        except (OSError, BrokenPipeError, ValueError) as e:
            emit(
                "process_failed",
                nodeId=node_id,
                graphId=graph_id,
                reason="spawn_error",
                message=f"stdin: {e}",
                attempt=attempt,
            )
            _terminate_process_graceful(proc)
            ctx["last_result"] = False
            _record_task_process_result(
                ctx,
                node_id,
                exit_code=-1,
                success=False,
                timed_out=False,
                stdout="",
                stderr="",
                cancelled=False,
            )
            return False

        state = AgentDelegateRuntimeState()
        q_err: queue.Queue[tuple[str, str, bool]] = queue.Queue(maxsize=_STREAM_QUEUE_MAX)
        err_parts: list[str] = []
        seq = {"stderr": 0}
        timed_out = False
        cancelled = False
        deadline = time.monotonic() + timeout if timeout is not None else None
        stdout_parts: list[str] = []

        def stderr_reader() -> None:
            p = proc.stderr
            if p is None:
                return
            try:
                while True:
                    line = p.readline()
                    if line == "":
                        break
                    if len(line) > _MAX_READLINE_CHARS:
                        line = line[:_MAX_READLINE_CHARS]
                    eol = line.endswith("\n")
                    q_err.put(("stderr", line, eol))
            except (BrokenPipeError, ValueError, OSError):
                pass

        t_err = threading.Thread(target=stderr_reader, daemon=True)
        t_err.start()

        def stdout_reader() -> None:
            so = proc.stdout
            if so is None:
                return
            try:
                for line in iter(so.readline, ""):
                    if len(line) > _MAX_READLINE_CHARS:
                        line = line[:_MAX_READLINE_CHARS]
                    strip = line.rstrip("\r\n")
                    if strip.strip() == "":
                        continue
                    stdout_parts.append(line)
                    apply_agent_delegate_stdout_line(
                        strip,
                        state,
                        node_id=node_id,
                        graph_id=graph_id,
                        emit=emit,
                        max_steps=max_agent_steps,
                        proc=proc,
                        attempt=attempt,
                    )
                    if state.finished:
                        break
            except (ValueError, OSError, BrokenPipeError):
                pass

        t_out = threading.Thread(target=stdout_reader, daemon=True)
        t_out.start()

        try:
            while proc.poll() is None:
                if should_cancel is not None and should_cancel():
                    cancelled = True
                    _terminate_process_graceful(proc)
                    break
                if deadline is not None and time.monotonic() >= deadline:
                    timed_out = True
                    _terminate_process_graceful(proc)
                    break
                while True:
                    try:
                        name, text, eol = q_err.get_nowait()
                    except queue.Empty:
                        break
                    if name == "stderr":
                        err_parts.append(text)
                        sn = seq["stderr"]
                        emit(
                            "process_output",
                            nodeId=node_id,
                            graphId=graph_id,
                            stream="stderr",
                            text=text,
                            seq=sn,
                            attempt=attempt,
                            eol=eol,
                        )
                        seq["stderr"] = sn + 1
                if state.finished:
                    break
                time.sleep(_CANCEL_POLL_SEC)
        finally:
            try:
                proc.wait(timeout=_STREAM_READER_JOIN_SEC)
            except subprocess.TimeoutExpired:
                _terminate_process_graceful(proc)
            t_err.join(timeout=_STREAM_READER_JOIN_SEC)
            t_out.join(timeout=_STREAM_READER_JOIN_SEC)
            while True:
                try:
                    name, text, eol = q_err.get_nowait()
                except queue.Empty:
                    break
                if name == "stderr":
                    err_parts.append(text)
                    sn = seq["stderr"]
                    emit(
                        "process_output",
                        nodeId=node_id,
                        graphId=graph_id,
                        stream="stderr",
                        text=text,
                        seq=sn,
                        attempt=attempt,
                        eol=eol,
                    )
                    seq["stderr"] = sn + 1

        rc = int(proc.returncode if proc.returncode is not None else -1)
        stdout_s = ("".join(stdout_parts))[:_STDOUT_CAP]
        stderr_s = ("".join(err_parts))[:_STDOUT_CAP]

        if cancelled:
            emit(
                "process_complete",
                nodeId=node_id,
                graphId=graph_id,
                exitCode=rc,
                timedOut=False,
                attempt=attempt,
                success=False,
                cancelled=True,
                stdoutTail=stdout_s[-2000:] if stdout_s else "",
                stderrTail=stderr_s[-2000:] if stderr_s else "",
            )
            _record_task_process_result(
                ctx,
                node_id,
                exit_code=rc,
                success=False,
                timed_out=False,
                stdout=stdout_s,
                stderr=stderr_s,
                cancelled=True,
            )
            ctx["last_result"] = False
            ctx["_gc_process_cancelled"] = True
            return False

        if timed_out:
            emit(
                "process_complete",
                nodeId=node_id,
                graphId=graph_id,
                exitCode=rc,
                timedOut=True,
                attempt=attempt,
                success=False,
                stdoutTail=stdout_s[-2000:] if stdout_s else "",
                stderrTail=stderr_s[-2000:] if stderr_s else "",
            )
            _record_task_process_result(
                ctx,
                node_id,
                exit_code=rc,
                success=False,
                timed_out=True,
                stdout=stdout_s,
                stderr=stderr_s,
                cancelled=False,
            )
            if attempt < retries:
                emit(
                    "process_retry",
                    nodeId=node_id,
                    graphId=graph_id,
                    attempt=attempt + 1,
                    delaySec=backoff,
                    reason="timeout",
                )
                time.sleep(backoff)
                attempt += 1
                continue
            emit(
                "process_failed",
                nodeId=node_id,
                graphId=graph_id,
                reason="timeout",
                message="llm_agent subprocess timed out",
                attempt=attempt,
            )
            ctx["last_result"] = False
            return False

        terminal_ok = state.finished and state.success
        if rc != 0 or not terminal_ok:
            detail = []
            if state.bad_lines:
                detail.append(f"protocol_issues={len(state.bad_lines)}")
            if not state.finished:
                detail.append("missing_agent_finished")
            elif not state.success:
                detail.append(state.fail_message or "agent_failed")
            emit(
                "process_complete",
                nodeId=node_id,
                graphId=graph_id,
                exitCode=rc,
                timedOut=False,
                attempt=attempt,
                success=False,
                stdoutTail=stdout_s[-2000:] if stdout_s else "",
                stderrTail=stderr_s[-2000:] if stderr_s else "",
            )
            _record_task_process_result(
                ctx,
                node_id,
                exit_code=rc,
                success=False,
                timed_out=False,
                stdout=stdout_s,
                stderr=stderr_s,
                cancelled=False,
            )
            if attempt < retries:
                emit(
                    "process_retry",
                    nodeId=node_id,
                    graphId=graph_id,
                    attempt=attempt + 1,
                    delaySec=backoff,
                    reason="unsuccessful",
                )
                time.sleep(backoff)
                attempt += 1
                continue
            emit(
                "process_failed",
                nodeId=node_id,
                graphId=graph_id,
                reason="unsuccessful",
                message="; ".join(detail) if detail else f"llm_agent exit {rc}",
                attempt=attempt,
            )
            out_map = ctx.setdefault("node_outputs", {})
            entry = out_map.setdefault(node_id, {})
            if isinstance(entry, dict):
                entry["agentResult"] = {
                    "success": False,
                    "result": state.result,
                    "stepCount": state.step_count,
                    "protocolLines": len(state.bad_lines),
                    "errorMessage": state.fail_message,
                }
            ctx["last_result"] = False
            return False

        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=rc,
            timedOut=False,
            attempt=attempt,
            success=True,
            stdoutTail=stdout_s[-2000:] if stdout_s else "",
            stderrTail=stderr_s[-2000:] if stderr_s else "",
        )
        _record_task_process_result(
            ctx,
            node_id,
            exit_code=rc,
            success=True,
            timed_out=False,
            stdout=stdout_s,
            stderr=stderr_s,
            cancelled=False,
        )
        out_map = ctx.setdefault("node_outputs", {})
        entry = out_map.setdefault(node_id, {})
        if isinstance(entry, dict):
            entry["agentResult"] = {
                "success": True,
                "result": state.result,
                "stepCount": state.step_count,
            }
        ctx["last_result"] = True
        return True
