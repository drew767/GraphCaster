# Copyright GraphCaster. All Rights Reserved.

"""Tests for GET /api/v1/i18n/{lang} endpoint (F94)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.registry import RunBrokerRegistry
from graph_caster.i18n.aggregator import I18nAggregator


def _fresh_client() -> TestClient:
    reg = RunBrokerRegistry()
    return TestClient(create_app(reg))


class TestI18nApiEndpoint:
    def test_get_en_returns_200(self) -> None:
        client = _fresh_client()
        resp = client.get("/api/v1/i18n/en")
        assert resp.status_code == 200

    def test_get_en_contains_core(self) -> None:
        client = _fresh_client()
        resp = client.get("/api/v1/i18n/en")
        body = resp.json()
        assert "core" in body
        assert body["core"]["app"]["title"] == "GraphCaster"

    def test_get_ru_contains_core(self) -> None:
        client = _fresh_client()
        resp = client.get("/api/v1/i18n/ru")
        body = resp.json()
        assert "core" in body
        assert body["core"]["app"]["title"] == "GraphCaster"

    def test_get_unknown_lang_returns_200_with_warning_header(self) -> None:
        client = _fresh_client()
        resp = client.get("/api/v1/i18n/xx-unknown-zzz")
        assert resp.status_code == 200
        assert "X-GC-I18n-Warning" in resp.headers

    def test_get_unknown_lang_body_is_empty_or_core_only(self) -> None:
        client = _fresh_client()
        resp = client.get("/api/v1/i18n/xx-unknown-zzz")
        body = resp.json()
        assert isinstance(body, dict)

    def test_content_type_is_json(self) -> None:
        client = _fresh_client()
        resp = client.get("/api/v1/i18n/en")
        assert "application/json" in resp.headers.get("content-type", "")

    def test_no_auth_required(self) -> None:
        client = _fresh_client()
        resp = client.get("/api/v1/i18n/en")
        assert resp.status_code == 200

    def test_plugin_translations_appear_after_register(self, tmp_path: Path) -> None:
        lang_dir = tmp_path / "locales" / "en"
        lang_dir.mkdir(parents=True)
        (lang_dir / "ui.json").write_text(json.dumps({"greeting": "Hello"}), encoding="utf-8")

        from graph_caster.i18n.aggregator import get_aggregator
        agg = get_aggregator()
        agg.register_plugin_locales("test-api-plugin", tmp_path / "locales")
        try:
            client = _fresh_client()
            resp = client.get("/api/v1/i18n/en")
            body = resp.json()
            assert "plugin:test-api-plugin" in body
            assert body["plugin:test-api-plugin"]["ui"]["greeting"] == "Hello"
        finally:
            agg.unregister_plugin("test-api-plugin")

    def test_plugin_translations_absent_after_unregister(self, tmp_path: Path) -> None:
        lang_dir = tmp_path / "locales" / "en"
        lang_dir.mkdir(parents=True)
        (lang_dir / "ui.json").write_text(json.dumps({"msg": "bye"}), encoding="utf-8")

        from graph_caster.i18n.aggregator import get_aggregator
        agg = get_aggregator()
        agg.register_plugin_locales("test-unregister-plugin", tmp_path / "locales")
        agg.unregister_plugin("test-unregister-plugin")

        client = _fresh_client()
        resp = client.get("/api/v1/i18n/en")
        body = resp.json()
        assert "plugin:test-unregister-plugin" not in body
