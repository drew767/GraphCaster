# Copyright GraphCaster. All Rights Reserved.

"""RQ worker entry: load graph JSON and execute with `GraphRunner`."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner
from graph_caster.scaling.types import RunJob

_LOG = logging.getLogger(__name__)


def process_run_job_payload(raw: dict[str, Any] | RunJob) -> dict[str, Any]:
    """RQ target: run a graph in-process; returns a small status dict."""
    job = raw if isinstance(raw, RunJob) else RunJob.from_dict(raw)
    path = Path(job.graphs_dir).resolve() / f"{job.graph_id}.json"
    if not path.is_file():
        err = f"graph file not found: {path}"
        _LOG.warning("%s", err)
        return {"run_id": job.run_id, "ok": False, "error": err}
    doc = GraphDocument.from_dict(json.loads(path.read_text(encoding="utf-8")))
    host = RunHostContext(
        graphs_root=Path(job.graphs_dir).resolve(),
        artifacts_base=Path(job.artifacts_base).resolve() if job.artifacts_base else None,
        workspace_root=Path(job.workspace_root).resolve() if job.workspace_root else None,
    )
    ctx = dict(job.context)
    if job.run_id:
        ctx.setdefault("run_id", job.run_id)
    try:
        GraphRunner(doc, sink=lambda _e: None, host=host, run_id=job.run_id or None).run(context=ctx)
    except Exception as e:
        _LOG.exception("process_run_job_payload failed")
        return {"run_id": job.run_id, "ok": False, "error": str(e)}
    return {"run_id": job.run_id, "ok": True}
