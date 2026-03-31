# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import os
import secrets
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from graph_caster.cli_run_args import run_start_body_to_argv_paths
from graph_caster.execution.pool_sizing import fork_threadpool_env_ceiling_for_metrics
from graph_caster.run_broker.broadcaster import FanOutMsg, RunBroadcaster, RunBroadcasterConfig
from graph_caster.run_broker.errors import PendingQueueFullError
from graph_caster.run_broker.redis_coord import release_global_run_slot, try_acquire_global_run_slot
from graph_caster.run_broker.relay.broker_sync import relay_fanout_hook_for_run
from graph_caster.run_broker.worker_lost import (
    build_coordinator_worker_lost_run_finished_line,
    new_run_stdout_tracker,
    should_emit_coordinator_worker_lost,
    track_stdout_line_for_worker_terminal,
)


def _sub_queue_max() -> int:
    raw = os.environ.get("GC_RUN_BROKER_SUB_QUEUE_MAX", "8192").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 8192
    return max(64, min(131_072, n))


def _max_concurrent_runs() -> int:
    raw = os.environ.get("GC_RUN_BROKER_MAX_RUNS", "2").strip()
    try:
        n = int(raw)
    except ValueError:
        return 2
    return max(1, min(32, n))


def _pending_max() -> int:
    raw = os.environ.get("GC_RUN_BROKER_PENDING_MAX", "128").strip()
    try:
        n = int(raw)
    except ValueError:
        n = 128
    return max(1, min(1024, n))


def _new_run_broadcaster(run_id: str) -> RunBroadcaster:
    return RunBroadcaster(
        run_id=run_id,
        config=RunBroadcasterConfig(max_sub_queue_depth=_sub_queue_max()),
        relay_fanout_hook=relay_fanout_hook_for_run(run_id),
    )


def _merge_pythonpath_from_env(env: dict[str, str], package_root: str | None) -> None:
    if not package_root or not str(package_root).strip():
        return
    sep = ";" if os.name == "nt" else ":"
    prev = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = package_root if not prev else f"{package_root}{sep}{prev}"


@dataclass(frozen=True)
class SpawnResult:
    """Outcome of :meth:`RunBrokerRegistry.spawn_from_body`.

    ``queue_position``: for ``phase == "queued"``, 1-based index at enqueue time only;
    it does not shrink when earlier queued runs finish or are cancelled. Always ``0``
    when ``phase == "running"``. Matches ``runBroker.queuePosition`` in HTTP responses.
    """

    run_id: str
    viewer_token: str
    phase: Literal["running", "queued"]
    queue_position: int


class RegisteredRun:
    def __init__(
        self,
        run_id: str,
        proc: subprocess.Popen[str] | None,
        broadcaster: RunBroadcaster,
        temp_paths: list[Path],
        viewer_token: str,
        worker_argv: list[str],
    ) -> None:
        self.run_id = run_id
        self.proc = proc
        self.broadcaster = broadcaster
        self.temp_paths = temp_paths
        self.viewer_token = viewer_token
        self.worker_argv = worker_argv


class RunBrokerRegistry:
    def __init__(self) -> None:
        self._runs: dict[str, RegisteredRun] = {}
        self._pending_fifo: deque[str] = deque()
        self._run_graph_ids: dict[str, str] = {}
        self._lock = threading.Lock()

    def bind_run_graph_id(self, run_id: str, graph_id: str) -> None:
        """Remember **meta.graphId** for a **run_id** (for status/events after the worker exits)."""
        rid, gid = str(run_id).strip(), str(graph_id).strip()
        if not rid or not gid:
            return
        with self._lock:
            self._run_graph_ids[rid] = gid

    def get_graph_id_for_run(self, run_id: str) -> str | None:
        with self._lock:
            return self._run_graph_ids.get(run_id)

    def get(self, run_id: str) -> RegisteredRun | None:
        with self._lock:
            return self._runs.get(run_id)

    def debug_broadcaster_metrics(self) -> list[dict[str, object]]:
        """Per-run SSE/WS fan-out stats (for ``GET /health?debug=1``)."""
        with self._lock:
            return [r.broadcaster.metrics_snapshot() for r in self._runs.values()]

    def prometheus_metrics_text(self) -> str:
        """Minimal Prometheus **text** exposition (no extra dependencies)."""
        with self._lock:
            n_reg = len(self._runs)
            n_run = self._running_count()
            n_pend = len(self._pending_fifo)
            n_cap = _max_concurrent_runs()
            pend_cap = _pending_max()
        fork_tp_cap = fork_threadpool_env_ceiling_for_metrics()
        lines = [
            "# HELP gc_run_broker_workers_active Child runner processes currently held by the broker.",
            "# TYPE gc_run_broker_workers_active gauge",
            f"gc_run_broker_workers_active {n_run}",
            "# HELP gc_run_broker_registered_runs Runs still tracked (running or draining).",
            "# TYPE gc_run_broker_registered_runs gauge",
            f"gc_run_broker_registered_runs {n_reg}",
            "# HELP gc_run_broker_pending_queue_depth FIFO depth for queued starts.",
            "# TYPE gc_run_broker_pending_queue_depth gauge",
            f"gc_run_broker_pending_queue_depth {n_pend}",
            "# HELP gc_run_broker_max_concurrent_config Effective max concurrent workers from env.",
            "# TYPE gc_run_broker_max_concurrent_config gauge",
            f"gc_run_broker_max_concurrent_config {n_cap}",
            "# HELP gc_run_broker_pending_max_config Pending FIFO capacity from env.",
            "# TYPE gc_run_broker_pending_max_config gauge",
            f"gc_run_broker_pending_max_config {pend_cap}",
            "# HELP gc_graph_fork_threadpool_max_config Fork frontier threadpool ceiling from GC_GRAPH_FORK_THREADPOOL_MAX (0 if unset).",
            "# TYPE gc_graph_fork_threadpool_max_config gauge",
            f"gc_graph_fork_threadpool_max_config {fork_tp_cap}",
        ]
        from graph_caster.run_broker.redis_coord import global_active_workers_gauge, redis_coord_config

        rcfg = redis_coord_config()
        if rcfg is not None:
            lines.extend(
                [
                    "# HELP gc_run_broker_redis_global_limit Configured cluster-wide worker cap (Redis).",
                    "# TYPE gc_run_broker_redis_global_limit gauge",
                    f"gc_run_broker_redis_global_limit {rcfg.global_limit}",
                ]
            )
            g = global_active_workers_gauge()
            if g is not None:
                lines.extend(
                    [
                        "# HELP gc_run_broker_redis_global_active Workers counted in Redis across brokers.",
                        "# TYPE gc_run_broker_redis_global_active gauge",
                        f"gc_run_broker_redis_global_active {g}",
                    ]
                )
        lines.append("")
        return "\n".join(lines)

    def _running_count(self) -> int:
        return sum(1 for r in self._runs.values() if r.proc is not None)

    def _cleanup_temp(self, paths: list[Path]) -> None:
        for p in paths:
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass

    def _remove_from_pending_fifo_unlocked(self, run_id: str) -> None:
        try:
            self._pending_fifo.remove(run_id)
        except ValueError:
            pass

    @staticmethod
    def _build_queued_notice_line(run_id: str, queue_position: int) -> str:
        return json.dumps(
            {
                "type": "run_broker_queued",
                "runId": run_id,
                "queuePosition": queue_position,
            },
            separators=(",", ":"),
        )

    def _attach_worker_pumps(
        self,
        run_id: str,
        proc: subprocess.Popen[str],
        broadcaster: RunBroadcaster,
        temp_paths: list[Path],
    ) -> None:
        tracker = new_run_stdout_tracker()

        def pump_out() -> None:
            assert proc.stdout is not None
            for line in iter(proc.stdout.readline, ""):
                if not line:
                    break
                text = line.rstrip("\r\n")
                broadcaster.broadcast(FanOutMsg("out", text))
                track_stdout_line_for_worker_terminal(text, expected_run_id=run_id, tracker=tracker)
            try:
                proc.stdout.close()
            except OSError:
                pass

        def pump_err() -> None:
            assert proc.stderr is not None
            for line in iter(proc.stderr.readline, ""):
                if not line:
                    break
                text = line.rstrip("\r\n")
                broadcaster.broadcast(FanOutMsg("err", json.dumps({"line": text})))
            try:
                proc.stderr.close()
            except OSError:
                pass

        def waiter() -> None:
            th_out = threading.Thread(target=pump_out, daemon=True)
            th_err = threading.Thread(target=pump_err, daemon=True)
            th_out.start()
            th_err.start()
            try:
                code = proc.wait()
            finally:
                th_out.join(timeout=60.0)
                th_err.join(timeout=60.0)
                exit_c = int(code) if code is not None else -1
                if should_emit_coordinator_worker_lost(tracker):
                    rg = tracker.get("root_graph_id")
                    gid = rg if isinstance(rg, str) and rg.strip() else "unknown"
                    syn = build_coordinator_worker_lost_run_finished_line(
                        run_id=run_id,
                        root_graph_id=gid,
                        worker_process_exit_code=exit_c,
                    )
                    broadcaster.broadcast(FanOutMsg("out", syn))
                broadcaster.broadcast(FanOutMsg("exit", exit_c))
                with self._lock:
                    self._runs.pop(run_id, None)
                release_global_run_slot()
                self._cleanup_temp(temp_paths)
                self._promote_fill()

        threading.Thread(target=waiter, daemon=True).start()

    def _promote_fill(self) -> None:
        while True:
            promote_id: str | None = None
            entry: RegisteredRun | None = None
            with self._lock:
                if self._running_count() >= _max_concurrent_runs():
                    return
                while self._pending_fifo:
                    nid = self._pending_fifo[0]
                    ent = self._runs.get(nid)
                    if ent is None:
                        self._pending_fifo.popleft()
                        continue
                    if ent.proc is not None:
                        self._pending_fifo.popleft()
                        continue
                    self._pending_fifo.popleft()
                    promote_id = nid
                    entry = ent
                    break
                else:
                    return

            assert promote_id is not None and entry is not None
            env = os.environ.copy()
            _merge_pythonpath_from_env(env, os.environ.get("GC_GRAPH_CASTER_PACKAGE_ROOT"))
            cmd = [sys.executable, "-m", "graph_caster", *entry.worker_argv]
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    env=env,
                )
            except OSError:
                with self._lock:
                    if self._runs.get(promote_id) is entry and entry.proc is None:
                        self._pending_fifo.appendleft(promote_id)
                continue

            with self._lock:
                cur = self._runs.get(promote_id)
                if cur is not entry or entry.proc is not None:
                    proc.terminate()
                    try:
                        proc.wait(timeout=5.0)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait(timeout=5.0)
                    if cur is entry and entry.proc is None:
                        self._pending_fifo.appendleft(promote_id)
                    continue
                if self._running_count() >= _max_concurrent_runs():
                    proc.terminate()
                    try:
                        proc.wait(timeout=5.0)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait(timeout=5.0)
                    self._pending_fifo.appendleft(promote_id)
                    continue
                if not try_acquire_global_run_slot():
                    proc.terminate()
                    try:
                        proc.wait(timeout=5.0)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait(timeout=5.0)
                    self._pending_fifo.appendleft(promote_id)
                    continue
                entry.proc = proc

            self._attach_worker_pumps(promote_id, proc, entry.broadcaster, entry.temp_paths)

    def spawn_from_body(self, body: dict) -> SpawnResult:
        doc_json = body.get("documentJson")
        if not isinstance(doc_json, str) or not doc_json.strip():
            raise ValueError("documentJson required")

        run_id = str(body.get("runId") or "").strip() or str(uuid.uuid4())
        merged = {**body, "runId": run_id}
        if merged.get("publicStream") is not True:
            _ps = (os.environ.get("GC_RUN_BROKER_PUBLIC_STREAM") or "").strip().lower()
            if _ps in ("1", "true", "yes", "on"):
                merged = {**merged, "publicStream": True}

        temp_paths: list[Path] = []
        try:
            tmp_doc = (
                Path(tempfile.gettempdir())
                / f"gc-broker-doc-{run_id}-{os.getpid()}-{time.time_ns()}.json"
            )
            tmp_doc.write_text(doc_json, encoding="utf-8")
            temp_paths.append(tmp_doc)

            ctx_path: Path | None = None
            ctx_disk = merged.get("contextJsonPath")
            if ctx_disk is not None and str(ctx_disk).strip():
                ctx_path = Path(str(ctx_disk).strip())
            else:
                ctx_raw = merged.get("contextJson")
                if ctx_raw is not None and str(ctx_raw).strip():
                    tmp_ctx = (
                        Path(tempfile.gettempdir())
                        / f"gc-broker-ctx-{run_id}-{os.getpid()}-{time.time_ns()}.json"
                    )
                    if isinstance(ctx_raw, (dict, list)):
                        tmp_ctx.write_text(json.dumps(ctx_raw), encoding="utf-8")
                    else:
                        tmp_ctx.write_text(str(ctx_raw), encoding="utf-8")
                    ctx_path = tmp_ctx
                    temp_paths.append(tmp_ctx)

            argv = run_start_body_to_argv_paths(merged, document_path=tmp_doc, context_json_path=ctx_path)
        except Exception:
            self._cleanup_temp(temp_paths)
            raise

        with self._lock:
            if run_id in self._runs:
                self._cleanup_temp(temp_paths)
                raise ValueError("runId already active")
            if self._running_count() >= _max_concurrent_runs():
                if len(self._pending_fifo) >= _pending_max():
                    self._cleanup_temp(temp_paths)
                    raise PendingQueueFullError()
                broadcaster = _new_run_broadcaster(run_id)
                viewer_token = secrets.token_urlsafe(24)
                rr = RegisteredRun(
                    run_id,
                    None,
                    broadcaster,
                    temp_paths,
                    viewer_token,
                    argv,
                )
                self._runs[run_id] = rr
                self._pending_fifo.append(run_id)
                pos = len(self._pending_fifo)
                broadcaster.broadcast(FanOutMsg("out", self._build_queued_notice_line(run_id, pos)))
                return SpawnResult(run_id, viewer_token, "queued", pos)

        broadcaster = _new_run_broadcaster(run_id)
        viewer_token = secrets.token_urlsafe(24)
        env = os.environ.copy()
        _merge_pythonpath_from_env(env, os.environ.get("GC_GRAPH_CASTER_PACKAGE_ROOT"))
        cmd = [sys.executable, "-m", "graph_caster", *argv]
        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
            )
        except Exception:
            self._cleanup_temp(temp_paths)
            raise

        with self._lock:
            if run_id in self._runs:
                proc.terminate()
                try:
                    proc.wait(timeout=5.0)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5.0)
                self._cleanup_temp(temp_paths)
                raise ValueError("runId already active")
            if self._running_count() >= _max_concurrent_runs():
                proc.terminate()
                try:
                    proc.wait(timeout=5.0)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5.0)
                if len(self._pending_fifo) >= _pending_max():
                    self._cleanup_temp(temp_paths)
                    raise PendingQueueFullError()
                rr = RegisteredRun(run_id, None, broadcaster, temp_paths, viewer_token, argv)
                self._runs[run_id] = rr
                self._pending_fifo.append(run_id)
                pos = len(self._pending_fifo)
                broadcaster.broadcast(FanOutMsg("out", self._build_queued_notice_line(run_id, pos)))
                return SpawnResult(run_id, viewer_token, "queued", pos)
            if not try_acquire_global_run_slot():
                proc.terminate()
                try:
                    proc.wait(timeout=5.0)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5.0)
                if len(self._pending_fifo) >= _pending_max():
                    self._cleanup_temp(temp_paths)
                    raise PendingQueueFullError()
                rr = RegisteredRun(run_id, None, broadcaster, temp_paths, viewer_token, argv)
                self._runs[run_id] = rr
                self._pending_fifo.append(run_id)
                pos = len(self._pending_fifo)
                broadcaster.broadcast(FanOutMsg("out", self._build_queued_notice_line(run_id, pos)))
                return SpawnResult(run_id, viewer_token, "queued", pos)
            self._runs[run_id] = RegisteredRun(run_id, proc, broadcaster, temp_paths, viewer_token, argv)

        self._attach_worker_pumps(run_id, proc, broadcaster, temp_paths)
        return SpawnResult(run_id, viewer_token, "running", 0)

    def cancel(self, run_id: str) -> bool:
        with self._lock:
            reg = self._runs.get(run_id)
            if reg is None:
                return False
            if reg.proc is None:
                self._runs.pop(run_id, None)
                self._remove_from_pending_fifo_unlocked(run_id)
                temp_paths = list(reg.temp_paths)
                bc = reg.broadcaster
            else:
                proc = reg.proc
                if proc.stdin is None:
                    return False
                try:
                    line = json.dumps({"type": "cancel_run", "runId": run_id}) + "\n"
                    proc.stdin.write(line)
                    proc.stdin.flush()
                except OSError:
                    return False
                return True

        bc.broadcast(FanOutMsg("exit", -1))
        self._cleanup_temp(temp_paths)
        self._promote_fill()
        return True
