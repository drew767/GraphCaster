# Copyright GraphCaster. All Rights Reserved.

"""Webhook payload templates for Slack, Discord, MS Teams and generic JSON (F89)."""

from __future__ import annotations

import logging
import os
from abc import ABC, abstractmethod
from typing import ClassVar

_LOG = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Status helpers
# ---------------------------------------------------------------------------

_STATUS_EMOJI: dict[str, str] = {
    "success": "✅",   # ✅
    "failed": "❌",    # ❌
    "cancelled": "⚠️",  # ⚠️
    "partial": "\U0001f7e1",  # 🟡
}

_STATUS_SLACK_COLOR: dict[str, str] = {
    "success": "good",
    "failed": "danger",
    "cancelled": "warning",
    "partial": "warning",
}

_STATUS_DISCORD_COLOR: dict[str, int] = {
    "success": 0x2ECC71,   # green
    "failed": 0xE74C3C,    # red
    "cancelled": 0xF1C40F,  # yellow
    "partial": 0xF1C40F,   # yellow
}

_STATUS_TEAMS_COLOR: dict[str, str] = {
    "success": "00b300",
    "failed": "cc0000",
    "cancelled": "ffa500",
    "partial": "ffa500",
}


def _emoji(status: str) -> str:
    return _STATUS_EMOJI.get(status.lower(), "ℹ️")  # ℹ️ fallback


def _label(status: str) -> str:
    st = status.lower()
    labels = {
        "success": "Run succeeded",
        "failed": "Run failed",
        "cancelled": "Run cancelled",
        "partial": "Run partially completed",
    }
    return labels.get(st, f"Run {status}")


def _ui_url(run_summary: dict) -> str | None:
    base = os.environ.get("GC_RUN_UI_BASE_URL", "").strip().rstrip("/")
    if not base:
        return None
    run_id = run_summary.get("runId", "")
    if run_id:
        return f"{base}/runs/{run_id}"
    return base


def _safe_str(val: object, default: str = "") -> str:
    if val is None:
        return default
    return str(val)


def _duration_str(run_summary: dict) -> str:
    dur = run_summary.get("durationMs") or run_summary.get("duration_ms")
    if dur is not None:
        try:
            secs = float(dur) / 1000.0
            return f"{secs:.1f}s"
        except (TypeError, ValueError):
            pass
    return ""


def _first_error(run_summary: dict) -> str | None:
    """Extract the first error message from run_summary, if any."""
    errors = run_summary.get("errors") or []
    if isinstance(errors, list) and errors:
        e = errors[0]
        if isinstance(e, dict):
            return _safe_str(e.get("message") or e.get("msg") or e.get("error"))
        return _safe_str(e)
    error = run_summary.get("error") or run_summary.get("errorMessage")
    if error:
        return _safe_str(error)
    return None


def _node_count(run_summary: dict) -> int | None:
    nc = run_summary.get("nodeCount") or run_summary.get("node_count")
    if nc is not None:
        try:
            return int(nc)
        except (TypeError, ValueError):
            pass
    return None


def _error_count(run_summary: dict) -> int | None:
    ec = run_summary.get("errorCount") or run_summary.get("error_count")
    if ec is not None:
        try:
            return int(ec)
        except (TypeError, ValueError):
            pass
    errors = run_summary.get("errors")
    if isinstance(errors, list):
        return len(errors)
    return None


# ---------------------------------------------------------------------------
# Base class
# ---------------------------------------------------------------------------


class WebhookTemplate(ABC):
    name: ClassVar[str] = "base"

    @abstractmethod
    def render(self, run_summary: dict) -> dict:
        """Return a body dict ready to POST to the webhook."""

    @abstractmethod
    def content_type(self) -> str: ...


# ---------------------------------------------------------------------------
# Generic (passthrough)
# ---------------------------------------------------------------------------


class GenericTemplate(WebhookTemplate):
    """Pass the existing F27 payload through unchanged."""

    name: ClassVar[str] = "generic"

    def render(self, run_summary: dict) -> dict:
        return dict(run_summary)

    def content_type(self) -> str:
        return "application/json"


# ---------------------------------------------------------------------------
# Slack (Block Kit)
# ---------------------------------------------------------------------------


class SlackTemplate(WebhookTemplate):
    """Build a Slack Block Kit message."""

    name: ClassVar[str] = "slack"

    def render(self, run_summary: dict) -> dict:
        status = _safe_str(run_summary.get("status"), "unknown").lower()
        emoji = _emoji(status)
        header_text = f"{emoji} {_label(status)}"

        blocks: list[dict] = [
            {
                "type": "header",
                "text": {"type": "plain_text", "text": header_text, "emoji": True},
            }
        ]

        # Context: graphId, runId, duration
        context_elements: list[dict] = []
        graph_id = _safe_str(run_summary.get("rootGraphId") or run_summary.get("graphId"))
        run_id = _safe_str(run_summary.get("runId"))
        dur = _duration_str(run_summary)

        context_parts: list[str] = []
        if graph_id:
            context_parts.append(f"*Graph:* {graph_id}")
        if run_id:
            context_parts.append(f"*Run:* {run_id}")
        if dur:
            context_parts.append(f"*Duration:* {dur}")

        if context_parts:
            context_elements.append(
                {"type": "mrkdwn", "text": " | ".join(context_parts)}
            )

        if context_elements:
            blocks.append({"type": "context", "elements": context_elements})

        # Stats section
        stats_parts: list[str] = []
        nc = _node_count(run_summary)
        ec = _error_count(run_summary)
        if nc is not None:
            stats_parts.append(f"*Nodes:* {nc}")
        if ec is not None:
            stats_parts.append(f"*Errors:* {ec}")
        if stats_parts:
            blocks.append(
                {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": " | ".join(stats_parts)},
                }
            )

        # Error code block on failure
        if status == "failed":
            first_err = _first_error(run_summary)
            if first_err:
                blocks.append(
                    {
                        "type": "section",
                        "text": {
                            "type": "mrkdwn",
                            "text": f"*Error:*\n```{first_err}```",
                        },
                    }
                )

        # Footer link
        ui_url = _ui_url(run_summary)
        if ui_url:
            blocks.append(
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "View Run", "emoji": True},
                            "url": ui_url,
                        }
                    ],
                }
            )

        return {"blocks": blocks}

    def content_type(self) -> str:
        return "application/json"


# ---------------------------------------------------------------------------
# Discord (Embeds)
# ---------------------------------------------------------------------------


class DiscordTemplate(WebhookTemplate):
    """Build a Discord webhook embed message."""

    name: ClassVar[str] = "discord"

    def render(self, run_summary: dict) -> dict:
        status = _safe_str(run_summary.get("status"), "unknown").lower()
        emoji = _emoji(status)
        color = _STATUS_DISCORD_COLOR.get(status, 0x95A5A6)  # grey fallback

        title = f"{emoji} {_label(status)}"
        description_parts: list[str] = []

        graph_id = _safe_str(run_summary.get("rootGraphId") or run_summary.get("graphId"))
        run_id = _safe_str(run_summary.get("runId"))
        dur = _duration_str(run_summary)

        if graph_id:
            description_parts.append(f"**Graph:** {graph_id}")
        if run_id:
            description_parts.append(f"**Run:** {run_id}")
        if dur:
            description_parts.append(f"**Duration:** {dur}")

        nc = _node_count(run_summary)
        ec = _error_count(run_summary)
        if nc is not None:
            description_parts.append(f"**Nodes:** {nc}")
        if ec is not None:
            description_parts.append(f"**Errors:** {ec}")

        description = "\n".join(description_parts) if description_parts else ""

        fields: list[dict] = []
        finished_at = _safe_str(run_summary.get("finishedAt"))
        if finished_at:
            fields.append({"name": "Finished", "value": finished_at, "inline": True})

        if status == "failed":
            first_err = _first_error(run_summary)
            if first_err:
                err_val = first_err[:1000]
                fields.append({"name": "Error", "value": f"```{err_val}```", "inline": False})

        embed: dict = {
            "title": title,
            "color": color,
        }
        if description:
            embed["description"] = description
        if fields:
            embed["fields"] = fields

        finished_at_ts = run_summary.get("finishedAt")
        if finished_at_ts:
            embed["timestamp"] = _safe_str(finished_at_ts)

        ui_url = _ui_url(run_summary)
        if ui_url:
            embed["url"] = ui_url

        return {"embeds": [embed]}

    def content_type(self) -> str:
        return "application/json"


# ---------------------------------------------------------------------------
# MS Teams (MessageCard)
# ---------------------------------------------------------------------------


class TeamsTemplate(WebhookTemplate):
    """Build a MS Teams Adaptive Card (legacy MessageCard schema)."""

    name: ClassVar[str] = "teams"

    def render(self, run_summary: dict) -> dict:
        status = _safe_str(run_summary.get("status"), "unknown").lower()
        emoji = _emoji(status)
        theme_color = _STATUS_TEAMS_COLOR.get(status, "808080")

        title = f"{emoji} {_label(status)}"

        facts: list[dict] = []
        graph_id = _safe_str(run_summary.get("rootGraphId") or run_summary.get("graphId"))
        run_id = _safe_str(run_summary.get("runId"))
        dur = _duration_str(run_summary)
        finished_at = _safe_str(run_summary.get("finishedAt"))

        if graph_id:
            facts.append({"name": "Graph ID", "value": graph_id})
        if run_id:
            facts.append({"name": "Run ID", "value": run_id})
        facts.append({"name": "Status", "value": status.capitalize()})
        if dur:
            facts.append({"name": "Duration", "value": dur})
        if finished_at:
            facts.append({"name": "Finished At", "value": finished_at})

        nc = _node_count(run_summary)
        ec = _error_count(run_summary)
        if nc is not None:
            facts.append({"name": "Nodes", "value": str(nc)})
        if ec is not None:
            facts.append({"name": "Errors", "value": str(ec)})

        section: dict = {"facts": facts}

        if status == "failed":
            first_err = _first_error(run_summary)
            if first_err:
                section["text"] = f"**Error:** {first_err[:500]}"

        card: dict = {
            "@type": "MessageCard",
            "@context": "http://schema.org/extensions",
            "themeColor": theme_color,
            "summary": title,
            "sections": [section],
        }

        ui_url = _ui_url(run_summary)
        if ui_url:
            card["potentialAction"] = [
                {
                    "@type": "OpenUri",
                    "name": "View Run",
                    "targets": [{"os": "default", "uri": ui_url}],
                }
            ]

        return card

    def content_type(self) -> str:
        return "application/json"


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

TEMPLATES: dict[str, type[WebhookTemplate]] = {
    "generic": GenericTemplate,
    "slack": SlackTemplate,
    "discord": DiscordTemplate,
    "teams": TeamsTemplate,
}


def get_template(name: str) -> WebhookTemplate:
    """Return an instance of the named template.

    Raises ValueError for unknown names.
    """
    cls = TEMPLATES.get(name.lower() if name else "")
    if cls is None:
        known = ", ".join(sorted(TEMPLATES))
        raise ValueError(f"Unknown webhook template {name!r}. Known: {known}")
    return cls()
