# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.run_sessions import RunSession, RunSessionRegistry


def test_rapid_register_complete_cycles() -> None:
    """Stress: many sessions complete without leaving orphans."""
    reg = RunSessionRegistry()
    for i in range(50):
        rid = f"run-{i}"
        reg.register(RunSession(run_id=rid, root_graph_id="g"))
        reg.complete(rid, "success" if i % 2 == 0 else "failed")
    assert reg.running_sessions() == []
