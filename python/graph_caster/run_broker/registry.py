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
from pathlib import Path

from graph_caster.cli_run_args import run_start_body_to_argv_paths
from graph_caster.run_broker.broadcaster import FanOutMsg, RunBroadcaster, RunBroadcasterConfig
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


def _merge_pythonpath_from_env(env: dict[str, str], package_root: str | None) -> None:
    if not package_root or not str(package_root).strip():
        return
    sep = ";" if os.name == "nt" else ":"
    prev = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = package_root if not prev else f"{package_root}{sep}{prev}"


class RegisteredRun:
    def __init__(
        self,
        run_id: str,
        proc: subprocess.Popen[str],
        broadcaster: RunBroadcaster,
        temp_paths: list[Path],
        viewer_token: str,
    ) -> None:
        self.run_id = run_id
        self.proc = proc
        self.broadcaster = broadcaster
        self.temp_paths = temp_paths
        self.viewer_token = viewer_token


class RunBrokerRegistry:
    def __init__(self) -> None:
        self._runs: dict[str, RegisteredRun] = {}
        self._lock = threading.Lock()

    def get(self, run_id: str) -> RegisteredRun | None:
        with self._lock:
            return self._runs.get(run_id)

    def _cleanup_temp(self, paths: list[Path]) -> None:
        for p in paths:
            try:
                p.unlink(missing_ok=True)
            except OSError:
                pass

    def spawn_from_body(self, body: dict) -> str:
        doc_json = body.get("documentJson")
        if not isinstance(doc_json, str) or not doc_json.strip():
            raise ValueError("documentJson required")

        run_id = str(body.get("runId") or "").strip() or str(uuid.uuid4())
        merged = {**body, "runId": run_id}

        with self._lock:
            if len(self._runs) >= _max_concurrent_runs():
                raise ValueError("max concurrent runs reached")

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

            env = os.environ.copy()
            _merge_pythonpath_from_env(env, os.environ.get("GC_GRAPH_CASTER_PACKAGE_ROOT"))

            broadcaster = RunBroadcaster(
                run_id=run_id,
                config=RunBroadcasterConfig(max_sub_queue_depth=_sub_queue_max()),
            )
            viewer_token = secrets.token_urlsafe(24)
            cmd = [sys.executable, "-m", "graph_caster", *argv]
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
            cap = _max_concurrent_runs()
            if len(self._runs) >= cap:
                proc.terminate()
                try:
                    proc.wait(timeout=5.0)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=5.0)
                self._cleanup_temp(temp_paths)
                raise ValueError("max concurrent runs reached")
            self._runs[run_id] = RegisteredRun(run_id, proc, broadcaster, temp_paths, viewer_token)

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
                self._cleanup_temp(temp_paths)

        threading.Thread(target=waiter, daemon=True).start()
        return run_id

    def cancel(self, run_id: str) -> bool:
        reg = self.get(run_id)
        if reg is None:
            return False
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
