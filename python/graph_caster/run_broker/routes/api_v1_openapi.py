# Copyright Aura. All Rights Reserved.

"""OpenAPI 3.0 document for the stable HTTP **/api/v1/** surface (run broker).

Contract revision: bump ``GC_API_V1_OPENAPI_DOCUMENT_VERSION`` when paths, methods, or
breaking response shapes change. ``info.version`` stays aligned for operators and CI snapshots.
"""

from __future__ import annotations

from typing import Any

# Bump when the published contract changes incompatibly (hosts may snapshot openapi.json).
GC_API_V1_OPENAPI_DOCUMENT_VERSION = "1.1.0"


def build_api_v1_openapi_document() -> dict[str, Any]:
    """Return an OpenAPI 3.0.3 object describing ``/api/v1/*`` routes (plus this document URL)."""
    return {
        "openapi": "3.0.3",
        "info": {
            "title": "GraphCaster Run Broker — API v1",
            "description": (
                "BFF-style REST surface to start graph runs by **graphId**, poll status, and cancel. "
                "Matches handlers in ``api_v1_routes.py`` / ``APIV1Handler``. "
                "Optional auth: set ``GC_RUN_BROKER_V1_API_KEYS`` to ``kid:secret`` entries "
                "(comma-separated); send **Authorization: Bearer kid:secret**. "
                "Scopes: **run:execute** (start run), **run:view** (get status / persisted events), "
                "**run:cancel** (cancel)."
            ),
            "version": GC_API_V1_OPENAPI_DOCUMENT_VERSION,
        },
        "paths": {
            "/api/v1/openapi.json": {
                "get": {
                    "operationId": "getOpenApiV1",
                    "summary": "OpenAPI document for this API revision",
                    "tags": ["meta"],
                    "responses": {
                        "200": {
                            "description": "OpenAPI 3.0 JSON",
                            "content": {"application/json": {"schema": {"type": "object"}}},
                        }
                    },
                }
            },
            "/api/v1/graphs/{graph_id}/run": {
                "post": {
                    "operationId": "postGraphRun",
                    "summary": "Start a run for the given graph id",
                    "tags": ["runs"],
                    "parameters": [
                        {
                            "name": "graph_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string"},
                            "description": "Graph document **meta.graphId** (UUID string).",
                        }
                    ],
                    "requestBody": {
                        "required": False,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/RunStartBody"},
                            }
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Run accepted or completed (if waitForCompletion)",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/RunResponse"}
                                }
                            },
                        },
                        "400": {
                            "description": "Invalid body or parameters",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorBody"}
                                }
                            },
                        },
                        "401": {
                            "description": "Invalid or missing API key when auth is enabled",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorBody"}
                                }
                            },
                        },
                        "404": {
                            "description": "Graph file not found under graphs dir",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorBody"}
                                }
                            },
                        },
                        "503": {
                            "description": "Broker misconfiguration or queue full",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorBody"}
                                }
                            },
                        },
                    },
                    "security": [{"ApiKeyAuth": []}],
                }
            },
            "/api/v1/runs/{run_id}": {
                "get": {
                    "operationId": "getRunStatus",
                    "summary": "Get run status and optional outputs",
                    "tags": ["runs"],
                    "parameters": [
                        {
                            "name": "run_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string"},
                            "description": "**runId** returned from start run.",
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "Current run state",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/RunResponse"}
                                }
                            },
                        },
                        "401": {
                            "description": "Invalid or missing API key when auth is enabled",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorBody"}
                                }
                            },
                        },
                        "404": {
                            "description": "Unknown run id",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorBody"}
                                }
                            },
                        },
                    },
                    "security": [{"ApiKeyAuth": []}],
                }
            },
            "/api/v1/runs/{run_id}/events": {
                "get": {
                    "operationId": "getRunEventsNdjson",
                    "summary": "Download persisted run-event NDJSON (tail-capped)",
                    "description": (
                        "Reads ``events.ndjson`` under the run artifact directory when "
                        "``GC_RUN_BROKER_ARTIFACTS_BASE`` is set and the run has been persisted "
                        "(``run-summary.json`` present). Unknown **run_id** → **404**. "
                        "Known run with no file yet → empty body. "
                        "Response header **X-GC-Events-Truncated** is ``true`` when the byte cap "
                        "was applied (tail window of ``maxBytes``)."
                    ),
                    "tags": ["runs"],
                    "parameters": [
                        {
                            "name": "run_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string"},
                            "description": "**runId** returned from start run.",
                        },
                        {
                            "name": "maxBytes",
                            "in": "query",
                            "required": False,
                            "schema": {"type": "integer", "default": 1000000, "minimum": 0},
                            "description": "Max bytes to read (capped server-side); tail used when truncated.",
                        },
                    ],
                    "responses": {
                        "200": {
                            "description": "NDJSON lines (UTF-8), possibly empty",
                            "headers": {
                                "X-GC-Events-Truncated": {
                                    "schema": {"type": "string", "enum": ["true", "false"]},
                                    "description": "Whether the response is a capped tail of the file.",
                                }
                            },
                            "content": {
                                "application/x-ndjson": {
                                    "schema": {"type": "string", "format": "binary"},
                                }
                            },
                        },
                        "400": {
                            "description": "Invalid maxBytes",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorBody"}
                                }
                            },
                        },
                        "401": {
                            "description": "Invalid or missing API key when auth is enabled",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorBody"}
                                }
                            },
                        },
                        "404": {
                            "description": "Unknown run id",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorBody"}
                                }
                            },
                        },
                    },
                    "security": [{"ApiKeyAuth": []}],
                }
            },
            "/api/v1/runs/{run_id}/cancel": {
                "post": {
                    "operationId": "postRunCancel",
                    "summary": "Request cooperative cancellation of a run",
                    "tags": ["runs"],
                    "parameters": [
                        {
                            "name": "run_id",
                            "in": "path",
                            "required": True,
                            "schema": {"type": "string"},
                        }
                    ],
                    "responses": {
                        "200": {
                            "description": "Cancel result",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/CancelResponse"}
                                }
                            },
                        },
                        "401": {
                            "description": "Invalid or missing API key when auth is enabled",
                            "content": {
                                "application/json": {
                                    "schema": {"$ref": "#/components/schemas/ErrorBody"}
                                }
                            },
                        },
                    },
                    "security": [{"ApiKeyAuth": []}],
                }
            },
        },
        "components": {
            "securitySchemes": {
                "ApiKeyAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "gc-key",
                    "description": (
                        "``Bearer {keyId}:{secret}``. Unused when ``GC_RUN_BROKER_V1_API_KEYS`` is unset."
                    ),
                }
            },
            "schemas": {
                "RunStartBody": {
                    "type": "object",
                    "description": "Optional payload for **POST .../run**.",
                    "properties": {
                        "inputs": {
                            "type": "object",
                            "additionalProperties": True,
                            "description": "Merged into run **context** (default **{}**).",
                        },
                        "waitForCompletion": {
                            "type": "boolean",
                            "description": "CamelCase alias; wait until run finishes.",
                        },
                        "wait_for_completion": {
                            "type": "boolean",
                            "description": "Snake_case alias of **waitForCompletion**.",
                        },
                        "timeout": {
                            "type": "number",
                            "description": "Seconds to wait when **waitForCompletion** is true (default **300**).",
                        },
                    },
                    "additionalProperties": True,
                },
                "RunResponse": {
                    "type": "object",
                    "required": ["runId", "graphId", "status", "createdAt"],
                    "properties": {
                        "runId": {"type": "string"},
                        "graphId": {"type": "string"},
                        "status": {"type": "string"},
                        "createdAt": {"type": "string"},
                        "outputs": {"type": "object", "additionalProperties": True},
                        "error": {"type": "string"},
                    },
                    "additionalProperties": True,
                },
                "CancelResponse": {
                    "type": "object",
                    "required": ["runId", "cancelled"],
                    "properties": {
                        "runId": {"type": "string"},
                        "cancelled": {"type": "boolean"},
                        "message": {"type": "string", "nullable": True},
                    },
                    "additionalProperties": False,
                },
                "ErrorBody": {
                    "type": "object",
                    "properties": {"error": {"type": "string"}},
                    "required": ["error"],
                },
            },
        },
        "tags": [
            {"name": "meta", "description": "API contract metadata"},
            {"name": "runs", "description": "Graph run lifecycle"},
        ],
    }
