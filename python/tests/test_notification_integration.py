# Copyright GraphCaster. All Rights Reserved.

"""Integration tests for F89: template rendering wired into deliver_run_finished_webhook_maybe."""

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

from graph_caster.run_notifications import deliver_run_finished_webhook_maybe

_BASE_PAYLOAD: dict = {
    "schemaVersion": 1,
    "type": "run_finished",
    "runId": "run-int-001",
    "rootGraphId": "graph-xyz",
    "status": "success",
    "finishedAt": "2026-05-12T12:00:00Z",
    "nodeCount": 4,
    "errorCount": 0,
    "durationMs": 2100,
}

_FAILED_PAYLOAD: dict = {
    **_BASE_PAYLOAD,
    "runId": "run-int-002",
    "status": "failed",
    "errors": [{"message": "Step fetch_data failed: connection refused"}],
}


def _make_urlopen_spy() -> tuple[list[dict], object]:
    captured: list[dict] = []

    class _FakeResp:
        def read(self) -> bytes:
            return b"ok"

        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

    def fake_urlopen(req: object, timeout: float | None = None) -> object:
        data = getattr(req, "data", None)
        headers = {}
        if hasattr(req, "headers"):
            headers = dict(req.headers)
        captured.append({"body": json.loads(data.decode()) if data else None, "headers": headers})
        return _FakeResp()

    return captured, fake_urlopen


# ---------------------------------------------------------------------------
# Template selection via env var
# ---------------------------------------------------------------------------


def test_slack_template_via_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_NOTIFY_WEBHOOK_URL", "https://hooks.slack.com/test")
    monkeypatch.setenv("GC_RUN_NOTIFY_TEMPLATE", "slack")
    monkeypatch.delenv("GC_RUN_NOTIFY_ON_STATUS", raising=False)
    monkeypatch.delenv("GC_RUN_NOTIFY_WEBHOOK_HEADERS_JSON", raising=False)

    captured, fake_urlopen = _make_urlopen_spy()
    with patch("graph_caster.run_notifications.urllib.request.urlopen", fake_urlopen):
        deliver_run_finished_webhook_maybe(_BASE_PAYLOAD)

    assert captured, "expected one POST"
    body = captured[0]["body"]
    assert "blocks" in body, f"expected Slack blocks in body, got: {body}"
    block_types = [b["type"] for b in body["blocks"]]
    assert "header" in block_types


def test_discord_template_via_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_NOTIFY_WEBHOOK_URL", "https://discord.com/api/webhooks/test")
    monkeypatch.setenv("GC_RUN_NOTIFY_TEMPLATE", "discord")
    monkeypatch.delenv("GC_RUN_NOTIFY_ON_STATUS", raising=False)
    monkeypatch.delenv("GC_RUN_NOTIFY_WEBHOOK_HEADERS_JSON", raising=False)

    captured, fake_urlopen = _make_urlopen_spy()
    with patch("graph_caster.run_notifications.urllib.request.urlopen", fake_urlopen):
        deliver_run_finished_webhook_maybe(_BASE_PAYLOAD)

    assert captured
    body = captured[0]["body"]
    assert "embeds" in body, f"expected Discord embeds in body, got: {body}"
    assert body["embeds"][0]["color"] == 0x2ECC71


def test_teams_template_via_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_NOTIFY_WEBHOOK_URL", "https://outlook.office.com/webhook/test")
    monkeypatch.setenv("GC_RUN_NOTIFY_TEMPLATE", "teams")
    monkeypatch.delenv("GC_RUN_NOTIFY_ON_STATUS", raising=False)
    monkeypatch.delenv("GC_RUN_NOTIFY_WEBHOOK_HEADERS_JSON", raising=False)

    captured, fake_urlopen = _make_urlopen_spy()
    with patch("graph_caster.run_notifications.urllib.request.urlopen", fake_urlopen):
        deliver_run_finished_webhook_maybe(_BASE_PAYLOAD)

    assert captured
    body = captured[0]["body"]
    assert body.get("@type") == "MessageCard", f"expected MessageCard, got: {body}"
    assert body["themeColor"] == "00b300"


def test_generic_template_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_NOTIFY_WEBHOOK_URL", "https://example.com/hook")
    monkeypatch.delenv("GC_RUN_NOTIFY_TEMPLATE", raising=False)
    monkeypatch.delenv("GC_RUN_NOTIFY_ON_STATUS", raising=False)
    monkeypatch.delenv("GC_RUN_NOTIFY_WEBHOOK_HEADERS_JSON", raising=False)

    captured, fake_urlopen = _make_urlopen_spy()
    with patch("graph_caster.run_notifications.urllib.request.urlopen", fake_urlopen):
        deliver_run_finished_webhook_maybe(_BASE_PAYLOAD)

    assert captured
    body = captured[0]["body"]
    assert body["runId"] == "run-int-001"
    assert body["status"] == "success"


# ---------------------------------------------------------------------------
# Per-graph meta override
# ---------------------------------------------------------------------------


def test_per_graph_meta_override_beats_env_var(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_NOTIFY_WEBHOOK_URL", "https://example.com/hook")
    monkeypatch.setenv("GC_RUN_NOTIFY_TEMPLATE", "generic")
    monkeypatch.delenv("GC_RUN_NOTIFY_ON_STATUS", raising=False)
    monkeypatch.delenv("GC_RUN_NOTIFY_WEBHOOK_HEADERS_JSON", raising=False)

    captured, fake_urlopen = _make_urlopen_spy()
    with patch("graph_caster.run_notifications.urllib.request.urlopen", fake_urlopen):
        deliver_run_finished_webhook_maybe(
            _BASE_PAYLOAD,
            graph_meta={"notifyTemplate": "slack"},
        )

    assert captured
    body = captured[0]["body"]
    assert "blocks" in body, f"per-graph slack override expected, got: {body}"


def test_per_graph_meta_override_empty_falls_back_to_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_NOTIFY_WEBHOOK_URL", "https://example.com/hook")
    monkeypatch.setenv("GC_RUN_NOTIFY_TEMPLATE", "discord")
    monkeypatch.delenv("GC_RUN_NOTIFY_ON_STATUS", raising=False)
    monkeypatch.delenv("GC_RUN_NOTIFY_WEBHOOK_HEADERS_JSON", raising=False)

    captured, fake_urlopen = _make_urlopen_spy()
    with patch("graph_caster.run_notifications.urllib.request.urlopen", fake_urlopen):
        deliver_run_finished_webhook_maybe(
            _BASE_PAYLOAD,
            graph_meta={"notifyTemplate": ""},
        )

    assert captured
    body = captured[0]["body"]
    assert "embeds" in body, f"env-var discord expected when meta override empty, got: {body}"


# ---------------------------------------------------------------------------
# Status filter still works
# ---------------------------------------------------------------------------


def test_status_filter_skips_success_when_only_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_NOTIFY_WEBHOOK_URL", "https://example.com/hook")
    monkeypatch.setenv("GC_RUN_NOTIFY_TEMPLATE", "slack")
    monkeypatch.setenv("GC_RUN_NOTIFY_ON_STATUS", "failed")
    monkeypatch.delenv("GC_RUN_NOTIFY_WEBHOOK_HEADERS_JSON", raising=False)

    captured, fake_urlopen = _make_urlopen_spy()
    with patch("graph_caster.run_notifications.urllib.request.urlopen", fake_urlopen):
        deliver_run_finished_webhook_maybe(_BASE_PAYLOAD)  # status=success

    assert captured == [], "should not POST for success when filter=failed"


def test_status_filter_posts_failed_when_filter_matches(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_NOTIFY_WEBHOOK_URL", "https://example.com/hook")
    monkeypatch.setenv("GC_RUN_NOTIFY_TEMPLATE", "slack")
    monkeypatch.setenv("GC_RUN_NOTIFY_ON_STATUS", "failed")
    monkeypatch.delenv("GC_RUN_NOTIFY_WEBHOOK_HEADERS_JSON", raising=False)

    captured, fake_urlopen = _make_urlopen_spy()
    with patch("graph_caster.run_notifications.urllib.request.urlopen", fake_urlopen):
        deliver_run_finished_webhook_maybe(_FAILED_PAYLOAD)

    assert captured, "should POST for failed when filter=failed"
    body = captured[0]["body"]
    assert "blocks" in body


# ---------------------------------------------------------------------------
# Fallback to generic on bad template name
# ---------------------------------------------------------------------------


def test_unknown_template_name_falls_back_to_generic(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_NOTIFY_WEBHOOK_URL", "https://example.com/hook")
    monkeypatch.setenv("GC_RUN_NOTIFY_TEMPLATE", "nonexistent_platform")
    monkeypatch.delenv("GC_RUN_NOTIFY_ON_STATUS", raising=False)
    monkeypatch.delenv("GC_RUN_NOTIFY_WEBHOOK_HEADERS_JSON", raising=False)

    captured, fake_urlopen = _make_urlopen_spy()
    with patch("graph_caster.run_notifications.urllib.request.urlopen", fake_urlopen):
        deliver_run_finished_webhook_maybe(_BASE_PAYLOAD)

    assert captured, "fallback to generic should still POST"
    body = captured[0]["body"]
    assert body["runId"] == "run-int-001"


# ---------------------------------------------------------------------------
# No URL = no POST
# ---------------------------------------------------------------------------


def test_no_url_no_post(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_RUN_NOTIFY_WEBHOOK_URL", raising=False)
    monkeypatch.setenv("GC_RUN_NOTIFY_TEMPLATE", "slack")

    captured, fake_urlopen = _make_urlopen_spy()
    with patch("graph_caster.run_notifications.urllib.request.urlopen", fake_urlopen):
        deliver_run_finished_webhook_maybe(_BASE_PAYLOAD)

    assert captured == []
