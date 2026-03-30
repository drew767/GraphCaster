# Copyright GraphCaster. All Rights Reserved.

"""Built-in functions for expression evaluation."""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone
from typing import Any, Callable


def _upper(s: str) -> str:
    return str(s).upper()


def _lower(s: str) -> str:
    return str(s).lower()


def _trim(s: str) -> str:
    return str(s).strip()


def _split(s: str, sep: str = ",") -> list[str]:
    return str(s).split(sep)


def _join(items: list[Any], sep: str = ",") -> str:
    return sep.join(str(x) for x in items)


def _replace(s: str, old: str, new: str) -> str:
    return str(s).replace(old, new)


def _floor(n: float) -> int:
    return math.floor(n)


def _ceil(n: float) -> int:
    return math.ceil(n)


def _first(items: list[Any]) -> Any:
    if not items:
        return None
    return items[0]


def _last(items: list[Any]) -> Any:
    if not items:
        return None
    return items[-1]


def _unique(items: list[Any]) -> list[Any]:
    seen: set[Any] = set()
    out: list[Any] = []
    for item in items:
        key = json.dumps(item, sort_keys=True) if isinstance(item, (dict, list)) else item
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


def _flatten(items: list[Any]) -> list[Any]:
    result: list[Any] = []
    for item in items:
        if isinstance(item, list):
            result.extend(item)
        else:
            result.append(item)
    return result


def _json_parse(s: str) -> Any:
    return json.loads(s)


def _json_stringify(obj: Any) -> str:
    return json.dumps(obj, separators=(",", ":"))


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _format_date(date_str: str, fmt: str) -> str:
    dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.strftime(fmt)


def _if(condition: bool, true_val: Any, false_val: Any) -> Any:
    return true_val if condition else false_val


def _coalesce(*values: Any) -> Any:
    for v in values:
        if v is not None:
            return v
    return None


def _default(value: Any, default: Any) -> Any:
    if value is None or value == "" or value == []:
        return default
    return value


def _contains(container: Any, item: Any) -> bool:
    if isinstance(container, str):
        return str(item) in container
    if isinstance(container, (list, tuple)):
        return item in container
    if isinstance(container, dict):
        return item in container
    return False


def _starts_with(s: str, prefix: str) -> bool:
    return str(s).startswith(prefix)


def _ends_with(s: str, suffix: str) -> bool:
    return str(s).endswith(suffix)


def _extract(s: str, start: int, end: int | None = None) -> str:
    return str(s)[start:end]


EXPRESSION_FUNCTIONS: dict[str, Callable[..., Any]] = {
    "upper": _upper,
    "lower": _lower,
    "trim": _trim,
    "split": _split,
    "join": _join,
    "replace": _replace,
    "contains": _contains,
    "starts_with": _starts_with,
    "ends_with": _ends_with,
    "extract": _extract,
    "floor": _floor,
    "ceil": _ceil,
    "first": _first,
    "last": _last,
    "unique": _unique,
    "flatten": _flatten,
    "json_parse": _json_parse,
    "json_stringify": _json_stringify,
    "now": _now,
    "format_date": _format_date,
    "if": _if,
    "coalesce": _coalesce,
    "default": _default,
}
