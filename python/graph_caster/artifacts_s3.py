# Copyright GraphCaster. All Rights Reserved.

"""Upload persisted run directories to S3 after ``run-summary.json`` is written (optional)."""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any

_LOG = logging.getLogger(__name__)


def _upload_run_dir_sync(
    *,
    run_dir: Path,
    graph_id: str,
    run_id: str,
    bucket: str,
    prefix: str,
    region: str | None,
) -> None:
    try:
        import boto3  # type: ignore[import-untyped]
        from botocore.exceptions import BotoCoreError, ClientError  # type: ignore[import-untyped]
    except ImportError as e:
        _LOG.warning("S3 upload skipped: boto3 not installed (%s)", e)
        return

    gid = str(graph_id).strip().replace("/", "_").replace("\\", "_")
    rid = str(run_id).strip().replace("/", "_").replace("\\", "_")
    base_key = f"{prefix.strip().strip('/')}/{gid}/{rid}".strip("/")
    kwargs: dict[str, Any] = {}
    if region:
        kwargs["region_name"] = region.strip()
    client = boto3.client("s3", **kwargs)
    rd = Path(run_dir).resolve()
    if not rd.is_dir():
        return
    for p in rd.rglob("*"):
        if not p.is_file():
            continue
        rel = p.relative_to(rd).as_posix()
        key = f"{base_key}/{rel}" if base_key else rel
        try:
            client.upload_file(str(p), bucket, key)
        except (OSError, ClientError, BotoCoreError):
            _LOG.debug("S3 upload failed for %s", key, exc_info=True)


def schedule_run_dir_upload_maybe(
    run_dir: Path,
    *,
    graph_id: str,
    run_id: str,
) -> None:
    bucket = os.environ.get("GC_RUN_ARTIFACTS_S3_BUCKET", "").strip()
    if not bucket:
        return
    prefix = os.environ.get("GC_RUN_ARTIFACTS_S3_PREFIX", "graphcaster-runs").strip()
    region = os.environ.get("GC_RUN_ARTIFACTS_S3_REGION", "").strip() or None

    def _job() -> None:
        try:
            _upload_run_dir_sync(
                run_dir=run_dir,
                graph_id=graph_id,
                run_id=run_id,
                bucket=bucket,
                prefix=prefix,
                region=region,
            )
        except Exception:
            _LOG.debug("S3 upload thread failed", exc_info=True)

    t = threading.Thread(target=_job, name="gc-s3-upload", daemon=False)
    t.start()
