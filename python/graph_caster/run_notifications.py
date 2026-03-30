# Copyright GraphCaster. All Rights Reserved.

"""Optional run-completion webhook (Slack/Teams/generic HTTPS)."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any

_LOG = logging.getLogger(__name__)


def _parse_status_filter() -> set[str] | None:
    raw = os.environ.get("GC_RUN_NOTIFY_ON_STATUS", "").strip()
    if not raw:
        return None
    parts = {p.strip().lower() for p in raw.split(",") if p.strip()}
    allowed = {"success", "failed", "cancelled", "partial"}
    return {p for p in parts if p in allowed} or None


def deliver_run_finished_webhook_maybe(payload: dict[str, Any]) -> None:
    """POST **payload** to ``GC_RUN_NOTIFY_WEBHOOK_URL`` if set; errors are logged, never raised."""
    url = os.environ.get("GC_RUN_NOTIFY_WEBHOOK_URL", "").strip()
    if not url:
        return
    st = str(payload.get("status") or "").strip().lower()
    filt = _parse_status_filter()
    if filt is not None and st not in filt:
        return
    timeout_raw = os.environ.get("GC_RUN_NOTIFY_WEBHOOK_TIMEOUT_SEC", "15").strip()
    try:
        timeout = float(timeout_raw)
    except ValueError:
        timeout = 15.0
    timeout = max(1.0, min(120.0, timeout))

    headers: dict[str, str] = {"Content-Type": "application/json"}
    extra = os.environ.get("GC_RUN_NOTIFY_WEBHOOK_HEADERS_JSON", "").strip()
    if extra:
        try:
            parsed = json.loads(extra)
            if isinstance(parsed, dict):
                for k, v in parsed.items():
                    if isinstance(k, str) and v is not None:
                        headers[k] = str(v)
        except (json.JSONDecodeError, TypeError):
            _LOG.warning("GC_RUN_NOTIFY_WEBHOOK_HEADERS_JSON is not a JSON object; ignored")

    body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            _ = resp.read()
    except urllib.error.HTTPError as e:
        _LOG.warning("run notify webhook HTTP %s: %s", e.code, e.reason)
    except OSError as e:
        _LOG.warning("run notify webhook failed: %s", e)
