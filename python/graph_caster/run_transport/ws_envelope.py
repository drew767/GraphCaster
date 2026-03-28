# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json

from graph_caster.run_broker.broadcaster import FanOutMsg


def broker_ws_payload_from_fanout(run_id: str, msg: FanOutMsg) -> dict:
    if msg.kind == "out":
        return {"runId": run_id, "channel": "stdout", "line": str(msg.payload)}
    if msg.kind == "err":
        raw = str(msg.payload)
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = {"line": raw}
        return {"runId": run_id, "channel": "stderr", "payload": payload}
    if msg.kind == "exit":
        return {"runId": run_id, "channel": "exit", "code": int(msg.payload)}
    msg = f"unknown fanout kind: {msg.kind!r}"
    raise ValueError(msg)
