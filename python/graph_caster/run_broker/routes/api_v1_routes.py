# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import json
import logging
import os
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from graph_caster.run_broker.auth.api_key import APIKeyAuthenticator
from graph_caster.run_broker.routes.common import MAX_PERSISTED_EVENTS_BYTES
from graph_caster.run_broker.errors import PendingQueueFullError
from graph_caster.run_broker.registry import RunBrokerRegistry
from graph_caster.run_broker.registry_run_manager import BrokerRegistryRunManager
from graph_caster.run_broker.routes.api_v1 import (
    APIV1Handler,
    CancelResponse,
    RunRequest,
    RunResponse,
)
from graph_caster.run_broker.routes.api_v1_openapi import build_api_v1_openapi_document

logger = logging.getLogger(__name__)


def _load_api_v1_auth() -> APIKeyAuthenticator | None:
    raw = os.environ.get("GC_RUN_BROKER_V1_API_KEYS", "").strip()
    if not raw:
        return None
    auth = APIKeyAuthenticator()
    n = 0
    for entry in raw.split(","):
        entry = entry.strip()
        if ":" not in entry:
            continue
        kid, sec = entry.split(":", 1)
        kid, sec = kid.strip(), sec.strip()
        if not kid or not sec:
            continue
        auth.register_key(
            kid,
            sec,
            "v1-env",
            ["run:execute", "run:view", "run:cancel", "graph:edit", "audit:read"],
        )
        n += 1
    return auth if n else None


def _run_response_body(r: RunResponse) -> dict[str, Any]:
    d: dict[str, Any] = {
        "runId": r.run_id,
        "graphId": r.graph_id,
        "status": r.status,
        "createdAt": r.created_at,
    }
    if r.outputs is not None:
        d["outputs"] = r.outputs
    if r.error is not None:
        d["error"] = r.error
    return d


def _cancel_body(c: CancelResponse) -> dict[str, Any]:
    return {
        "runId": c.run_id,
        "cancelled": c.cancelled,
        "message": c.message,
    }


def make_api_v1_routes(reg: RunBrokerRegistry) -> list[Route]:
    mgr = BrokerRegistryRunManager.from_env(reg)
    handler = APIV1Handler(mgr, auth=_load_api_v1_auth())

    async def post_graph_run(request: Request) -> Response:
        graph_id = request.path_params["graph_id"]
        try:
            body = await request.json()
            if not isinstance(body, dict):
                return JSONResponse({"error": "body must be object"}, status_code=400)
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        inputs = body.get("inputs")
        if inputs is None:
            inputs = {}
        if not isinstance(inputs, dict):
            return JSONResponse({"error": "inputs must be object"}, status_code=400)

        wait_raw = body.get("waitForCompletion")
        if wait_raw is None:
            wait_raw = body.get("wait_for_completion")
        wait = bool(wait_raw)

        timeout_raw = body.get("timeout", 300.0)
        try:
            timeout = float(timeout_raw)
        except (TypeError, ValueError):
            timeout = 300.0

        start_from_node_raw = body.get("startFromNode") or body.get("start_from_node")
        start_from_node = str(start_from_node_raw).strip() if start_from_node_raw else None
        until_node_raw = body.get("untilNode") or body.get("until_node")
        until_node = str(until_node_raw).strip() if until_node_raw else None
        context_raw = body.get("context")
        if context_raw is not None and not isinstance(context_raw, dict):
            return JSONResponse({"error": "context must be object"}, status_code=400)
        context: dict | None = context_raw if isinstance(context_raw, dict) else None

        version_raw = body.get("version")
        graph_version: int | None = None
        if version_raw is not None:
            try:
                graph_version = int(version_raw)
            except (TypeError, ValueError):
                return JSONResponse({"error": "version must be integer"}, status_code=400)

        req = RunRequest(
            inputs=inputs,
            wait_for_completion=wait,
            timeout=timeout,
            start_from_node=start_from_node or None,
            until_node=until_node or None,
            context=context,
        )
        auth_h = request.headers.get("Authorization")
        try:
            resp = await handler.start_run(graph_id, req, auth_header=auth_h)
        except PermissionError as e:
            return JSONResponse({"error": str(e)}, status_code=401)
        except FileNotFoundError as e:
            return JSONResponse({"error": str(e)}, status_code=404)
        except ValueError as e:
            msg = str(e)
            if "not configured" in msg:
                logger.warning("api v1 start_run config error: %s", e)
                return JSONResponse({"error": msg}, status_code=503)
            return JSONResponse({"error": msg}, status_code=400)
        except PendingQueueFullError:
            return JSONResponse({"error": "pending_queue_full"}, status_code=503)

        body_out = _run_response_body(resp)
        if graph_version is not None:
            body_out["graphVersion"] = graph_version
        return JSONResponse(body_out)

    async def get_run(request: Request) -> Response:
        run_id = request.path_params["run_id"]
        auth_h = request.headers.get("Authorization")
        try:
            resp = await handler.get_run_status(run_id, auth_header=auth_h)
        except PermissionError as e:
            return JSONResponse({"error": str(e)}, status_code=401)
        except KeyError as e:
            return JSONResponse({"error": str(e)}, status_code=404)

        return JSONResponse(_run_response_body(resp))

    async def get_run_events(request: Request) -> Response:
        run_id = request.path_params["run_id"]
        auth_h = request.headers.get("Authorization")
        raw_mx = request.query_params.get("maxBytes")
        max_bytes = 1_000_000
        if raw_mx is not None and str(raw_mx).strip() != "":
            try:
                max_bytes = int(raw_mx)
            except (TypeError, ValueError):
                return JSONResponse(
                    {"error": "maxBytes query must be int"}, status_code=400
                )
        max_bytes = max(0, min(max_bytes, MAX_PERSISTED_EVENTS_BYTES))
        try:
            text, truncated = await handler.get_run_events(
                run_id, max_bytes=max_bytes, auth_header=auth_h
            )
        except PermissionError as e:
            return JSONResponse({"error": str(e)}, status_code=401)
        except KeyError as e:
            return JSONResponse({"error": str(e)}, status_code=404)

        return Response(
            content=text.encode("utf-8"),
            media_type="application/x-ndjson; charset=utf-8",
            headers={
                "X-GC-Events-Truncated": "true" if truncated else "false",
            },
        )

    async def post_cancel_run(request: Request) -> Response:
        run_id = request.path_params["run_id"]
        auth_h = request.headers.get("Authorization")
        try:
            resp = await handler.cancel_run(run_id, auth_header=auth_h)
        except PermissionError as e:
            return JSONResponse({"error": str(e)}, status_code=401)

        return JSONResponse(_cancel_body(resp))

    async def get_openapi_v1(_request: Request) -> Response:
        return JSONResponse(build_api_v1_openapi_document())

    # --- F45: pause/resume ---

    def _artifacts_base_for_resume() -> "Path | None":
        from pathlib import Path as _Path

        raw = os.environ.get("GC_RUN_BROKER_ARTIFACTS_BASE", "").strip()
        if raw:
            return _Path(raw).resolve()
        raw = os.environ.get("GC_RUN_BROKER_WORKSPACE_ROOT", "").strip()
        return _Path(raw).resolve() if raw else None

    async def post_resume_run(request: Request) -> Response:
        """POST /api/v1/runs/{run_id}/resume — resume a paused run with human input."""
        import asyncio as _asyncio_resume
        import json as _json_r
        import subprocess as _sp
        import sys as _sys
        from pathlib import Path as _Path

        run_id = request.path_params["run_id"]
        auth_h = request.headers.get("Authorization")

        if handler._auth is not None:
            key = handler._auth.validate(auth_h)
            if key is None:
                return JSONResponse({"error": "Invalid API key"}, status_code=403)
            if not handler._auth.has_scope(key, "run:execute"):
                return JSONResponse({"error": "Missing scope: run:execute"}, status_code=403)

        try:
            body = await request.json()
            if not isinstance(body, dict):
                return JSONResponse({"error": "body must be object"}, status_code=400)
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        node_id_raw = body.get("nodeId") or body.get("node_id")
        if not node_id_raw or not isinstance(node_id_raw, str):
            return JSONResponse({"error": "nodeId (string) is required"}, status_code=400)
        node_id = node_id_raw.strip()

        payload = body.get("payload")
        responded_by = body.get("respondedBy") or body.get("responded_by") or ""

        ab = _artifacts_base_for_resume()
        if ab is None:
            return JSONResponse(
                {"error": "artifacts base not configured (set GC_RUN_BROKER_ARTIFACTS_BASE)"},
                status_code=503,
            )

        from graph_caster.pause_resume import CheckpointStore as _CpStore

        store = _CpStore(ab)
        try:
            checkpoint = await store.load(run_id)
        except Exception as _e:
            logger.debug("resume: checkpoint load error: %s", _e)
            checkpoint = None

        if checkpoint is None:
            return JSONResponse({"error": f"No paused checkpoint found for run {run_id!r}"}, status_code=404)

        if checkpoint.paused_at_node != node_id:
            return JSONResponse(
                {
                    "error": (
                        f"nodeId mismatch: run is paused at {checkpoint.paused_at_node!r}, "
                        f"got {node_id!r}"
                    )
                },
                status_code=400,
            )

        graphs_dir_raw = os.environ.get("GC_RUN_BROKER_GRAPHS_DIR", "").strip()
        graphs_dir = _Path(graphs_dir_raw).resolve() if graphs_dir_raw else None

        graph_file: "_Path | None" = None
        if graphs_dir is not None:
            for candidate in graphs_dir.glob("*.json"):
                try:
                    doc_raw = _json_r.loads(candidate.read_text(encoding="utf-8"))
                    if str(doc_raw.get("graphId") or "") == checkpoint.graph_id:
                        graph_file = candidate
                        break
                    meta = doc_raw.get("meta") or {}
                    if str(meta.get("graphId") or "") == checkpoint.graph_id:
                        graph_file = candidate
                        break
                except Exception:
                    pass

        if graph_file is None:
            return JSONResponse(
                {"error": f"Graph document not found for graphId {checkpoint.graph_id!r}"},
                status_code=404,
            )

        ctx_for_resume: dict = {
            "run_id": run_id,
            "node_outputs": dict(checkpoint.node_outputs),
        }
        ctx_for_resume["node_outputs"][node_id] = {
            "nodeType": "human_input",
            "humanInput": {
                "value": payload,
                "approved": payload if checkpoint.kind == "approval" else None,
                "respondedAt": _asyncio_resume.__builtins__  # trick; use datetime below
                if False else __import__("datetime").datetime.now(
                    __import__("datetime").timezone.utc
                ).isoformat(),
                "respondedBy": responded_by,
                "timedOut": False,
            },
        }
        ctx_for_resume["node_outputs"][node_id]["humanInput"]["respondedAt"] = (
            __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
        )

        import tempfile as _tf

        with _tf.NamedTemporaryFile(
            mode="w", suffix=".json", delete=False, encoding="utf-8"
        ) as _ctxf:
            _json_r.dump({"node_outputs": ctx_for_resume["node_outputs"]}, _ctxf, ensure_ascii=False)
            ctx_json_path = _ctxf.name

        cmd = [
            _sys.executable,
            "-m",
            "graph_caster",
            "run",
            "-d",
            str(graph_file),
            "--run-id",
            run_id,
            "--start",
            node_id,
            "--context-json",
            ctx_json_path,
        ]
        if graphs_dir is not None:
            cmd += ["-g", str(graphs_dir)]
        cmd += ["--artifacts-base", str(ab)]

        ws_raw = os.environ.get("GC_RUN_BROKER_WORKSPACE_ROOT", "").strip()
        if ws_raw:
            cmd += ["--workspace-root", ws_raw]

        try:
            _sp.Popen(cmd, stdout=_sp.DEVNULL, stderr=_sp.DEVNULL)
        except Exception as _spawn_e:
            return JSONResponse({"error": f"Failed to spawn resume subprocess: {_spawn_e}"}, status_code=500)

        await store.delete(run_id)

        return JSONResponse({"runId": run_id, "status": "resumed", "nodeId": node_id})

    async def get_paused_runs(_request: Request) -> Response:
        """GET /api/v1/runs/paused — list all paused runs."""
        from pathlib import Path as _Path

        auth_h = _request.headers.get("Authorization")
        if handler._auth is not None:
            key = handler._auth.validate(auth_h)
            if key is None:
                return JSONResponse({"error": "Invalid API key"}, status_code=403)
            if not handler._auth.has_scope(key, "run:view"):
                return JSONResponse({"error": "Missing scope: run:view"}, status_code=403)

        ab = _artifacts_base_for_resume()
        if ab is None:
            return JSONResponse({"items": [], "error": "artifacts base not configured"})

        from graph_caster.pause_resume import CheckpointStore as _CpStore

        store = _CpStore(ab)
        try:
            items = await store.list_paused()
        except Exception as _e:
            logger.debug("get_paused_runs error: %s", _e)
            items = []

        return JSONResponse({
            "items": [
                {
                    "runId": c.run_id,
                    "graphId": c.graph_id,
                    "pausedAtNode": c.paused_at_node,
                    "prompt": c.prompt,
                    "kind": c.kind,
                    "choices": c.choices,
                    "pausedAt": c.paused_at,
                    "timeoutSec": c.timeout_sec,
                }
                for c in items
            ]
        })

    # --- F48: run-partial ---

    def _workspace_root_for_partial() -> "Path | None":
        from pathlib import Path as _Path

        raw = os.environ.get("GC_RUN_BROKER_WORKSPACE_ROOT", "").strip()
        if raw:
            return _Path(raw).resolve()
        raw = os.environ.get("GC_RUN_BROKER_ARTIFACTS_BASE", "").strip()
        return _Path(raw).resolve() if raw else None

    async def post_graph_run_partial(request: Request) -> Response:
        """POST /api/v1/graphs/{graph_id}/run-partial — start from a specific node."""
        graph_id = request.path_params["graph_id"]
        auth_h = request.headers.get("Authorization")

        if handler._auth is not None:
            key = handler._auth.validate(auth_h)
            if key is None:
                return JSONResponse({"error": "Invalid API key"}, status_code=403)
            if not handler._auth.has_scope(key, "run:execute"):
                return JSONResponse({"error": "Missing scope: run:execute"}, status_code=403)

        try:
            body = await request.json()
            if not isinstance(body, dict):
                return JSONResponse({"error": "body must be object"}, status_code=400)
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        start_node_raw = body.get("startNode") or body.get("start_node")
        if not start_node_raw or not isinstance(start_node_raw, str):
            return JSONResponse({"error": "startNode (string) is required"}, status_code=400)
        start_node = start_node_raw.strip()

        use_pins = bool(body.get("usePins", True))
        from_run_id_raw = body.get("fromRunId") or body.get("from_run_id")
        from_run_id = str(from_run_id_raw).strip() if from_run_id_raw else None
        overrides_raw = body.get("overrides")
        if overrides_raw is not None and not isinstance(overrides_raw, dict):
            return JSONResponse({"error": "overrides must be an object"}, status_code=400)
        overrides: dict | None = overrides_raw if isinstance(overrides_raw, dict) else None

        ws = _workspace_root_for_partial()
        try:
            resp = await handler.start_partial_run(
                graph_id,
                start_node=start_node,
                use_pins=use_pins,
                from_run_id=from_run_id,
                overrides=overrides,
                workspace_root=ws,
                auth_header=auth_h,
            )
        except PermissionError as exc:
            return JSONResponse({"error": str(exc)}, status_code=403)
        except FileNotFoundError as exc:
            return JSONResponse({"error": str(exc)}, status_code=404)
        except (ValueError, KeyError) as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)

        return JSONResponse(
            {
                "runId": resp.run_id,
                "graphId": resp.graph_id,
                "status": resp.status,
                "startNode": start_node,
                "createdAt": resp.created_at,
            }
        )

    # --- Replay routes (F102) ---

    def _replay_workspace() -> "Path | None":
        from pathlib import Path as _Path

        raw = os.environ.get("GC_RUN_BROKER_WORKSPACE_ROOT", "").strip()
        if raw:
            return _Path(raw).resolve()
        raw = os.environ.get("GC_RUN_BROKER_ARTIFACTS_BASE", "").strip()
        return _Path(raw).resolve() if raw else None

    async def post_run_replay(request: Request) -> Response:
        run_id = request.path_params["run_id"]
        auth_h = request.headers.get("Authorization")
        ws = _replay_workspace()
        if ws is None:
            return JSONResponse(
                {
                    "error": (
                        "workspace not configured "
                        "(set GC_RUN_BROKER_WORKSPACE_ROOT or GC_RUN_BROKER_ARTIFACTS_BASE)"
                    )
                },
                status_code=503,
            )
        try:
            body = await request.json()
            if not isinstance(body, dict):
                body = {}
        except (json.JSONDecodeError, ValueError, TypeError):
            body = {}
        start_from: str | None = body.get("startFrom") or body.get("start_from") or None
        override: dict | None = body.get("override") or None
        if override is not None and not isinstance(override, dict):
            return JSONResponse({"error": "override must be an object"}, status_code=400)
        try:
            new_run_id = await handler.start_replay(
                run_id,
                workspace_root=ws,
                start_from=start_from,
                override_inputs=override,
                auth_header=auth_h,
            )
        except PermissionError as e:
            return JSONResponse({"error": str(e)}, status_code=401)
        except (KeyError, ValueError) as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        except FileNotFoundError as e:
            return JSONResponse({"error": str(e)}, status_code=404)
        return JSONResponse({"newRunId": new_run_id, "replayOf": run_id})

    async def get_run_replay_plan(request: Request) -> Response:
        run_id = request.path_params["run_id"]
        auth_h = request.headers.get("Authorization")
        ws = _replay_workspace()
        if ws is None:
            return JSONResponse(
                {
                    "error": (
                        "workspace not configured "
                        "(set GC_RUN_BROKER_WORKSPACE_ROOT or GC_RUN_BROKER_ARTIFACTS_BASE)"
                    )
                },
                status_code=503,
            )
        start_from: str | None = request.query_params.get("startFrom") or None
        try:
            plan = await handler.get_replay_plan(
                run_id,
                workspace_root=ws,
                start_from=start_from,
                auth_header=auth_h,
            )
        except PermissionError as e:
            return JSONResponse({"error": str(e)}, status_code=401)
        except KeyError as e:
            return JSONResponse({"error": str(e)}, status_code=404)
        return JSONResponse(plan)

    async def get_config(_request: Request) -> Response:
        """GET /api/v1/config — public runtime config (no auth)."""
        public_url = os.environ.get("GC_RUN_BROKER_PUBLIC_URL", "").strip()
        from graph_caster.run_broker_scheduler import _scheduler_enabled
        from graph_caster.run_broker_fs_watcher import _fs_watcher_enabled
        from graph_caster.run_broker_poller import _poller_enabled

        redis_bus_enabled = False
        try:
            from graph_caster.run_broker_redis_bus import redis_bus_health
            _rh = redis_bus_health()
            redis_bus_enabled = _rh is not None and _rh is not False
        except Exception:
            pass

        collab_enabled = False
        try:
            from graph_caster.run_broker.collab_ws import collab_websocket as _cwf
            collab_enabled = callable(_cwf)
        except Exception:
            pass

        version = ""
        try:
            import graph_caster as _gc
            version = str(getattr(_gc, "__version__", ""))
        except Exception:
            pass

        return JSONResponse(
            {
                "publicUrl": public_url,
                "version": version,
                "features": {
                    "scheduler": _scheduler_enabled(),
                    "fsWatcher": _fs_watcher_enabled(),
                    "poller": _poller_enabled(),
                    "redisBus": redis_bus_enabled,
                    "collab": collab_enabled,
                },
            }
        )

    return [
        Route(
            "/api/v1/openapi.json",
            get_openapi_v1,
            methods=["GET"],
        ),
        Route(
            "/api/v1/config",
            get_config,
            methods=["GET"],
        ),
        Route(
            "/api/v1/graphs/{graph_id}/run",
            post_graph_run,
            methods=["POST"],
        ),
        # F48: Partial run from any node
        Route(
            "/api/v1/graphs/{graph_id}/run-partial",
            post_graph_run_partial,
            methods=["POST"],
        ),
        # F45: Pause/Resume — static route must come BEFORE parameterized {run_id} routes
        Route(
            "/api/v1/runs/paused",
            get_paused_runs,
            methods=["GET"],
        ),
        Route(
            "/api/v1/runs/{run_id}",
            get_run,
            methods=["GET"],
        ),
        Route(
            "/api/v1/runs/{run_id}/events",
            get_run_events,
            methods=["GET"],
        ),
        Route(
            "/api/v1/runs/{run_id}/cancel",
            post_cancel_run,
            methods=["POST"],
        ),
        Route(
            "/api/v1/runs/{run_id}/resume",
            post_resume_run,
            methods=["POST"],
        ),
        # Replay (F102)
        Route(
            "/api/v1/runs/{run_id}/replay",
            post_run_replay,
            methods=["POST"],
        ),
        Route(
            "/api/v1/runs/{run_id}/replay-plan",
            get_run_replay_plan,
            methods=["GET"],
        ),
        # Embeddable widget (F82)
        *_make_embed_routes(),
        # Templates marketplace (F78)
        *_make_marketplace_routes(handler._auth),
        # Annotations (F55)
        *_make_annotation_routes(reg, handler._auth),
        # Audit log (F87)
        *_make_audit_routes(handler._auth),
    ]


def _make_embed_routes() -> list[Route]:
    """Embed.js serve routes (F82)."""

    def _embed_js_path() -> "Path | None":
        from pathlib import Path as _Path
        raw = os.environ.get("GC_EMBED_JS_PATH", "").strip()
        if raw:
            return _Path(raw)
        candidate = _Path(__file__).resolve().parents[5] / "ui-embed" / "dist" / "embed.js"
        return candidate if candidate.is_file() else None

    def _cors_headers() -> dict[str, str]:
        origins = os.environ.get("GC_RUN_BROKER_PUBLIC_ORIGINS", "*").strip() or "*"
        return {
            "Access-Control-Allow-Origin": origins,
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
        }

    async def get_embed_js(_request: Request) -> Response:
        p = _embed_js_path()
        if p is None or not p.is_file():
            return JSONResponse(
                {"error": "embed.js not built — run: cd ui-embed && npm run build"},
                status_code=404,
            )
        content = p.read_bytes()
        headers = _cors_headers()
        headers["Cache-Control"] = "public, max-age=300"
        return Response(content=content, media_type="application/javascript", headers=headers)

    async def get_public_link_embed_js(request: Request) -> Response:
        link_id = request.path_params["link_id"]
        p = _embed_js_path()
        if p is None or not p.is_file():
            return JSONResponse(
                {"error": "embed.js not built — run: cd ui-embed && npm run build"},
                status_code=404,
            )
        js_content = p.read_bytes().decode("utf-8", errors="replace")
        public_url_raw = os.environ.get("GC_PUBLIC_BASE_URL", "").strip()
        api_base = (public_url_raw.rstrip("/") + "/api/v1") if public_url_raw else "/api/v1"
        injected = (
            js_content
            + "\n;window.GraphCaster&&window.GraphCaster.init({"
            + f'graphId:"",apiBase:"{api_base}",shareLinkId:"{link_id}"'
            + "});"
        )
        headers = _cors_headers()
        headers["Cache-Control"] = "no-cache"
        return Response(
            content=injected.encode("utf-8"),
            media_type="application/javascript",
            headers=headers,
        )

    async def options_embed_js(_request: Request) -> Response:
        return Response(content=b"", status_code=204, headers=_cors_headers())

    return [
        Route("/api/v1/embed.js", get_embed_js, methods=["GET"]),
        Route("/api/v1/embed.js", options_embed_js, methods=["OPTIONS"]),
        Route(
            "/api/v1/public/{link_id}/embed.js",
            get_public_link_embed_js,
            methods=["GET"],
        ),
    ]


def _make_marketplace_routes(auth: "APIKeyAuthenticator | None") -> list[Route]:
    """Templates marketplace routes (F78). Returns [] on import failure."""
    try:
        from pathlib import Path as _Path
        from graph_caster.marketplace import MarketplaceCatalog

        def _marketplace_dir() -> "_Path | None":
            raw = os.environ.get("GC_MARKETPLACE_DIR", "").strip()
            if raw:
                return _Path(raw).resolve()
            graphs_raw = os.environ.get("GC_RUN_BROKER_GRAPHS_DIR", "").strip()
            if graphs_raw:
                return _Path(graphs_raw).resolve() / "marketplace"
            return None

        def _get_catalog() -> "MarketplaceCatalog | None":
            d = _marketplace_dir()
            return MarketplaceCatalog(d) if d is not None else None

        def _check_graph_edit_auth(auth_h: "str | None") -> "Response | None":
            if auth is None:
                return None
            key = auth.validate(auth_h)
            if key is None:
                return JSONResponse({"error": "Invalid API key"}, status_code=403)
            if not auth.has_scope(key, "graph:edit"):
                return JSONResponse({"error": "Missing scope: graph:edit"}, status_code=403)
            return None

        async def get_marketplace_list(request: Request) -> Response:
            catalog = _get_catalog()
            if catalog is None:
                return JSONResponse({"items": [], "configured": False})
            framework = request.query_params.get("framework") or None
            usecase = request.query_params.get("usecase") or None
            tag = request.query_params.get("tag") or None
            items = await catalog.list(framework=framework, usecase=usecase, tag=tag)
            return JSONResponse(
                {
                    "items": [
                        {
                            "id": m.id,
                            "title": m.title,
                            "description": m.description,
                            "badge": m.badge,
                            "frameworks": m.frameworks,
                            "usecases": m.usecases,
                            "author": m.author,
                            "tags": m.tags,
                            "previewImage": m.preview_image,
                        }
                        for m in items
                    ],
                    "configured": True,
                }
            )

        async def get_marketplace_template(request: Request) -> Response:
            template_id = request.path_params["template_id"]
            catalog = _get_catalog()
            if catalog is None:
                return JSONResponse({"error": "marketplace not configured"}, status_code=503)
            doc = await catalog.get(template_id)
            if doc is None:
                return JSONResponse(
                    {"error": f"Template not found: {template_id!r}"}, status_code=404
                )
            return JSONResponse(doc)

        async def post_marketplace_instantiate(request: Request) -> Response:
            template_id = request.path_params["template_id"]
            auth_h = request.headers.get("Authorization")
            err = _check_graph_edit_auth(auth_h)
            if err is not None:
                return err
            catalog = _get_catalog()
            if catalog is None:
                return JSONResponse({"error": "marketplace not configured"}, status_code=503)
            try:
                body = await request.json()
                if not isinstance(body, dict):
                    return JSONResponse({"error": "body must be object"}, status_code=400)
            except (json.JSONDecodeError, ValueError, TypeError):
                return JSONResponse({"error": "invalid JSON body"}, status_code=400)
            target_graph_id = body.get("graph_id") or body.get("graphId")
            if not target_graph_id or not isinstance(target_graph_id, str):
                return JSONResponse(
                    {"error": "graph_id (string) is required"}, status_code=400
                )
            graphs_raw = os.environ.get("GC_RUN_BROKER_GRAPHS_DIR", "").strip()
            if not graphs_raw:
                return JSONResponse(
                    {"error": "graphs dir not configured (set GC_RUN_BROKER_GRAPHS_DIR)"},
                    status_code=503,
                )
            target_dir = _Path(graphs_raw).resolve()
            try:
                dest = await catalog.instantiate(template_id, target_graph_id, target_dir)
            except FileNotFoundError as exc:
                return JSONResponse({"error": str(exc)}, status_code=404)
            except ValueError as exc:
                return JSONResponse({"error": str(exc)}, status_code=400)
            return JSONResponse(
                {"graphId": target_graph_id, "path": str(dest)}, status_code=201
            )

        return [
            Route("/api/v1/marketplace", get_marketplace_list, methods=["GET"]),
            Route(
                "/api/v1/marketplace/{template_id}",
                get_marketplace_template,
                methods=["GET"],
            ),
            Route(
                "/api/v1/marketplace/{template_id}/instantiate",
                post_marketplace_instantiate,
                methods=["POST"],
            ),
        ]
    except Exception:
        logger.exception("Failed to register marketplace routes (F78)")
        return []


def _make_annotation_routes(
    reg: RunBrokerRegistry,
    auth: "APIKeyAuthenticator | None",
) -> list[Route]:
    """Annotation CRUD routes (F55). Returns [] on import failure."""
    try:
        from pathlib import Path as _Path
        from graph_caster.annotations import Annotation, AnnotationStore

        def _artifacts_base() -> "_Path | None":
            raw = os.environ.get("GC_RUN_BROKER_ARTIFACTS_BASE", "").strip()
            if raw:
                return _Path(raw).resolve()
            raw = os.environ.get("GC_RUN_BROKER_WORKSPACE_ROOT", "").strip()
            return _Path(raw).resolve() if raw else None

        def _check_annotate_auth(auth_h: "str | None") -> "Response | None":
            if auth is None:
                return None
            key = auth.validate(auth_h)
            if key is None:
                return JSONResponse({"error": "Invalid API key"}, status_code=403)
            return None

        async def post_run_annotation(request: Request) -> Response:
            run_id = request.path_params["run_id"]
            auth_h = request.headers.get("Authorization")
            err = _check_annotate_auth(auth_h)
            if err is not None:
                return err

            ab = _artifacts_base()
            if ab is None:
                return JSONResponse(
                    {"error": "artifacts base not configured"},
                    status_code=503,
                )

            graph_id = reg.get_graph_id_for_run(run_id)
            if graph_id is None:
                run_dir_root = ab / "runs"
                if run_dir_root.is_dir():
                    for gdir in run_dir_root.iterdir():
                        if not gdir.is_dir():
                            continue
                        for rdir in gdir.iterdir():
                            summary = rdir / "run-summary.json"
                            if summary.is_file():
                                try:
                                    import json as _json
                                    d = _json.loads(summary.read_text(encoding="utf-8"))
                                    if str(d.get("runId", "")) == run_id:
                                        graph_id = gdir.name
                                        break
                                except Exception:
                                    pass
                        if graph_id is not None:
                            break

            if graph_id is None:
                return JSONResponse({"error": f"Run {run_id!r} not found"}, status_code=404)

            store = AnnotationStore(ab)
            try:
                body = await request.json()
                if not isinstance(body, dict):
                    return JSONResponse({"error": "body must be object"}, status_code=400)
            except Exception:
                return JSONResponse({"error": "invalid JSON body"}, status_code=400)

            ann = Annotation(
                id=str(body.get("id", "")),
                run_id=run_id,
                node_id=body.get("node_id") or body.get("nodeId"),
                rating=body.get("rating"),
                comment=str(body.get("comment", "")),
                suggested_output=body.get("suggested_output") or body.get("suggestedOutput"),
                labels=list(body.get("labels", [])),
                author=str(body.get("author", "")),
            )
            await store.add(graph_id, ann)
            return JSONResponse(ann.to_dict(), status_code=201)

        async def get_run_annotations(request: Request) -> Response:
            run_id = request.path_params["run_id"]

            ab = _artifacts_base()
            if ab is None:
                return JSONResponse({"annotations": []})

            graph_id = reg.get_graph_id_for_run(run_id)
            if graph_id is None:
                run_dir_root = ab / "runs"
                if run_dir_root.is_dir():
                    for gdir in run_dir_root.iterdir():
                        if not gdir.is_dir():
                            continue
                        for rdir in gdir.iterdir():
                            summary = rdir / "run-summary.json"
                            if summary.is_file():
                                try:
                                    import json as _json
                                    d = _json.loads(summary.read_text(encoding="utf-8"))
                                    if str(d.get("runId", "")) == run_id:
                                        graph_id = gdir.name
                                        break
                                except Exception:
                                    pass
                        if graph_id is not None:
                            break

            if graph_id is None:
                return JSONResponse({"annotations": []})

            store = AnnotationStore(ab)
            anns = await store.list_for_run(graph_id, run_id)
            return JSONResponse({"annotations": [a.to_dict() for a in anns]})

        async def delete_run_annotation(request: Request) -> Response:
            run_id = request.path_params["run_id"]
            annotation_id = request.path_params["annotation_id"]
            auth_h = request.headers.get("Authorization")
            err = _check_annotate_auth(auth_h)
            if err is not None:
                return err

            ab = _artifacts_base()
            if ab is None:
                return JSONResponse({"error": "artifacts base not configured"}, status_code=503)

            graph_id = reg.get_graph_id_for_run(run_id)
            if graph_id is None:
                run_dir_root = ab / "runs"
                if run_dir_root.is_dir():
                    for gdir in run_dir_root.iterdir():
                        if not gdir.is_dir():
                            continue
                        for rdir in gdir.iterdir():
                            summary = rdir / "run-summary.json"
                            if summary.is_file():
                                try:
                                    import json as _json
                                    d = _json.loads(summary.read_text(encoding="utf-8"))
                                    if str(d.get("runId", "")) == run_id:
                                        graph_id = gdir.name
                                        break
                                except Exception:
                                    pass
                        if graph_id is not None:
                            break

            if graph_id is None:
                return JSONResponse({"error": f"Run {run_id!r} not found"}, status_code=404)

            store = AnnotationStore(ab)
            deleted = await store.delete(graph_id, run_id, annotation_id)
            if not deleted:
                return JSONResponse(
                    {"error": f"Annotation {annotation_id!r} not found"}, status_code=404
                )
            return JSONResponse({"deleted": annotation_id})

        async def get_graph_annotations(request: Request) -> Response:
            graph_id = request.path_params["graph_id"]
            ab = _artifacts_base()
            if ab is None:
                return JSONResponse({"annotations": [], "cursor": None})

            raw_limit = request.query_params.get("limit", "100")
            try:
                limit = max(1, min(int(raw_limit), 1000))
            except (TypeError, ValueError):
                limit = 100

            cursor_raw = request.query_params.get("cursor")

            store = AnnotationStore(ab)
            all_anns = await store.list_for_graph(graph_id)

            if cursor_raw:
                try:
                    import base64 as _b64
                    cursor_id = _b64.urlsafe_b64decode(cursor_raw.encode()).decode()
                    idx = next(
                        (i for i, a in enumerate(all_anns) if a.id == cursor_id), None
                    )
                    if idx is not None:
                        all_anns = all_anns[idx + 1:]
                except Exception:
                    pass

            page = all_anns[:limit]
            if len(all_anns) > limit:
                import base64 as _b64
                next_cursor: str | None = _b64.urlsafe_b64encode(
                    page[-1].id.encode()
                ).decode()
            else:
                next_cursor = None

            return JSONResponse(
                {"annotations": [a.to_dict() for a in page], "cursor": next_cursor}
            )

        return [
            Route(
                "/api/v1/runs/{run_id}/annotations",
                post_run_annotation,
                methods=["POST"],
            ),
            Route(
                "/api/v1/runs/{run_id}/annotations",
                get_run_annotations,
                methods=["GET"],
            ),
            Route(
                "/api/v1/runs/{run_id}/annotations/{annotation_id}",
                delete_run_annotation,
                methods=["DELETE"],
            ),
            Route(
                "/api/v1/graphs/{graph_id}/annotations",
                get_graph_annotations,
                methods=["GET"],
            ),
        ]
    except Exception:
        logger.exception("Failed to register annotation routes (F55)")
        return []


def _make_audit_routes(auth: "APIKeyAuthenticator | None") -> list[Route]:
    """Audit log REST routes (F87). Returns [] on import failure."""
    try:
        from graph_caster.audit.audit_query import AuditQuery
        from graph_caster.audit.audit_event import _audit_log_path

        def _check_audit_auth(auth_h: "str | None") -> "Response | None":
            if auth is None:
                return None
            key = auth.validate(auth_h)
            if key is None:
                return JSONResponse({"error": "Invalid API key"}, status_code=403)
            if not auth.has_scope(key, "audit:read"):
                return JSONResponse({"error": "Missing scope: audit:read"}, status_code=403)
            return None

        async def get_audit(request: Request) -> Response:
            auth_h = request.headers.get("Authorization")
            err = _check_audit_auth(auth_h)
            if err is not None:
                return err

            log_path = _audit_log_path()
            if log_path is None:
                return JSONResponse({"events": [], "cursor": None})

            raw_limit = request.query_params.get("limit", "100")
            try:
                limit = max(1, min(int(raw_limit), 1000))
            except (TypeError, ValueError):
                limit = 100

            cursor = request.query_params.get("cursor") or None
            actor = request.query_params.get("actor") or None
            action = request.query_params.get("action") or None
            target_kind = request.query_params.get("target_kind") or None
            target_id = request.query_params.get("target_id") or None
            tenant_id = request.query_params.get("tenant_id") or None
            result = request.query_params.get("result") or None
            since = request.query_params.get("since") or None
            until = request.query_params.get("until") or None

            q = AuditQuery(log_path)
            events, next_cursor = await q.query(
                actor=actor,
                tenant_id=tenant_id,
                action=action,
                target_kind=target_kind,
                target_id=target_id,
                result=result,
                since=since,
                until=until,
                limit=limit,
                cursor=cursor,
            )
            return JSONResponse(
                {"events": [e.to_dict() for e in events], "cursor": next_cursor}
            )

        return [
            Route("/api/v1/audit", get_audit, methods=["GET"]),
        ]
    except Exception:
        logger.exception("Failed to register audit routes (F87)")
        return []
