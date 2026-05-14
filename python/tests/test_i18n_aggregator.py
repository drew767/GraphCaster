# Copyright GraphCaster. All Rights Reserved.

"""Tests for I18nAggregator (F94)."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import pytest

from graph_caster.i18n.aggregator import I18nAggregator


def _make_plugin_locales(base_dir: Path, lang: str, files: dict[str, dict]) -> Path:
    """Helper: write locale files under base_dir/<lang>/<file>.json."""
    lang_dir = base_dir / lang
    lang_dir.mkdir(parents=True, exist_ok=True)
    for fname, data in files.items():
        (lang_dir / fname).write_text(json.dumps(data), encoding="utf-8")
    return base_dir


class TestI18nAggregatorRegister:
    def test_register_and_get_translations(self, tmp_path: Path) -> None:
        locales_dir = _make_plugin_locales(
            tmp_path / "locales",
            "en",
            {"ui.json": {"hello": "World"}},
        )
        agg = I18nAggregator()
        agg.register_plugin_locales("fake", locales_dir)

        result = agg.get_translations("en")
        assert "plugin:fake" in result
        assert result["plugin:fake"]["ui"] == {"hello": "World"}

    def test_result_contains_core_key(self, tmp_path: Path) -> None:
        agg = I18nAggregator()
        result = agg.get_translations("en")
        assert "core" in result

    def test_core_en_has_app_title(self) -> None:
        agg = I18nAggregator()
        result = agg.get_translations("en")
        assert result["core"].get("app", {}).get("title") == "GraphCaster"

    def test_core_ru_has_app_title(self) -> None:
        agg = I18nAggregator()
        result = agg.get_translations("ru")
        assert result["core"].get("app", {}).get("title") == "GraphCaster"


class TestI18nAggregatorUnregister:
    def test_unregister_removes_plugin(self, tmp_path: Path) -> None:
        locales_dir = _make_plugin_locales(
            tmp_path / "locales",
            "en",
            {"ui.json": {"hello": "World"}},
        )
        agg = I18nAggregator()
        agg.register_plugin_locales("fake", locales_dir)
        agg.unregister_plugin("fake")

        result = agg.get_translations("en")
        assert "plugin:fake" not in result

    def test_unregister_nonexistent_is_noop(self) -> None:
        agg = I18nAggregator()
        agg.unregister_plugin("does-not-exist")


class TestI18nAggregatorMissingLanguage:
    def test_missing_lang_dir_returns_no_plugin_key(self, tmp_path: Path) -> None:
        locales_dir = _make_plugin_locales(
            tmp_path / "locales",
            "en",
            {"ui.json": {"hello": "World"}},
        )
        agg = I18nAggregator()
        agg.register_plugin_locales("fake", locales_dir)

        result = agg.get_translations("de")
        assert "plugin:fake" not in result

    def test_missing_lang_file_variant_is_absent(self, tmp_path: Path) -> None:
        locales_dir = _make_plugin_locales(
            tmp_path / "locales",
            "en",
            {"ui.json": {"hello": "World"}},
        )
        agg = I18nAggregator()
        agg.register_plugin_locales("fake", locales_dir)

        result = agg.get_translations("en")
        assert "nodeDefs" not in result.get("plugin:fake", {})
        assert "commands" not in result.get("plugin:fake", {})

    def test_no_error_on_unknown_lang(self) -> None:
        agg = I18nAggregator()
        result = agg.get_translations("zzz-unknown")
        assert isinstance(result, dict)
        assert "core" in result


class TestI18nAggregatorMultipleNamespaces:
    def test_multiple_locale_files_loaded(self, tmp_path: Path) -> None:
        locales_dir = _make_plugin_locales(
            tmp_path / "locales",
            "en",
            {
                "nodeDefs.json": {"MyNode": {"displayName": "My Node"}},
                "ui.json": {"buttonLabel": "Click me"},
            },
        )
        agg = I18nAggregator()
        agg.register_plugin_locales("myplugin", locales_dir)

        result = agg.get_translations("en")
        plugin_data = result["plugin:myplugin"]
        assert plugin_data["nodeDefs"] == {"MyNode": {"displayName": "My Node"}}
        assert plugin_data["ui"] == {"buttonLabel": "Click me"}

    def test_multiple_plugins_namespaced_separately(self, tmp_path: Path) -> None:
        loc_a = _make_plugin_locales(tmp_path / "a" / "locales", "en", {"ui.json": {"k": "A"}})
        loc_b = _make_plugin_locales(tmp_path / "b" / "locales", "en", {"ui.json": {"k": "B"}})
        agg = I18nAggregator()
        agg.register_plugin_locales("plugin-a", loc_a)
        agg.register_plugin_locales("plugin-b", loc_b)

        result = agg.get_translations("en")
        assert result["plugin:plugin-a"]["ui"]["k"] == "A"
        assert result["plugin:plugin-b"]["ui"]["k"] == "B"


class TestI18nAggregatorListLanguages:
    def test_list_languages_includes_core(self) -> None:
        agg = I18nAggregator()
        langs = agg.list_languages()
        assert "en" in langs
        assert "ru" in langs

    def test_list_languages_includes_plugin_langs(self, tmp_path: Path) -> None:
        locales_dir = tmp_path / "locales"
        _make_plugin_locales(locales_dir, "fr", {"ui.json": {"hello": "Bonjour"}})
        agg = I18nAggregator()
        agg.register_plugin_locales("frplugin", locales_dir)

        langs = agg.list_languages()
        assert "fr" in langs


class TestI18nAggregatorBadJson:
    def test_malformed_json_file_returns_empty(self, tmp_path: Path) -> None:
        locales_dir = tmp_path / "locales"
        lang_dir = locales_dir / "en"
        lang_dir.mkdir(parents=True)
        (lang_dir / "ui.json").write_text("{broken json", encoding="utf-8")

        agg = I18nAggregator()
        agg.register_plugin_locales("bad", locales_dir)
        result = agg.get_translations("en")
        assert "plugin:bad" not in result

    def test_non_object_json_file_returns_empty(self, tmp_path: Path) -> None:
        locales_dir = tmp_path / "locales"
        lang_dir = locales_dir / "en"
        lang_dir.mkdir(parents=True)
        (lang_dir / "ui.json").write_text("[1, 2, 3]", encoding="utf-8")

        agg = I18nAggregator()
        agg.register_plugin_locales("arr", locales_dir)
        result = agg.get_translations("en")
        assert "plugin:arr" not in result
