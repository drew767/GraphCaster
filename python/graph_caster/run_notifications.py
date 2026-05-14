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


def _status_color_slack(status: str) -> str:
    return "good" if status == "success" else "danger"


def _status_emoji(status: str) -> str:
    return ":white_check_mark:" if status == "success" else ":x:"


def _build_slack_body(payload: dict[str, Any]) -> dict[str, Any]:
    status = str(payload.get("status") or "unknown")
    run_id = str(payload.get("runId") or "")
    graph_id = str(payload.get("rootGraphId") or "")
    duration_ms = payload.get("durationMs") or 0
    error_count = payload.get("errorCount") or 0
    emoji = _status_emoji(status)
    errors = payload.get("errors") or []
    error_text = ""
    if errors:
        msgs = [str(e.get("message") or "") for e in errors[:3]]
        error_text = "\n".join(f"• {m}" for m in msgs)

    blocks: list[dict[str, Any]] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"{emoji} Run {status.upper()}", "emoji": True},
        },
        {
            "type": "section",
            "fields": [
                {"type": "mrkdwn", "text": f"*Graph:*\n{graph_id}"},
                {"type": "mrkdwn", "text": f"*Run ID:*\n{run_id}"},
                {"type": "mrkdwn", "text": f"*Duration:*\n{duration_ms}ms"},
                {"type": "mrkdwn", "text": f"*Errors:*\n{error_count}"},
            ],
        },
    ]
    if error_text:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": f"*Errors:*\n{error_text}"},
        })
    return {"blocks": blocks}


def _build_discord_body(payload: dict[str, Any]) -> dict[str, Any]:
    status = str(payload.get("status") or "unknown")
    run_id = str(payload.get("runId") or "")
    graph_id = str(payload.get("rootGraphId") or "")
    duration_ms = payload.get("durationMs") or 0
    color = 0x2ECC71 if status == "success" else 0xE74C3C
    errors = payload.get("errors") or []
    desc_parts = [
        f"**Graph:** {graph_id}",
        f"**Run ID:** {run_id}",
        f"**Duration:** {duration_ms}ms",
    ]
    if errors:
        msgs = [str(e.get("message") or "") for e in errors[:3]]
        desc_parts.append("**Errors:**\n" + "\n".join(f"- {m}" for m in msgs))
    return {
        "embeds": [
            {
                "title": f"Run {status.upper()}",
                "color": color,
                "description": "\n".join(desc_parts),
            }
        ]
    }


def _build_teams_body(payload: dict[str, Any]) -> dict[str, Any]:
    status = str(payload.get("status") or "unknown")
    run_id = str(payload.get("runId") or "")
    graph_id = str(payload.get("rootGraphId") or "")
    duration_ms = payload.get("durationMs") or 0
    theme_color = "00b300" if status == "success" else "b30000"
    errors = payload.get("errors") or []
    facts = [
        {"name": "Status", "value": status},
        {"name": "Graph", "value": graph_id},
        {"name": "Run ID", "value": run_id},
        {"name": "Duration", "value": f"{duration_ms}ms"},
    ]
    if errors:
        msgs = "; ".join(str(e.get("message") or "") for e in errors[:3])
        facts.append({"name": "Errors", "value": msgs})
    return {
        "@type": "MessageCard",
        "@context": "http://schema.org/extensions",
        "themeColor": theme_color,
        "summary": f"Run {status}",
        "sections": [{"facts": facts}],
    }


def _render_template(template: str, payload: dict[str, Any]) -> dict[str, Any]:
    t = template.strip().lower()
    if t == "slack":
        return _build_slack_body(payload)
    if t == "discord":
        return _build_discord_body(payload)
    if t == "teams":
        return _build_teams_body(payload)
    return payload


def deliver_run_finished_webhook_maybe(
    payload: dict[str, Any],
    *,
    graph_meta: dict[str, Any] | None = None,
) -> None:
    """POST **payload** to ``GC_RUN_NOTIFY_WEBHOOK_URL`` if set; errors are logged, never raised.

    Template selection (in priority order):
    1. ``graph_meta["notifyTemplate"]`` if non-empty
    2. ``GC_RUN_NOTIFY_TEMPLATE`` env var
    3. ``"generic"`` (raw payload)
    """
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

    # Determine template
    template = ""
    if graph_meta:
        template = str(graph_meta.get("notifyTemplate") or "").strip()
    if not template:
        template = os.environ.get("GC_RUN_NOTIFY_TEMPLATE", "").strip()
    if not template:
        template = "generic"

    rendered = _render_template(template, payload)

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

    body = json.dumps(rendered, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            _ = resp.read()
    except urllib.error.HTTPError as e:
        _LOG.warning("run notify webhook HTTP %s: %s", e.code, e.reason)
    except OSError as e:
        _LOG.warning("run notify webhook failed: %s", e)
