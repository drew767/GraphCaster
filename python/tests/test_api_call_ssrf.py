# Copyright GraphCaster. All Rights Reserved.

"""SSRF and redirect-cap protection for the ``api_call`` node."""

from __future__ import annotations

import socket
from unittest.mock import patch

import httpx
import pytest

from graph_caster.nodes import api_call as api_call_mod
from graph_caster.nodes.api_call import execute_api_call


def _emit_capture():
    events: list[tuple[str, dict]] = []

    def emit(name: str, **kwargs: object) -> None:
        events.append((name, dict(kwargs)))

    return events, emit


def _ctx() -> dict:
    return {"node_outputs": {}}


def _addrinfo(ip: str) -> list:
    """Return a getaddrinfo-compatible tuple list for one IP."""
    fam = socket.AF_INET6 if ":" in ip else socket.AF_INET
    sock_tuple = (ip, 0, 0, 0) if fam == socket.AF_INET6 else (ip, 0)
    return [(fam, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sock_tuple)]


@pytest.fixture(autouse=True)
def _clear_env(monkeypatch):
    """Ensure env opt-ins do not leak across tests."""
    monkeypatch.delenv("GC_API_CALL_ALLOW_PRIVATE_NETWORKS", raising=False)
    monkeypatch.delenv("GC_API_CALL_ALLOW_INSECURE_LOCALHOST", raising=False)
    yield


def test_private_ipv4_blocked() -> None:
    events, emit = _emit_capture()
    with patch.object(socket, "getaddrinfo", return_value=_addrinfo("192.168.1.1")):
        ok, patch_ = execute_api_call(
            node_id="n",
            graph_id="g",
            data={"url": "http://internal.example.test/", "method": "GET"},
            ctx=_ctx(),
            emit=emit,
        )
    assert ok is False
    err = patch_["apiCallResult"]["error"]
    assert isinstance(err, str) and err.startswith("SSRF:"), err


def test_link_local_aws_metadata_blocked() -> None:
    events, emit = _emit_capture()
    with patch.object(socket, "getaddrinfo", return_value=_addrinfo("169.254.169.254")):
        ok, patch_ = execute_api_call(
            node_id="n",
            graph_id="g",
            data={"url": "http://169.254.169.254/latest/meta-data/", "method": "GET"},
            ctx=_ctx(),
            emit=emit,
        )
    assert ok is False
    assert patch_["apiCallResult"]["error"].startswith("SSRF:")


def test_loopback_blocked_without_optin() -> None:
    events, emit = _emit_capture()
    with patch.object(socket, "getaddrinfo", return_value=_addrinfo("127.0.0.1")):
        ok, patch_ = execute_api_call(
            node_id="n",
            graph_id="g",
            data={"url": "http://127.0.0.1/admin", "method": "GET"},
            ctx=_ctx(),
            emit=emit,
        )
    assert ok is False
    assert patch_["apiCallResult"]["error"].startswith("SSRF:")


def test_loopback_allowed_with_localhost_optin(monkeypatch) -> None:
    monkeypatch.setenv("GC_API_CALL_ALLOW_INSECURE_LOCALHOST", "1")
    events, emit = _emit_capture()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b'{"ok":true}', headers={"Content-Type": "application/json"})

    transport = httpx.MockTransport(handler)

    with patch.object(socket, "getaddrinfo", return_value=_addrinfo("127.0.0.1")):
        ok, patch_ = execute_api_call(
            node_id="n",
            graph_id="g",
            data={"url": "http://localhost/health"},
            ctx=_ctx(),
            emit=emit,
            transport=transport,
        )
    assert ok is True
    assert patch_["apiCallResult"]["status"] == 200


def test_ipv6_loopback_blocked_without_optin() -> None:
    events, emit = _emit_capture()
    with patch.object(socket, "getaddrinfo", return_value=_addrinfo("::1")):
        ok, patch_ = execute_api_call(
            node_id="n",
            graph_id="g",
            data={"url": "http://[::1]/admin"},
            ctx=_ctx(),
            emit=emit,
        )
    assert ok is False
    assert patch_["apiCallResult"]["error"].startswith("SSRF:")


def test_private_ipv6_blocked() -> None:
    events, emit = _emit_capture()
    with patch.object(socket, "getaddrinfo", return_value=_addrinfo("fc00::1")):
        ok, patch_ = execute_api_call(
            node_id="n",
            graph_id="g",
            data={"url": "http://[fc00::1]/internal"},
            ctx=_ctx(),
            emit=emit,
        )
    assert ok is False
    assert patch_["apiCallResult"]["error"].startswith("SSRF:")


def test_ipv4_mapped_ipv6_private_blocked() -> None:
    events, emit = _emit_capture()
    with patch.object(socket, "getaddrinfo", return_value=_addrinfo("::ffff:192.168.1.1")):
        ok, patch_ = execute_api_call(
            node_id="n",
            graph_id="g",
            data={"url": "http://[::ffff:192.168.1.1]/"},
            ctx=_ctx(),
            emit=emit,
        )
    assert ok is False
    assert patch_["apiCallResult"]["error"].startswith("SSRF:")


def test_cgnat_blocked() -> None:
    events, emit = _emit_capture()
    with patch.object(socket, "getaddrinfo", return_value=_addrinfo("100.64.0.5")):
        ok, patch_ = execute_api_call(
            node_id="n",
            graph_id="g",
            data={"url": "http://carrier.example.test/"},
            ctx=_ctx(),
            emit=emit,
        )
    assert ok is False
    assert patch_["apiCallResult"]["error"].startswith("SSRF:")


def test_public_ip_allowed() -> None:
    events, emit = _emit_capture()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b'{"ok":true}', headers={"Content-Type": "application/json"})

    transport = httpx.MockTransport(handler)
    with patch.object(socket, "getaddrinfo", return_value=_addrinfo("93.184.216.34")):
        ok, patch_ = execute_api_call(
            node_id="n",
            graph_id="g",
            data={"url": "https://example.com/api"},
            ctx=_ctx(),
            emit=emit,
            transport=transport,
        )
    assert ok is True
    assert patch_["apiCallResult"]["status"] == 200


def test_private_allowed_with_env_optin(monkeypatch) -> None:
    monkeypatch.setenv("GC_API_CALL_ALLOW_PRIVATE_NETWORKS", "1")
    events, emit = _emit_capture()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b'{"ok":true}', headers={"Content-Type": "application/json"})

    transport = httpx.MockTransport(handler)
    with patch.object(socket, "getaddrinfo", return_value=_addrinfo("192.168.1.1")):
        ok, patch_ = execute_api_call(
            node_id="n",
            graph_id="g",
            data={"url": "http://192.168.1.1/api"},
            ctx=_ctx(),
            emit=emit,
            transport=transport,
        )
    assert ok is True
    assert patch_["apiCallResult"]["status"] == 200


def test_dns_rebind_style_hostname_blocked() -> None:
    """A hostname literally containing ``127.0.0.1`` but resolving to a public
    IP would have been allowed by the previous literal check. The new check
    must follow the resolved IP only."""
    events, emit = _emit_capture()

    # Simulate ``127.0.0.1.attacker.com`` resolving to a public IP — must be
    # treated as public (allowed). Then simulate it resolving to a private IP
    # — must be blocked even though the literal contains "127.0.0.1".
    with patch.object(socket, "getaddrinfo", return_value=_addrinfo("10.0.0.5")):
        ok, patch_ = execute_api_call(
            node_id="n",
            graph_id="g",
            data={"url": "http://127.0.0.1.attacker.example.test/"},
            ctx=_ctx(),
            emit=emit,
        )
    assert ok is False
    assert patch_["apiCallResult"]["error"].startswith("SSRF:")


def test_redirect_to_private_ip_blocked() -> None:
    events, emit = _emit_capture()
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        if call_count["n"] == 1:
            return httpx.Response(302, headers={"Location": "http://attacker.internal.test/secret"})
        return httpx.Response(200, content=b'{"hacked":true}')

    transport = httpx.MockTransport(handler)

    # First call resolves to public IP (allowed), redirect target resolves to
    # a private IP (must be blocked).
    addrs = {
        "public.example.test": _addrinfo("93.184.216.34"),
        "attacker.internal.test": _addrinfo("10.0.0.5"),
    }

    def fake_getaddrinfo(host, *_args, **_kwargs):
        if host in addrs:
            return addrs[host]
        raise socket.gaierror("unknown host")

    with patch.object(socket, "getaddrinfo", side_effect=fake_getaddrinfo):
        ok, patch_ = execute_api_call(
            node_id="n",
            graph_id="g",
            data={"url": "https://public.example.test/start"},
            ctx=_ctx(),
            emit=emit,
            transport=transport,
        )
    assert ok is False
    err = patch_["apiCallResult"]["error"]
    assert isinstance(err, str) and err.startswith("SSRF:"), err


def test_redirect_chain_over_cap_blocked(monkeypatch) -> None:
    """More than 5 hops must yield a TooManyRedirects-style failure."""
    events, emit = _emit_capture()
    hop = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        hop["n"] += 1
        # Always send to a new (still public-resolving) target.
        return httpx.Response(302, headers={"Location": f"https://hop{hop['n']}.example.test/"})

    transport = httpx.MockTransport(handler)

    def fake_getaddrinfo(*_args, **_kwargs):
        return _addrinfo("93.184.216.34")

    with patch.object(socket, "getaddrinfo", side_effect=fake_getaddrinfo):
        ok, patch_ = execute_api_call(
            node_id="n",
            graph_id="g",
            data={"url": "https://start.example.test/", "retries": 0},
            ctx=_ctx(),
            emit=emit,
            transport=transport,
        )
    assert ok is False
    err = patch_["apiCallResult"]["error"]
    assert isinstance(err, str)
    # Either the httpx-bubbled name or our manual cap.
    assert "TooManyRedirects" in err or err.startswith("SSRF:"), err
    # Ensure the loop ran no more than the cap + initial.
    assert hop["n"] <= 6
