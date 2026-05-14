# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import copy
import os
import re
from collections.abc import Mapping
from typing import Any

_ENV_KEY_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _parse_env_keys_list(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for x in raw:
        if not isinstance(x, str):
            continue
        k = x.strip()
        if not k or k in seen:
            continue
        if _ENV_KEY_NAME_RE.fullmatch(k) is None:
            continue
        seen.add(k)
        out.append(k)
    return out


def task_declares_env_keys(data: Mapping[str, Any]) -> bool:
    return len(_parse_env_keys_list(data.get("envKeys"))) > 0


def _build_task_subprocess_env(
    data: dict[str, Any],
    workspace_secrets: Mapping[str, str] | None,
) -> dict[str, str] | None:
    ws = workspace_secrets or {}
    raw_env = data.get("env")
    has_explicit = isinstance(raw_env, dict) and len(raw_env) > 0
    keys = _parse_env_keys_list(data.get("envKeys"))

    if not has_explicit and not keys:
        return None

    out = dict(os.environ)
    explicit: dict[str, str] = {}
    if has_explicit:
        for k, v in raw_env.items():
            explicit[str(k)] = "" if v is None else str(v)

    for k in keys:
        if k in explicit:
            continue
        if k in ws:
            out[k] = ws[k]

    for k, v in explicit.items():
        out[k] = v
    return out


def redact_task_data_for_node_execute(data: dict[str, Any]) -> dict[str, Any]:
    keys = _parse_env_keys_list(data.get("envKeys"))
    if not keys:
        return data
    out = copy.deepcopy(data)
    env = out.get("env")
    if isinstance(env, dict):
        for k in keys:
            sk = str(k)
            if sk in env:
                env[sk] = "[redacted]"
    return out
