# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import io
import os
import struct
import tempfile
import zlib
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.auth.api_key import APIKeyAuthenticator
from graph_caster.run_broker.registry import RunBrokerRegistry


# ---------------------------------------------------------------------------
# Minimal PNG builder
# ---------------------------------------------------------------------------

def _build_minimal_png() -> bytes:
    """Return a structurally valid 1x1 PNG."""
    def _uint32be(n: int) -> bytes:
        return struct.pack(">I", n)

    _CRC_TABLE = [0] * 256
    for _n in range(256):
        _c = _n
        for _ in range(8):
            _c = 0xEDB88320 ^ (_c >> 1) if _c & 1 else _c >> 1
        _CRC_TABLE[_n] = _c

    def _crc32(buf: bytes) -> int:
        crc = 0xFFFFFFFF
        for b in buf:
            crc = _CRC_TABLE[(crc ^ b) & 0xFF] ^ (crc >> 8)
        return (crc ^ 0xFFFFFFFF) & 0xFFFFFFFF

    def _chunk(name: str, data: bytes) -> bytes:
        type_bytes = name.encode("ascii")
        crc_input = type_bytes + data
        return _uint32be(len(data)) + type_bytes + data + _uint32be(_crc32(crc_input))

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    ihdr = _chunk("IHDR", ihdr_data)
    # Minimal deflate for 1x1 RGB [0, 0, 0, 0]
    raw_pixels = b"\x00\x00\x00\x00"
    compressed = zlib.compress(raw_pixels)
    idat = _chunk("IDAT", compressed)
    iend = _chunk("IEND", b"")
    return sig + ihdr + idat + iend


_MINIMAL_PNG = _build_minimal_png()


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def graphs_dir(tmp_path: Path) -> Path:
    gdir = tmp_path / "graphs"
    gdir.mkdir()
    return gdir


@pytest.fixture()
def app_client(graphs_dir: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(graphs_dir))
    monkeypatch.setenv("GC_RUN_BROKER_V1_API_KEYS", "")
    reg = RunBrokerRegistry()
    application = create_app(reg)
    with TestClient(application, raise_server_exceptions=True) as client:
        yield client


@pytest.fixture()
def auth_app_client(graphs_dir: Path, monkeypatch: pytest.MonkeyPatch):
    """Client with graph:edit auth required (key id=gc_test, secret=secret)."""
    monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(graphs_dir))
    monkeypatch.setenv(
        "GC_RUN_BROKER_V1_API_KEYS",
        "gc_test:secret",
    )
    reg = RunBrokerRegistry()
    application = create_app(reg)
    with TestClient(application, raise_server_exceptions=True) as client:
        yield client


_AUTH_HEADER = {"Authorization": "Bearer gc_test:secret"}


# ---------------------------------------------------------------------------
# POST tests
# ---------------------------------------------------------------------------

class TestPostGraphThumbnail:
    def test_post_saves_png_file(self, app_client: TestClient, graphs_dir: Path) -> None:
        resp = app_client.post(
            "/api/v1/graphs/my-graph/thumbnail",
            content=_MINIMAL_PNG,
            headers={"content-type": "image/png"},
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["saved"] is True
        thumb = graphs_dir / "my-graph.thumb.png"
        assert thumb.is_file()
        assert thumb.read_bytes() == _MINIMAL_PNG

    def test_post_multipart_saves_png_file(
        self, app_client: TestClient, graphs_dir: Path
    ) -> None:
        resp = app_client.post(
            "/api/v1/graphs/multi-graph/thumbnail",
            files={"file": ("thumb.png", io.BytesIO(_MINIMAL_PNG), "image/png")},
        )
        assert resp.status_code == 201
        thumb = graphs_dir / "multi-graph.thumb.png"
        assert thumb.is_file()

    def test_post_rejects_non_png(self, app_client: TestClient) -> None:
        resp = app_client.post(
            "/api/v1/graphs/my-graph/thumbnail",
            content=b"not a png",
            headers={"content-type": "image/png"},
        )
        assert resp.status_code == 400
        assert "PNG" in resp.json()["error"]

    def test_post_rejects_oversized(self, app_client: TestClient) -> None:
        big = b"\x89PNG" + b"\x00" * (1_048_576 + 1)
        resp = app_client.post(
            "/api/v1/graphs/my-graph/thumbnail",
            content=big,
            headers={"content-type": "image/png"},
        )
        assert resp.status_code == 413

    def test_post_without_graph_edit_scope_returns_403(
        self, auth_app_client: TestClient
    ) -> None:
        resp = auth_app_client.post(
            "/api/v1/graphs/my-graph/thumbnail",
            content=_MINIMAL_PNG,
            headers={"content-type": "image/png"},
        )
        assert resp.status_code == 403

    def test_post_with_graph_edit_scope_succeeds(
        self, auth_app_client: TestClient, graphs_dir: Path
    ) -> None:
        resp = auth_app_client.post(
            "/api/v1/graphs/auth-graph/thumbnail",
            content=_MINIMAL_PNG,
            headers={**_AUTH_HEADER, "content-type": "image/png"},
        )
        assert resp.status_code == 201


# ---------------------------------------------------------------------------
# GET tests
# ---------------------------------------------------------------------------

class TestGetGraphThumbnail:
    def test_get_returns_png_bytes(
        self, app_client: TestClient, graphs_dir: Path
    ) -> None:
        thumb = graphs_dir / "get-graph.thumb.png"
        thumb.write_bytes(_MINIMAL_PNG)
        resp = app_client.get("/api/v1/graphs/get-graph/thumbnail")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        assert resp.content == _MINIMAL_PNG

    def test_get_returns_404_when_missing(self, app_client: TestClient) -> None:
        resp = app_client.get("/api/v1/graphs/no-such-graph/thumbnail")
        assert resp.status_code == 404

    def test_get_requires_no_auth(
        self, auth_app_client: TestClient, graphs_dir: Path
    ) -> None:
        """GET is public — no Authorization header needed."""
        thumb = graphs_dir / "pub-graph.thumb.png"
        thumb.write_bytes(_MINIMAL_PNG)
        resp = auth_app_client.get("/api/v1/graphs/pub-graph/thumbnail")
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# DELETE tests
# ---------------------------------------------------------------------------

class TestDeleteGraphThumbnail:
    def test_delete_removes_file(
        self, app_client: TestClient, graphs_dir: Path
    ) -> None:
        thumb = graphs_dir / "del-graph.thumb.png"
        thumb.write_bytes(_MINIMAL_PNG)
        resp = app_client.delete("/api/v1/graphs/del-graph/thumbnail")
        assert resp.status_code == 200
        assert resp.json()["deleted"] is True
        assert not thumb.is_file()

    def test_delete_returns_404_when_missing(self, app_client: TestClient) -> None:
        resp = app_client.delete("/api/v1/graphs/no-such-graph/thumbnail")
        assert resp.status_code == 404

    def test_delete_without_scope_returns_403(
        self, auth_app_client: TestClient, graphs_dir: Path
    ) -> None:
        thumb = graphs_dir / "scope-graph.thumb.png"
        thumb.write_bytes(_MINIMAL_PNG)
        resp = auth_app_client.delete("/api/v1/graphs/scope-graph/thumbnail")
        assert resp.status_code == 403

    def test_delete_with_scope_succeeds(
        self, auth_app_client: TestClient, graphs_dir: Path
    ) -> None:
        thumb = graphs_dir / "scope-ok-graph.thumb.png"
        thumb.write_bytes(_MINIMAL_PNG)
        resp = auth_app_client.delete(
            "/api/v1/graphs/scope-ok-graph/thumbnail",
            headers=_AUTH_HEADER,
        )
        assert resp.status_code == 200
