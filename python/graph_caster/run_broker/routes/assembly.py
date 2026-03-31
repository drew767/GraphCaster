# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from starlette.routing import Route, WebSocketRoute

from graph_caster.run_broker.idempotency import IdempotencyCache
from graph_caster.run_broker.registry import RunBrokerRegistry
from graph_caster.run_broker.routes.api_v1_routes import make_api_v1_routes
from graph_caster.run_broker.routes.crdt_sync import crdt_sync_websocket
from graph_caster.run_broker.routes.http import make_http_handlers
from graph_caster.run_broker.routes.sse import make_stream_run_handler
from graph_caster.run_broker.routes.ws import make_ws_run_handler


def build_run_broker_routes(
    reg: RunBrokerRegistry,
    webhook_idempotency: IdempotencyCache,
) -> list[Route | WebSocketRoute]:
    h = make_http_handlers(reg, webhook_idempotency)
    stream_run = make_stream_run_handler(reg)
    ws_run = make_ws_run_handler(reg)
    routes: list[Route | WebSocketRoute] = [
        Route("/health", h["health"], methods=["GET"]),
        Route("/metrics", h["prometheus_metrics"], methods=["GET"]),
        Route("/webhooks/run", h["webhook_run"], methods=["POST"]),
        Route("/runs", h["create_run"], methods=["POST"]),
        Route("/runs/{run_id}/stream", stream_run, methods=["GET"]),
        WebSocketRoute("/runs/{run_id}/ws", ws_run),
        WebSocketRoute("/crdt/sync", crdt_sync_websocket),
        Route("/runs/{run_id}/cancel", h["cancel_run"], methods=["POST"]),
        Route("/persisted-runs/list", h["persisted_list"], methods=["POST"]),
        Route("/persisted-runs/events", h["persisted_events"], methods=["POST"]),
        Route("/persisted-runs/summary", h["persisted_summary"], methods=["POST"]),
        Route("/run-catalog/list", h["run_catalog_list"], methods=["POST"]),
        Route("/run-catalog/rebuild", h["run_catalog_rebuild"], methods=["POST"]),
    ]
    routes.extend(make_api_v1_routes(reg))
    return routes
