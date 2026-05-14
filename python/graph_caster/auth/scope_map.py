# Copyright GraphCaster. All Rights Reserved.

"""F84: Centralised endpoint -> required scope mapping.

This is the single source of truth so scope requirements do not drift
across decorators scattered through handler files.
"""

from __future__ import annotations

ENDPOINT_SCOPES: dict[str, str] = {
    # Run lifecycle
    "POST /api/v1/graphs/{graph_id}/run": "run:execute",
    "POST /api/v1/runs/{run_id}/cancel": "run:cancel",
    "GET /api/v1/runs/{run_id}/events": "run:view",
    "GET /api/v1/runs/{run_id}": "run:view",
    "POST /api/v1/runs/{run_id}/annotations": "run:annotate",
    "GET /api/v1/runs/{run_id}/annotations": "run:view",
    "DELETE /api/v1/runs/{run_id}/annotations/{ann_id}": "run:annotate",
    "GET /api/v1/graphs/{graph_id}/annotations": "run:view",
    # Replay (F102)
    "POST /api/v1/runs/{run_id}/replay": "run:execute",
    "GET /api/v1/runs/{run_id}/replay-plan": "run:view",
    # Graph versioning (F49)
    "POST /api/v1/graphs/{graph_id}/publish": "graph:publish",
    "GET /api/v1/graphs/{graph_id}/versions": "graph:view",
    "GET /api/v1/graphs/{graph_id}/versions/{version}": "graph:view",
    "POST /api/v1/graphs/{graph_id}/rollback": "graph:edit",
    "GET /api/v1/graphs/{graph_id}/diff": "graph:view",
    # Audit log (F87)
    "GET /api/v1/audit": "audit:read",
    # AI builder (F91)
    "POST /api/v1/ai-build": "graph:edit",
    "POST /api/v1/graphs/{graph_id}/ai-refine": "graph:edit",
    # Credentials (UX47/48)
    "GET /api/v1/credentials": "credential:read",
    "GET /api/v1/credentials/{cred_id}": "credential:read",
    "POST /api/v1/credentials": "credential:write",
    "PATCH /api/v1/credentials/{cred_id}": "credential:write",
    "DELETE /api/v1/credentials/{cred_id}": "credential:write",
    "POST /api/v1/credentials/{cred_id}/test": "credential:write",
    # Users (UX53)
    "GET /api/v1/users": "user:read",
    "POST /api/v1/users/invite": "user:invite",
    # API keys (UX54)
    "GET /api/v1/api-keys": "authenticated",
    "POST /api/v1/api-keys": "authenticated",
    "DELETE /api/v1/api-keys/{key_id}": "authenticated",
    # Projects (F83 extension)
    "GET /api/v1/projects": "project:read",
    "POST /api/v1/projects": "project:write",
    "GET /api/v1/projects/{project_id}": "project:read",
    "PATCH /api/v1/projects/{project_id}": "project:write",
    "DELETE /api/v1/projects/{project_id}": "project:write",
    "GET /api/v1/projects/{project_id}/members": "project:read",
    "POST /api/v1/projects/{project_id}/members/invite": "project:write",
    "DELETE /api/v1/projects/{project_id}/members/{user_id}": "project:write",
    "GET /api/v1/projects/{project_id}/workflows": "project:read",
    "GET /api/v1/projects/{project_id}/credentials": "project:read",
    "GET /api/v1/projects/{project_id}/variables": "project:read",
    # SSO config (F85 extension)
    "GET /api/v1/sso/providers": "admin",
    "GET /api/v1/sso/providers/{provider}": "admin",
    "PUT /api/v1/sso/providers/{provider}": "admin",
    "DELETE /api/v1/sso/providers/{provider}": "admin",
    "POST /api/v1/sso/providers/{provider}/test": "admin",
    # Secrets providers config (F8 extension)
    "GET /api/v1/secrets/providers": "admin",
    "PUT /api/v1/secrets/providers/{provider_id}": "admin",
    "POST /api/v1/secrets/providers/{provider_id}/test": "admin",
    # Source control (F49 extension)
    "GET /api/v1/source-control/status": "source_control:read",
    "POST /api/v1/source-control/connect": "source_control:write",
    "POST /api/v1/source-control/disconnect": "source_control:write",
    "GET /api/v1/source-control/branches": "source_control:read",
    "POST /api/v1/source-control/pull": "source_control:write",
    "POST /api/v1/source-control/push": "source_control:write",
    "GET /api/v1/source-control/history": "source_control:read",
    "GET /api/v1/source-control/diff": "source_control:read",
}
