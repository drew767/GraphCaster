# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from starlette.testclient import TestClient

from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.registry import RunBrokerRegistry


def test_metrics_endpoint_text() -> None:
    reg = RunBrokerRegistry()
    app = create_app(registry=reg)
    c = TestClient(app)
    r = c.get("/metrics")
    assert r.status_code == 200
    assert "gc_run_broker_workers_active" in r.text
    assert "gc_run_broker_pending_queue_depth" in r.text
    assert "gc_graph_fork_threadpool_min_config" in r.text
