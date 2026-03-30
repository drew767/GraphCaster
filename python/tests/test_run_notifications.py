# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import os
from unittest.mock import MagicMock, patch

import pytest

from graph_caster.run_notifications import deliver_run_finished_webhook_maybe


def test_notify_skipped_without_url() -> None:
    with patch.dict(os.environ, {}, clear=True):
        deliver_run_finished_webhook_maybe({"status": "success"})


def test_notify_posts_json(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def fake_urlopen(req: object, timeout: float | None = None) -> object:
        captured["timeout"] = timeout
        r = MagicMock()
        r.read.return_value = b"ok"
        ur = getattr(req, "full_url", None) or getattr(req, "get_full_url", lambda: "")()
        captured["url"] = str(ur)
        data = getattr(req, "data", None)
        captured["body"] = data
        return r

    monkeypatch.setenv("GC_RUN_NOTIFY_WEBHOOK_URL", "https://example.com/hook")
    monkeypatch.delenv("GC_RUN_NOTIFY_WEBHOOK_HEADERS_JSON", raising=False)
    with patch("graph_caster.run_notifications.urllib.request.urlopen", fake_urlopen):
        deliver_run_finished_webhook_maybe(
            {"schemaVersion": 1, "type": "run_finished", "runId": "r1", "status": "failed"}
        )
    body = captured.get("body")
    assert isinstance(body, bytes)
    j = json.loads(body.decode())
    assert j["runId"] == "r1"
    assert j["status"] == "failed"


def test_notify_respects_status_filter(monkeypatch: pytest.MonkeyPatch) -> None:
    called: list[object] = []

    def fake_urlopen(*_a: object, **_k: object) -> object:
        called.append(True)
        r = MagicMock()
        r.read.return_value = b""
        return r

    monkeypatch.setenv("GC_RUN_NOTIFY_WEBHOOK_URL", "https://x.test/h")
    monkeypatch.setenv("GC_RUN_NOTIFY_ON_STATUS", "success")
    with patch("graph_caster.run_notifications.urllib.request.urlopen", fake_urlopen):
        deliver_run_finished_webhook_maybe({"status": "failed"})
    assert called == []
