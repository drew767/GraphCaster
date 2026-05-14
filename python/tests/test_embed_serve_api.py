# Copyright GraphCaster. All Rights Reserved.

"""Tests for GET /api/v1/embed.js and related embed serve routes (F82)."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.registry import RunBrokerRegistry


class TestEmbedJsRoute:
    def test_get_embed_js_returns_404_when_file_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("GC_EMBED_JS_PATH", "/nonexistent/path/embed.js")
        monkeypatch.delenv("GC_RUN_BROKER_TOKEN", raising=False)
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get("/api/v1/embed.js")
        assert r.status_code == 404
        assert "embed.js" in r.json().get("error", "").lower()

    def test_get_embed_js_returns_200_when_file_exists(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        embed_js = tmp_path / "embed.js"
        embed_js.write_text("window.GraphCaster={init:function(){}};", encoding="utf-8")
        monkeypatch.setenv("GC_EMBED_JS_PATH", str(embed_js))
        monkeypatch.delenv("GC_RUN_BROKER_TOKEN", raising=False)
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get("/api/v1/embed.js")
        assert r.status_code == 200
        assert "javascript" in r.headers.get("content-type", "").lower()
        assert b"GraphCaster" in r.content

    def test_get_embed_js_cors_headers_default_wildcard(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        embed_js = tmp_path / "embed.js"
        embed_js.write_text("// embed", encoding="utf-8")
        monkeypatch.setenv("GC_EMBED_JS_PATH", str(embed_js))
        monkeypatch.delenv("GC_RUN_BROKER_TOKEN", raising=False)
        monkeypatch.delenv("GC_RUN_BROKER_PUBLIC_ORIGINS", raising=False)
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get("/api/v1/embed.js")
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-origin") == "*"

    def test_get_embed_js_cors_headers_custom_origin(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        embed_js = tmp_path / "embed.js"
        embed_js.write_text("// embed", encoding="utf-8")
        monkeypatch.setenv("GC_EMBED_JS_PATH", str(embed_js))
        monkeypatch.setenv("GC_RUN_BROKER_PUBLIC_ORIGINS", "https://example.com")
        monkeypatch.delenv("GC_RUN_BROKER_TOKEN", raising=False)
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get("/api/v1/embed.js")
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-origin") == "https://example.com"

    def test_options_embed_js_returns_204(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("GC_RUN_BROKER_TOKEN", raising=False)
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.options("/api/v1/embed.js")
        assert r.status_code == 204

    def test_get_public_link_embed_js_returns_404_when_file_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("GC_EMBED_JS_PATH", "/nonexistent/path/embed.js")
        monkeypatch.delenv("GC_RUN_BROKER_TOKEN", raising=False)
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get("/api/v1/public/some-link-id/embed.js")
        assert r.status_code == 404

    def test_get_public_link_embed_js_injects_init_call(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        embed_js = tmp_path / "embed.js"
        embed_js.write_text("window.GraphCaster={init:function(){}};", encoding="utf-8")
        monkeypatch.setenv("GC_EMBED_JS_PATH", str(embed_js))
        monkeypatch.setenv("GC_PUBLIC_BASE_URL", "https://gc.example.com")
        monkeypatch.delenv("GC_RUN_BROKER_TOKEN", raising=False)
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get("/api/v1/public/abc123/embed.js")
        assert r.status_code == 200
        body = r.text
        assert "abc123" in body
        assert "GraphCaster" in body
        assert "init" in body
        assert "gc.example.com" in body

    def test_get_public_link_embed_js_cors_headers(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        embed_js = tmp_path / "embed.js"
        embed_js.write_text("// embed", encoding="utf-8")
        monkeypatch.setenv("GC_EMBED_JS_PATH", str(embed_js))
        monkeypatch.delenv("GC_RUN_BROKER_PUBLIC_ORIGINS", raising=False)
        monkeypatch.delenv("GC_RUN_BROKER_TOKEN", raising=False)
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get("/api/v1/public/linkX/embed.js")
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-origin") == "*"

    def test_get_public_link_embed_js_no_cache(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        embed_js = tmp_path / "embed.js"
        embed_js.write_text("// embed", encoding="utf-8")
        monkeypatch.setenv("GC_EMBED_JS_PATH", str(embed_js))
        monkeypatch.delenv("GC_RUN_BROKER_TOKEN", raising=False)
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get("/api/v1/public/linkX/embed.js")
        assert r.status_code == 200
        assert "no-cache" in r.headers.get("cache-control", "")
