# Copyright GraphCaster. All Rights Reserved.

"""Built-in tool: JSON parsing with optional dot-path filter."""

from __future__ import annotations

import json
import re
from typing import Any


def _apply_path(data: Any, jq_path: str) -> Any:
    """Apply a simple dot-path filter like .items[0].name to parsed JSON data.

    Supports:
    - .key        — dict key access
    - [N]         — list index access (negative indices allowed)
    - Combinations: .items[0].name
    """
    path = jq_path.strip()
    if path.startswith("."):
        path = path[1:]

    if not path:
        return data

    token_re = re.compile(r"(\w+)|\[(-?\d+)\]")
    current = data

    i = 0
    while i < len(path):
        if path[i] == ".":
            i += 1
            continue

        if path[i] == "[":
            m = re.match(r"\[(-?\d+)\]", path[i:])
            if m is None:
                raise ValueError(f"Invalid index expression at position {i} in path {jq_path!r}")
            idx = int(m.group(1))
            if not isinstance(current, list):
                raise TypeError(
                    f"Expected list for index [{idx}], got {type(current).__name__}"
                )
            try:
                current = current[idx]
            except IndexError:
                raise IndexError(f"List index {idx} out of range")
            i += m.end()
            continue

        m = re.match(r"(\w+)", path[i:])
        if m is None:
            raise ValueError(f"Invalid path token at position {i} in path {jq_path!r}")
        key = m.group(1)
        if not isinstance(current, dict):
            raise TypeError(
                f"Expected dict for key {key!r}, got {type(current).__name__}"
            )
        if key not in current:
            raise KeyError(f"Key {key!r} not found")
        current = current[key]
        i += m.end()

    return current


async def json_parse(text: str, *, jq_path: str | None = None) -> Any:
    """Parse a JSON string and optionally apply a simple dot-path filter.

    text:     Raw JSON string.
    jq_path:  Optional path like ".items[0].name" (subset of jq syntax).
              Supports dict key access and list index access.
    """
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid JSON: {exc}") from exc

    if jq_path is None:
        return data

    return _apply_path(data, jq_path)
