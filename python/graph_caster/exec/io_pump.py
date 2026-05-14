# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import queue
import subprocess
import threading
import time
import warnings
from typing import Any, Callable

from graph_caster.exec.process_errors import _terminate_process_graceful

EmitFn = Callable[..., None]

_STDOUT_CAP = 256 * 1024
_CANCEL_POLL_SEC = 0.25
_CANCEL_JOIN_TIMEOUT_SEC = 120.0
_STREAM_READER_JOIN_SEC = 5.0
_MAX_READLINE_CHARS = 32768
_STREAM_QUEUE_MAX = 8192


def _communicate_with_cancel(
    proc: subprocess.Popen,
    timeout: float | None,
    should_cancel: Callable[[], bool],
    *,
    poll_sec: float = _CANCEL_POLL_SEC,
) -> tuple[str, str, bool, bool]:
    lock = threading.Lock()
    state: dict[str, Any] = {"done": False, "out": "", "err": "", "timed_out": False}

    def worker() -> None:
        timed_out = False
        out_b, err_b = "", ""
        try:
            try:
                o, e = proc.communicate(timeout=timeout)
                out_b, err_b = o or "", e or ""
            except subprocess.TimeoutExpired:
                timed_out = True
                _terminate_process_graceful(proc)
                o, e = proc.communicate()
                out_b, err_b = o or "", e or ""
        finally:
            with lock:
                state["out"] = out_b
                state["err"] = err_b
                state["timed_out"] = timed_out
                state["done"] = True

    th = threading.Thread(target=worker, daemon=True)
    th.start()
    while True:
        with lock:
            if state["done"]:
                return (state["out"], state["err"], state["timed_out"], False)
        if should_cancel():
            _terminate_process_graceful(proc)
            th.join(timeout=_CANCEL_JOIN_TIMEOUT_SEC)
            if th.is_alive():
                warnings.warn(
                    "subprocess communicate thread still alive after cancel join timeout",
                    RuntimeWarning,
                    stacklevel=2,
                )
            with lock:
                return (state["out"], state["err"], state["timed_out"], True)
        th.join(timeout=poll_sec)


def _pipe_reader_lines_to_queue(
    pipe: Any,
    stream_label: str,
    q: "queue.Queue[tuple[str, str, bool]]",
) -> None:
    if pipe is None:
        return
    try:
        while True:
            line = pipe.readline()
            if line == "":
                break
            if len(line) > _MAX_READLINE_CHARS:
                line = line[:_MAX_READLINE_CHARS]
            eol = line.endswith("\n")
            q.put((stream_label, line, eol))
    except (BrokenPipeError, ValueError, OSError):
        pass


def _emit_one_process_output(
    name: str,
    text: str,
    eol: bool,
    out_parts: list[str],
    err_parts: list[str],
    emit: EmitFn,
    *,
    node_id: str,
    graph_id: str,
    attempt: int,
    seq: dict[str, int],
) -> None:
    if name == "stdout":
        out_parts.append(text)
        sn = seq["stdout"]
        emit(
            "process_output",
            nodeId=node_id,
            graphId=graph_id,
            stream="stdout",
            text=text,
            seq=sn,
            attempt=attempt,
            eol=eol,
        )
        seq["stdout"] = sn + 1
    else:
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


def _drain_process_output_queue(
    q: "queue.Queue[tuple[str, str, bool]]",
    out_parts: list[str],
    err_parts: list[str],
    emit: EmitFn,
    *,
    node_id: str,
    graph_id: str,
    attempt: int,
    seq: dict[str, int],
) -> None:
    while True:
        try:
            name, text, eol = q.get_nowait()
        except queue.Empty:
            break
        _emit_one_process_output(
            name,
            text,
            eol,
            out_parts,
            err_parts,
            emit,
            node_id=node_id,
            graph_id=graph_id,
            attempt=attempt,
            seq=seq,
        )


def _communicate_with_streaming(
    proc: subprocess.Popen[str],
    emit: EmitFn,
    *,
    node_id: str,
    graph_id: str,
    attempt: int,
    timeout: float | None,
    should_cancel: Callable[[], bool] | None,
) -> tuple[str, str, bool, bool]:
    q: queue.Queue[tuple[str, str, bool]] = queue.Queue(maxsize=_STREAM_QUEUE_MAX)
    out_parts: list[str] = []
    err_parts: list[str] = []
    seq = {"stdout": 0, "stderr": 0}
    t_out = threading.Thread(
        target=_pipe_reader_lines_to_queue,
        args=(proc.stdout, "stdout", q),
        daemon=True,
    )
    t_err = threading.Thread(
        target=_pipe_reader_lines_to_queue,
        args=(proc.stderr, "stderr", q),
        daemon=True,
    )
    t_out.start()
    t_err.start()
    timed_out = False
    cancelled = False
    deadline = time.monotonic() + timeout if timeout is not None else None

    try:
        while proc.poll() is None:
            try:
                name, text, eol = q.get(timeout=_CANCEL_POLL_SEC)
            except queue.Empty:
                if should_cancel is not None and should_cancel():
                    cancelled = True
                    _terminate_process_graceful(proc)
                    break
                if deadline is not None and time.monotonic() >= deadline:
                    timed_out = True
                    _terminate_process_graceful(proc)
                    break
                continue
            _emit_one_process_output(
                name,
                text,
                eol,
                out_parts,
                err_parts,
                emit,
                node_id=node_id,
                graph_id=graph_id,
                attempt=attempt,
                seq=seq,
            )
    finally:
        try:
            proc.wait(timeout=_STREAM_READER_JOIN_SEC)
        except subprocess.TimeoutExpired:
            _terminate_process_graceful(proc)
        t_out.join(timeout=_STREAM_READER_JOIN_SEC)
        t_err.join(timeout=_STREAM_READER_JOIN_SEC)
        _drain_process_output_queue(
            q, out_parts, err_parts, emit, node_id=node_id, graph_id=graph_id, attempt=attempt, seq=seq
        )

    stdout = ("".join(out_parts))[:_STDOUT_CAP]
    stderr = ("".join(err_parts))[:_STDOUT_CAP]
    return (stdout, stderr, timed_out, cancelled)
