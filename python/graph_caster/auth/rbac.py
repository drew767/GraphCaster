# Copyright GraphCaster. All Rights Reserved.

"""F84 RBAC: role-to-scope mapping, Principal dataclass, and require_scope decorator."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum
from functools import wraps
from typing import Any, Callable


class Role(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    EDITOR = "editor"
    VIEWER = "viewer"
    DATASET_OPERATOR = "dataset_operator"


ROLE_SCOPES: dict[Role, set[str]] = {
    Role.OWNER: {"*"},
    Role.ADMIN: {
        "graph:view", "graph:edit", "graph:publish",
        "run:view", "run:execute", "run:cancel", "run:annotate",
        "dataset:read", "dataset:write",
        "audit:read",
        "credential:read", "credential:write",
        "plugin:install", "plugin:enable", "plugin:disable",
        "user:read", "user:invite",
        "admin",
    },
    Role.EDITOR: {
        "graph:view", "graph:edit",
        "run:view", "run:execute", "run:cancel", "run:annotate",
        "dataset:read", "dataset:write",
    },
    Role.VIEWER: {"graph:view", "run:view", "dataset:read"},
    Role.DATASET_OPERATOR: {"dataset:read", "dataset:write", "graph:view"},
}


def scopes_for_role(role: Role) -> set[str]:
    """Return scope set for the given role. OWNER returns {"*"}."""
    return set(ROLE_SCOPES[role])


def has_scope(effective: set[str], required: str) -> bool:
    """True if effective contains '*', the required scope, or a matching wildcard prefix.

    Examples:
      has_scope({"*"}, "graph:edit")                   -> True
      has_scope({"graph:*"}, "graph:edit")             -> True
      has_scope({"graph:edit"}, "graph:edit")          -> True
      has_scope({"run:view"}, "graph:edit")            -> False
    """
    if "*" in effective:
        return True
    if required in effective:
        return True
    if ":" in required:
        prefix = required.split(":", 1)[0]
        if f"{prefix}:*" in effective:
            return True
    return False


@dataclass
class Principal:
    """Authenticated caller: either a session user or an API-key bearer."""

    user_id: str
    tenant_id: str
    role: Role
    api_key_scopes: set[str] | None = field(default=None)

    @property
    def effective_scopes(self) -> set[str]:
        """Scopes from API key when present, otherwise derived from role."""
        if self.api_key_scopes is not None:
            return set(self.api_key_scopes)
        return scopes_for_role(self.role)


# ---------------------------------------------------------------------------
# Starlette-compatible require_scope decorator
# ---------------------------------------------------------------------------

def require_scope(scope: str) -> Callable[[Any], Any]:
    """Endpoint decorator. Reads principal from request.scope["principal"].

    Returns HTTP 403 if the principal lacks the required scope, with an
    ``auth.access_denied`` audit event emitted.

    Usage::

        @require_scope("run:execute")
        async def post_graph_run(request: Request) -> Response:
            ...
    """
    def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
        @wraps(func)
        async def wrapper(request: Any, *args: Any, **kwargs: Any) -> Any:
            from starlette.responses import JSONResponse

            principal: Principal | None = request.scope.get("principal")
            if principal is None:
                await _emit_access_denied("anonymous", "default", scope, request)
                return JSONResponse({"error": "Unauthorized"}, status_code=401)

            if not has_scope(principal.effective_scopes, scope):
                await _emit_access_denied(principal.user_id, principal.tenant_id, scope, request)
                return JSONResponse(
                    {"error": f"Forbidden: missing scope {scope!r}"},
                    status_code=403,
                )

            return await func(request, *args, **kwargs)

        return wrapper

    return decorator


async def _emit_access_denied(
    user_id: str,
    tenant_id: str,
    scope: str,
    request: Any,
) -> None:
    try:
        from graph_caster.audit.audit_event import emit_async

        await emit_async(
            action="auth.access_denied",
            actor=user_id,
            actor_kind="user" if not user_id.startswith("apikey:") else "service",
            tenant_id=tenant_id,
            target_kind="scope",
            target_id=scope,
            result="failure",
            metadata={"required_scope": scope, "path": str(getattr(request, "url", ""))},
        )
    except Exception:
        pass
