# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum


class Permission(str, Enum):
    GRAPH_READ = "graph:read"
    GRAPH_WRITE = "graph:write"
    GRAPH_EXECUTE = "graph:execute"
    GRAPH_DELETE = "graph:delete"
    RUN_VIEW = "run:view"
    RUN_CANCEL = "run:cancel"
    SECRETS_READ = "secrets:read"
    SECRETS_WRITE = "secrets:write"


@dataclass
class AuthContext:
    user_id: str
    tenant_id: str | None = None
    permissions: set[Permission] = field(default_factory=set)
