# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from unittest.mock import patch

import pytest

from graph_caster.mcp_oauth.github_device import (
    GithubDeviceFlowError,
    poll_github_device_token,
    run_github_device_flow,
    start_github_device_flow,
)


def test_start_requires_client_id() -> None:
    with pytest.raises(GithubDeviceFlowError, match="client_id"):
        start_github_device_flow(client_id="", scope="")


def test_poll_returns_token() -> None:
    with patch("graph_caster.mcp_oauth.github_device._post_form") as post:
        post.return_value = {"access_token": "tok_abc", "token_type": "bearer"}
        t = poll_github_device_token(client_id="cid", device_code="dc", interval_sec=1.0)
        assert t == "tok_abc"


def test_poll_pending_empty() -> None:
    with patch("graph_caster.mcp_oauth.github_device._post_form") as post:
        post.return_value = {"error": "authorization_pending"}
        t = poll_github_device_token(client_id="cid", device_code="dc", interval_sec=1.0)
        assert t == ""


def test_run_flow_happy_path(monkeypatch: pytest.MonkeyPatch) -> None:
    start_json = {
        "device_code": "dc1",
        "user_code": "ABCD-1234",
        "verification_uri": "https://github.com/login/device",
        "expires_in": 600,
        "interval": 1,
    }
    calls: list[str] = []

    def fake_post(url: str, _data: dict[str, str]) -> dict[str, object]:
        calls.append(url)
        if "device/code" in url:
            return dict(start_json)
        return {"access_token": "final_tok", "token_type": "bearer"}

    monkeypatch.setattr("graph_caster.mcp_oauth.github_device._post_form", fake_post)
    monkeypatch.setattr("graph_caster.mcp_oauth.github_device.time.sleep", lambda _x: None)

    tok = run_github_device_flow(client_id="ghid", scope="")
    assert tok == "final_tok"
    assert any("device/code" in u for u in calls)
