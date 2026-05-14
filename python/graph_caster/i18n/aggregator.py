# Copyright GraphCaster. All Rights Reserved.

"""i18n aggregator: merge core + per-plugin locale contributions (F94)."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_LOCALE_FILES = ("nodeDefs.json", "commands.json", "ui.json")

_CORE_DIR = Path(__file__).parent / "core"


def _load_json_file(path: Path) -> dict[str, Any]:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, dict):
            logger.warning("i18n: %s is not a JSON object, skipping", path)
            return {}
        return data
    except FileNotFoundError:
        return {}
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("i18n: could not read %s: %s", path, exc)
        return {}


def _load_lang_dir(lang_dir: Path) -> dict[str, Any]:
    """Load all recognized locale files from a per-language directory."""
    result: dict[str, Any] = {}
    if not lang_dir.is_dir():
        return result
    for fname in _LOCALE_FILES:
        fpath = lang_dir / fname
        if fpath.exists():
            namespace = fpath.stem
            data = _load_json_file(fpath)
            if data:
                result[namespace] = data
    return result


def _merge_dicts(base: dict[str, Any], overlay: dict[str, Any]) -> dict[str, Any]:
    """Shallow-merge overlay into a copy of base."""
    result = dict(base)
    result.update(overlay)
    return result


class I18nAggregator:
    """Aggregates core and plugin-contributed locale translations.

    Usage::

        agg = I18nAggregator()
        agg.register_plugin_locales("my-plugin", Path("my_plugin/locales"))
        translations = agg.get_translations("en")
        # {"core": {...}, "plugin:my-plugin": {"ui": {...}, ...}}
    """

    def __init__(self) -> None:
        self._plugins: dict[str, Path] = {}

    def register_plugin_locales(self, plugin_name: str, locales_dir: Path) -> None:
        """Register a plugin's locales directory.

        Args:
            plugin_name: Plugin identifier used as namespace key ``plugin:<name>``.
            locales_dir: Path to the directory containing ``<lang>/`` subdirectories.
        """
        self._plugins[plugin_name] = Path(locales_dir)
        logger.debug("i18n: registered locales for plugin %r at %s", plugin_name, locales_dir)

    def unregister_plugin(self, plugin_name: str) -> None:
        """Remove a plugin's locale contributions."""
        self._plugins.pop(plugin_name, None)
        logger.debug("i18n: unregistered locales for plugin %r", plugin_name)

    def get_translations(self, lang: str) -> dict[str, Any]:
        """Return merged translations for ``lang``.

        Returns a dict with structure::

            {
                "core": { ... },                        # from core/<lang>.json
                "plugin:my-plugin": {                   # one key per registered plugin
                    "nodeDefs": { ... },
                    "ui": { ... },
                },
                ...
            }

        Missing language dirs or files are silently absent from the output.
        """
        result: dict[str, Any] = {}

        core_file = _CORE_DIR / f"{lang}.json"
        core_data = _load_json_file(core_file)
        result["core"] = core_data

        for plugin_name, locales_dir in self._plugins.items():
            lang_dir = locales_dir / lang
            plugin_data = _load_lang_dir(lang_dir)
            if plugin_data:
                result[f"plugin:{plugin_name}"] = plugin_data

        return result

    def list_languages(self) -> list[str]:
        """Return sorted list of languages available from core or any plugin."""
        langs: set[str] = set()

        if _CORE_DIR.is_dir():
            for f in _CORE_DIR.iterdir():
                if f.suffix == ".json":
                    langs.add(f.stem)

        for locales_dir in self._plugins.values():
            if locales_dir.is_dir():
                for child in locales_dir.iterdir():
                    if child.is_dir():
                        langs.add(child.name)

        return sorted(langs)


_global_aggregator: I18nAggregator | None = None


def get_aggregator() -> I18nAggregator:
    """Return the process-level singleton I18nAggregator."""
    global _global_aggregator
    if _global_aggregator is None:
        _global_aggregator = I18nAggregator()
    return _global_aggregator
