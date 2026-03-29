# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import os

from starlette.applications import Starlette

from graph_caster.run_broker.idempotency import IdempotencyCache
from graph_caster.run_broker.registry import RunBrokerRegistry
from graph_caster.run_broker.routes import build_run_broker_routes
from graph_caster.run_broker.routes.middleware import BrokerTokenMiddleware

_GLOBAL_REGISTRY = RunBrokerRegistry()
_WEBHOOK_IDEMPOTENCY = IdempotencyCache()


def create_app(registry: RunBrokerRegistry | None = None) -> Starlette:
    reg = registry if registry is not None else _GLOBAL_REGISTRY
    routes = build_run_broker_routes(reg, _WEBHOOK_IDEMPOTENCY)
    app = Starlette(routes=routes)
    if os.environ.get("GC_RUN_BROKER_TOKEN", "").strip():
        app.add_middleware(BrokerTokenMiddleware)
    return app
