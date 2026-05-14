# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from typing import Any

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
    *,
    scheduler: Any = None,
) -> list[Route | WebSocketRoute]:
    h = make_http_handlers(reg, webhook_idempotency)
    stream_run = make_stream_run_handler(reg)
    ws_run = make_ws_run_handler(reg)
    routes: list[Route | WebSocketRoute] = [
        Route("/health", h["health"], methods=["GET"]),
        Route("/metrics", h["prometheus_metrics"], methods=["GET"]),
        Route(
            "/webhooks/trigger/{graph_id}/{path:path}",
            h["webhook_graph_trigger"],
            methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
        ),
        Route(
            "/webhooks/trigger/{graph_id}",
            h["webhook_graph_trigger"],
            methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
        ),
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
    routes.extend(_make_schedules_routes(scheduler))
    routes.extend(_make_versioning_routes())
    routes.extend(_make_thumbnail_routes())
    routes.extend(_make_i18n_routes())
    return routes


def _make_schedules_routes(scheduler: Any) -> list[Route]:
    from starlette.requests import Request
    from starlette.responses import JSONResponse, Response

    async def get_schedules(_request: Request) -> Response:
        if scheduler is None:
            return JSONResponse({"enabled": False, "items": []})
        try:
            jobs = scheduler.list_jobs()
            return JSONResponse({"enabled": True, "items": [j.to_dict() for j in jobs]})
        except Exception:
            return JSONResponse({"enabled": True, "items": []})

    return [Route("/api/v1/triggers/schedules", get_schedules, methods=["GET"])]


def _make_versioning_routes() -> list[Route]:
    """Graph version publish/list/rollback/diff routes (F98)."""
    try:
        import os as _os
        from pathlib import Path as _Path
        from starlette.requests import Request
        from starlette.responses import JSONResponse, Response
        from graph_caster.versioning import VersionManager

        def _vm() -> "VersionManager | None":
            raw = _os.environ.get("GC_RUN_BROKER_WORKSPACE_ROOT", "").strip()
            return VersionManager(_Path(raw).resolve()) if raw else None

        def _graph_view_auth(auth_h: "str | None") -> "Response | None":
            from graph_caster.run_broker.routes.api_v1_routes import _load_api_v1_auth
            auth = _load_api_v1_auth()
            if auth is None:
                return None
            key = auth.validate(auth_h)
            if key is None:
                return JSONResponse({"error": "Invalid API key"}, status_code=403)
            if not auth.has_scope(key, "graph:view"):
                return JSONResponse({"error": "Missing scope: graph:view"}, status_code=403)
            return None

        def _graph_edit_auth(auth_h: "str | None") -> "Response | None":
            from graph_caster.run_broker.routes.api_v1_routes import _load_api_v1_auth
            auth = _load_api_v1_auth()
            if auth is None:
                return None
            key = auth.validate(auth_h)
            if key is None:
                return JSONResponse({"error": "Invalid API key"}, status_code=403)
            if not auth.has_scope(key, "graph:edit"):
                return JSONResponse({"error": "Missing scope: graph:edit"}, status_code=403)
            return None

        async def post_publish(request: Request) -> Response:
            graph_id = request.path_params["graph_id"]
            auth_h = request.headers.get("Authorization")
            err = _graph_edit_auth(auth_h)
            if err is not None:
                return err
            vm = _vm()
            if vm is None:
                return JSONResponse({"error": "workspace not configured"}, status_code=503)
            try:
                body = await request.json()
                if not isinstance(body, dict):
                    body = {}
            except Exception:
                body = {}
            author = str(body.get("author") or "")
            message = str(body.get("message") or "")
            try:
                ver = await vm.publish(graph_id, author=author, message=message)
            except FileNotFoundError as e:
                return JSONResponse({"error": str(e)}, status_code=404)
            except ValueError as e:
                return JSONResponse({"error": str(e)}, status_code=400)
            return JSONResponse(ver.to_dict(), status_code=201)

        async def get_versions(request: Request) -> Response:
            graph_id = request.path_params["graph_id"]
            auth_h = request.headers.get("Authorization")
            err = _graph_view_auth(auth_h)
            if err is not None:
                return err
            vm = _vm()
            if vm is None:
                return JSONResponse({"versions": []})
            vers = await vm.list_versions(graph_id)
            return JSONResponse({"versions": [v.to_dict() for v in vers]})

        async def get_single_version(request: Request) -> Response:
            graph_id = request.path_params["graph_id"]
            version_num = int(request.path_params["version"])
            auth_h = request.headers.get("Authorization")
            err = _graph_view_auth(auth_h)
            if err is not None:
                return err
            vm = _vm()
            if vm is None:
                return JSONResponse({"error": "workspace not configured"}, status_code=503)
            try:
                ver = await vm.get_version(graph_id, version_num)
                document = await vm.load_graph(graph_id, version_num)
            except KeyError as e:
                return JSONResponse({"error": str(e)}, status_code=404)
            return JSONResponse({"version": ver.to_dict(), "document": document})

        async def post_rollback(request: Request) -> Response:
            graph_id = request.path_params["graph_id"]
            auth_h = request.headers.get("Authorization")
            err = _graph_edit_auth(auth_h)
            if err is not None:
                return err
            vm = _vm()
            if vm is None:
                return JSONResponse({"error": "workspace not configured"}, status_code=503)
            try:
                body = await request.json()
                if not isinstance(body, dict):
                    body = {}
            except Exception:
                body = {}
            version_raw = body.get("version")
            if version_raw is None:
                return JSONResponse({"error": "version is required"}, status_code=400)
            try:
                version_num = int(version_raw)
            except (TypeError, ValueError):
                return JSONResponse({"error": "version must be integer"}, status_code=400)
            try:
                ver = await vm.get_version(graph_id, version_num)
                await vm.rollback_draft_to(graph_id, version_num)
            except (KeyError, FileNotFoundError) as e:
                return JSONResponse({"error": str(e)}, status_code=404)
            except ValueError as e:
                return JSONResponse({"error": str(e)}, status_code=400)
            return JSONResponse({"rolledBack": True, "version": ver.to_dict()})

        async def get_diff(request: Request) -> Response:
            graph_id = request.path_params["graph_id"]
            auth_h = request.headers.get("Authorization")
            err = _graph_view_auth(auth_h)
            if err is not None:
                return err
            vm = _vm()
            if vm is None:
                return JSONResponse({"error": "workspace not configured"}, status_code=503)
            from_raw = (
                request.query_params.get("a")
                or request.query_params.get("from")
                or request.query_params.get("fromVersion")
            )
            to_raw = (
                request.query_params.get("b")
                or request.query_params.get("to")
                or request.query_params.get("toVersion")
            )
            try:
                from_v = int(from_raw) if from_raw else None
                to_v = int(to_raw) if to_raw else None
            except (TypeError, ValueError):
                return JSONResponse({"error": "version params must be integers"}, status_code=400)
            try:
                result = await vm.diff(graph_id, from_v, to_v)
            except (KeyError, FileNotFoundError) as e:
                return JSONResponse({"error": str(e)}, status_code=404)
            return JSONResponse(result)

        return [
            Route("/api/v1/graphs/{graph_id}/publish", post_publish, methods=["POST"]),
            Route("/api/v1/graphs/{graph_id}/versions", get_versions, methods=["GET"]),
            Route("/api/v1/graphs/{graph_id}/versions/{version:int}", get_single_version, methods=["GET"]),
            Route("/api/v1/graphs/{graph_id}/rollback", post_rollback, methods=["POST"]),
            Route("/api/v1/graphs/{graph_id}/diff", get_diff, methods=["GET"]),
        ]
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Failed to register versioning routes (F98)")
        return []


def _make_thumbnail_routes() -> list[Route]:
    """Graph thumbnail upload/retrieve/delete routes (F93)."""
    try:
        import os as _os
        from pathlib import Path as _Path
        from starlette.requests import Request
        from starlette.responses import JSONResponse, Response

        _MAX_PNG_BYTES = 1_048_576
        _PNG_MAGIC = b"\x89PNG\r\n\x1a\n"

        def _graphs_dir() -> "_Path | None":
            raw = _os.environ.get("GC_RUN_BROKER_GRAPHS_DIR", "").strip()
            if raw:
                return _Path(raw).resolve()
            ws = _os.environ.get("GC_RUN_BROKER_WORKSPACE_ROOT", "").strip()
            return (_Path(ws).resolve() / "graphs") if ws else None

        def _check_graph_edit_auth(auth_h: "str | None") -> "Response | None":
            from graph_caster.run_broker.routes.api_v1_routes import _load_api_v1_auth
            auth = _load_api_v1_auth()
            if auth is None:
                return None
            key = auth.validate(auth_h)
            if key is None:
                return JSONResponse({"error": "Invalid API key"}, status_code=403)
            if not auth.has_scope(key, "graph:edit"):
                return JSONResponse({"error": "Missing scope: graph:edit"}, status_code=403)
            return None

        async def post_thumbnail(request: Request) -> Response:
            graph_id = request.path_params["graph_id"]
            auth_h = request.headers.get("Authorization")
            err = _check_graph_edit_auth(auth_h)
            if err is not None:
                return err
            content_type = request.headers.get("content-type", "")
            if "multipart" in content_type:
                form = await request.form()
                file_field = form.get("file")
                if file_field is None:
                    return JSONResponse({"error": "missing file field"}, status_code=400)
                data = await file_field.read()
            else:
                data = await request.body()
            if len(data) > _MAX_PNG_BYTES:
                return JSONResponse({"error": "File too large (max 1 MB)"}, status_code=413)
            if not data.startswith(_PNG_MAGIC):
                return JSONResponse({"error": "Only PNG files are accepted"}, status_code=400)
            gd = _graphs_dir()
            if gd is None:
                return JSONResponse({"error": "graphs dir not configured"}, status_code=503)
            gd.mkdir(parents=True, exist_ok=True)
            thumb = gd / f"{graph_id}.thumb.png"
            thumb.write_bytes(data)
            return JSONResponse({"saved": True, "path": str(thumb)}, status_code=201)

        async def get_thumbnail(request: Request) -> Response:
            graph_id = request.path_params["graph_id"]
            gd = _graphs_dir()
            if gd is None:
                return JSONResponse({"error": "graphs dir not configured"}, status_code=503)
            thumb = gd / f"{graph_id}.thumb.png"
            if not thumb.is_file():
                return JSONResponse({"error": "thumbnail not found"}, status_code=404)
            data = thumb.read_bytes()
            return Response(content=data, media_type="image/png")

        async def delete_thumbnail(request: Request) -> Response:
            graph_id = request.path_params["graph_id"]
            auth_h = request.headers.get("Authorization")
            err = _check_graph_edit_auth(auth_h)
            if err is not None:
                return err
            gd = _graphs_dir()
            if gd is None:
                return JSONResponse({"error": "graphs dir not configured"}, status_code=503)
            thumb = gd / f"{graph_id}.thumb.png"
            if not thumb.is_file():
                return JSONResponse({"error": "thumbnail not found"}, status_code=404)
            thumb.unlink()
            return JSONResponse({"deleted": True})

        return [
            Route("/api/v1/graphs/{graph_id}/thumbnail", post_thumbnail, methods=["POST"]),
            Route("/api/v1/graphs/{graph_id}/thumbnail", get_thumbnail, methods=["GET"]),
            Route("/api/v1/graphs/{graph_id}/thumbnail", delete_thumbnail, methods=["DELETE"]),
        ]
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Failed to register thumbnail routes (F93)")
        return []


def _make_i18n_routes() -> list[Route]:
    """i18n translation endpoint (F94)."""
    try:
        from starlette.requests import Request
        from starlette.responses import JSONResponse, Response
        from graph_caster.i18n.aggregator import get_aggregator

        async def get_i18n(request: Request) -> Response:
            lang = request.path_params["lang"]
            aggregator = get_aggregator()
            translations = aggregator.get_translations(lang)
            headers = {}
            core = translations.get("core", {})
            if not core:
                headers["X-GC-I18n-Warning"] = f"no translations for {lang!r}; returning empty"
            return JSONResponse(translations or {}, headers=headers)

        return [Route("/api/v1/i18n/{lang}", get_i18n, methods=["GET"])]
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Failed to register i18n routes (F94)")
        return []
