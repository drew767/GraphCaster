# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import jsonschema

_GRAPH_ROOT = Path(__file__).resolve().parents[3]
_SCHEMA_PATH = _GRAPH_ROOT / "schemas" / "run-event.schema.json"


@lru_cache(maxsize=1)
def _validator() -> jsonschema.Draft202012Validator:
    schema = json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))
    return jsonschema.Draft202012Validator(schema)


def ndjson_line_from_event(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def frame_from_ndjson_line(line: str, *, validate_schema: bool = True) -> dict:
    """
    Parse one NDJSON line into a WebSocket-style wrapper { runId, event }.
    When validate_schema is True, the object must satisfy run-event.schema.json
    and contain a string runId.
    """
    s = line.strip()
    if not s:
        msg = "empty line"
        raise ValueError(msg)
    try:
        obj = json.loads(s)
    except json.JSONDecodeError as e:
        msg = "invalid json"
        raise ValueError(msg) from e
    if not isinstance(obj, dict):
        msg = "event must be object"
        raise ValueError(msg)
    rid = obj.get("runId")
    if not isinstance(rid, str) or not rid.strip():
        msg = "runId required in event"
        raise ValueError(msg)
    if validate_schema:
        _validator().validate(obj)
    return {"runId": rid.strip(), "event": obj}
