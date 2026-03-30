# Copyright GraphCaster. All Rights Reserved.

"""GitHub OAuth **device code** flow (no callback server; user completes login in browser)."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any


class GithubDeviceFlowError(RuntimeError):
    pass


def _post_form(url: str, data: dict[str, str]) -> dict[str, Any]:
    body = urllib.parse.urlencode(data).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Accept": "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as e:
        try:
            detail = e.read().decode("utf-8", errors="replace")[:2000]
        except OSError:
            detail = str(e)
        raise GithubDeviceFlowError(f"HTTP {e.code}: {detail}") from e
    except OSError as e:
        raise GithubDeviceFlowError(f"request failed: {e}") from e
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as e:
        t = raw.decode("utf-8", errors="replace")[:2000]
        raise GithubDeviceFlowError(f"invalid JSON from GitHub: {t}") from e
    if not isinstance(parsed, dict):
        raise GithubDeviceFlowError("GitHub returned non-object JSON")
    return parsed


@dataclass(frozen=True)
class GithubDeviceStart:
    device_code: str
    user_code: str
    verification_uri: str
    expires_in: int
    interval: int


def start_github_device_flow(*, client_id: str, scope: str) -> GithubDeviceStart:
    cid = client_id.strip()
    if not cid:
        raise GithubDeviceFlowError("client_id is empty (set GITHUB_OAUTH_CLIENT_ID)")
    data: dict[str, str] = {"client_id": cid, "scope": scope.strip()}
    j = _post_form("https://github.com/login/device/code", data)
    dc = j.get("device_code")
    uc = j.get("user_code")
    vu = j.get("verification_uri") or "https://github.com/login/device"
    if not isinstance(dc, str) or not dc.strip():
        raise GithubDeviceFlowError("GitHub response missing device_code")
    if not isinstance(uc, str) or not uc.strip():
        raise GithubDeviceFlowError("GitHub response missing user_code")
    exp = int(j.get("expires_in") or 900)
    itv = max(5, int(j.get("interval") or 5))
    return GithubDeviceStart(
        device_code=dc.strip(),
        user_code=uc.strip(),
        verification_uri=str(vu).strip(),
        expires_in=max(60, exp),
        interval=itv,
    )


def poll_github_device_token(*, client_id: str, device_code: str, interval_sec: float) -> str:
    cid = client_id.strip()
    data: dict[str, str] = {
        "client_id": cid,
        "device_code": device_code,
        "grant_type": "urn:ietf:params:oauth:grant-type:device_code",
    }
    j = _post_form("https://github.com/login/oauth/access_token", data)
    err = j.get("error")
    if err == "authorization_pending":
        return ""
    if err == "slow_down":
        time.sleep(max(interval_sec, 5.0) + 5.0)
        return ""
    if err:
        desc = j.get("error_description") or err
        raise GithubDeviceFlowError(f"GitHub OAuth error: {desc}")
    at = j.get("access_token")
    if not isinstance(at, str) or not at.strip():
        raise GithubDeviceFlowError("GitHub response missing access_token")
    return at.strip()


def run_github_device_flow(
    *,
    client_id: str,
    scope: str = "",
    poll_interval_override: float | None = None,
) -> str:
    """Block until the user authorizes in the browser; return **access_token** string."""
    start = start_github_device_flow(client_id=client_id, scope=scope)
    interval = float(poll_interval_override if poll_interval_override is not None else start.interval)
    deadline = time.monotonic() + float(start.expires_in)
    print(
        "Open:",
        start.verification_uri,
        "\nEnter code:",
        start.user_code,
        "\nWaiting for authorization…",
        flush=True,
    )
    while time.monotonic() < deadline:
        time.sleep(interval)
        tok = poll_github_device_token(
            client_id=client_id,
            device_code=start.device_code,
            interval_sec=interval,
        )
        if tok:
            return tok
    raise GithubDeviceFlowError("device code expired before authorization")
