# Copyright GraphCaster. All Rights Reserved.

"""Composio action name registry — maps action names to callable wrappers.

Thin utilities used by ComposioBridge to normalise action metadata returned
by the SDK into GraphCaster-friendly ComposioActionMeta dataclasses.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass
class ComposioActionMeta:
    """Metadata for a single Composio action."""

    name: str
    app: str
    display_name: str
    description: str
    parameters: dict


def _parse_action(raw: Any) -> ComposioActionMeta:
    """Convert a raw SDK action object or dict into ComposioActionMeta."""
    if isinstance(raw, dict):
        name = raw.get("name", "")
        app = raw.get("appName", raw.get("app", ""))
        display_name = raw.get("displayName", raw.get("display_name", name))
        description = raw.get("description", "")
        parameters = raw.get("parameters", {})
    else:
        name = getattr(raw, "name", "") or ""
        app = (
            getattr(raw, "app_name", None)
            or getattr(raw, "appName", None)
            or getattr(raw, "app", None)
            or ""
        )
        display_name = (
            getattr(raw, "display_name", None)
            or getattr(raw, "displayName", None)
            or name
        )
        description = getattr(raw, "description", "") or ""
        parameters = getattr(raw, "parameters", {}) or {}
        if not isinstance(parameters, dict):
            parameters = {}

    return ComposioActionMeta(
        name=str(name),
        app=str(app),
        display_name=str(display_name),
        description=str(description),
        parameters=parameters,
    )


def parse_actions(raw_list: list[Any]) -> list[ComposioActionMeta]:
    """Parse a list of raw SDK action objects into ComposioActionMeta list."""
    return [_parse_action(r) for r in raw_list]
