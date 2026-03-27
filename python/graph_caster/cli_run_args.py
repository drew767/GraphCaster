# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping


def build_graph_caster_run_argv(
    document_path: Path,
    *,
    run_id: str,
    graphs_dir: Path | None = None,
    artifacts_base: Path | None = None,
    until_node: str | None = None,
    context_json_path: Path | None = None,
    step_cache: bool = False,
    step_cache_dirty: str = "",
) -> list[str]:
    rid = str(run_id).strip()
    if not rid:
        raise ValueError("run_id required")

    argv: list[str] = [
        "run",
        "-d",
        str(document_path),
        "--track-session",
        "--control-stdin",
        "--run-id",
        rid,
    ]
    if graphs_dir is not None and str(graphs_dir).strip():
        argv.extend(["-g", str(Path(graphs_dir))])
    if artifacts_base is not None and str(artifacts_base).strip():
        argv.extend(["--artifacts-base", str(Path(artifacts_base))])
    if step_cache:
        argv.append("--step-cache")
        dirty = (step_cache_dirty or "").strip()
        if dirty:
            argv.extend(["--step-cache-dirty", dirty])
    if until_node is not None and str(until_node).strip():
        argv.extend(["--until-node", str(until_node).strip()])
    if context_json_path is not None and str(context_json_path).strip():
        argv.extend(["--context-json", str(Path(context_json_path))])
    return argv


def run_start_body_to_argv_paths(
    body: Mapping[str, Any],
    *,
    document_path: Path,
    context_json_path: Path | None,
) -> list[str]:
    graphs_dir_raw = body.get("graphsDir")
    artifacts_raw = body.get("artifactsBase")
    graphs_dir = Path(str(graphs_dir_raw)) if graphs_dir_raw and str(graphs_dir_raw).strip() else None
    artifacts_base = Path(str(artifacts_raw)) if artifacts_raw and str(artifacts_raw).strip() else None
    until_raw = body.get("untilNodeId")
    until_node = str(until_raw).strip() if until_raw is not None and str(until_raw).strip() else None
    step_cache = body.get("stepCache") is True
    dirty_raw = body.get("stepCacheDirty")
    step_cache_dirty = str(dirty_raw).strip() if dirty_raw is not None else ""
    run_id = str(body.get("runId") or "").strip()
    if not run_id:
        raise ValueError("runId required")
    return build_graph_caster_run_argv(
        document_path,
        run_id=run_id,
        graphs_dir=graphs_dir,
        artifacts_base=artifacts_base,
        until_node=until_node,
        context_json_path=context_json_path,
        step_cache=step_cache,
        step_cache_dirty=step_cache_dirty,
    )
