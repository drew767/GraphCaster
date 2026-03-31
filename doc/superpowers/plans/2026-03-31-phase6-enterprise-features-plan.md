# Phase 6: Enterprise Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enterprise-grade features — RBAC hook interface, audit logging, SSO integration points, and multi-tenant isolation.

**Architecture:** Hook-based architecture for extensibility without coupling. RBAC and Audit are interfaces that host applications implement. Core GraphCaster remains agnostic to specific auth providers.

**Tech Stack:** Python 3.11+, Protocol classes, existing runner and services

---

## File Structure

```
python/graph_caster/
├── auth/
│   ├── __init__.py
│   ├── permissions.py      # Permission model
│   ├── rbac_hook.py        # RBAC hook interface
│   └── context.py          # Auth context
├── audit/
│   ├── __init__.py
│   ├── audit_hook.py       # Audit hook interface
│   ├── events.py           # Audit event types
│   └── decorators.py       # Audit decorators
├── tenant/
│   ├── __init__.py
│   ├── isolation.py        # Tenant isolation
│   └── context.py          # Tenant context
└── enterprise/
    ├── __init__.py
    └── hooks.py            # Hook registry
```

---

## Task 1: Permission Model

**Files:**
- Create: `python/graph_caster/auth/__init__.py`
- Create: `python/graph_caster/auth/permissions.py`
- Test: `python/tests/test_permissions.py`

- [ ] **Step 1: Define permission model**

```python
# permissions.py
from enum import Enum, auto
from dataclasses import dataclass, field
from typing import Set, Optional

class Permission(Enum):
    """GraphCaster permissions.
    
    Pattern: Fine-grained permissions like n8n's RBAC system.
    """
    # Graph permissions
    GRAPH_VIEW = auto()
    GRAPH_CREATE = auto()
    GRAPH_EDIT = auto()
    GRAPH_DELETE = auto()
    GRAPH_EXECUTE = auto()
    
    # Run permissions
    RUN_VIEW = auto()
    RUN_CREATE = auto()
    RUN_CANCEL = auto()
    RUN_VIEW_LOGS = auto()
    
    # Workspace permissions
    WORKSPACE_VIEW = auto()
    WORKSPACE_MANAGE = auto()
    WORKSPACE_INVITE = auto()
    
    # Admin permissions
    ADMIN_USERS = auto()
    ADMIN_SETTINGS = auto()
    ADMIN_AUDIT = auto()
    
    # Secrets permissions
    SECRETS_VIEW = auto()
    SECRETS_MANAGE = auto()

class Role(Enum):
    """Built-in roles with permission sets."""
    VIEWER = "viewer"
    EDITOR = "editor"
    EXECUTOR = "executor"
    ADMIN = "admin"
    OWNER = "owner"

# Role -> Permissions mapping
ROLE_PERMISSIONS: dict[Role, Set[Permission]] = {
    Role.VIEWER: {
        Permission.GRAPH_VIEW,
        Permission.RUN_VIEW,
        Permission.WORKSPACE_VIEW,
    },
    Role.EDITOR: {
        Permission.GRAPH_VIEW,
        Permission.GRAPH_CREATE,
        Permission.GRAPH_EDIT,
        Permission.GRAPH_DELETE,
        Permission.RUN_VIEW,
        Permission.WORKSPACE_VIEW,
    },
    Role.EXECUTOR: {
        Permission.GRAPH_VIEW,
        Permission.GRAPH_EXECUTE,
        Permission.RUN_VIEW,
        Permission.RUN_CREATE,
        Permission.RUN_CANCEL,
        Permission.RUN_VIEW_LOGS,
        Permission.WORKSPACE_VIEW,
    },
    Role.ADMIN: {
        # All permissions except OWNER-only
        *Permission,
    } - {Permission.ADMIN_SETTINGS},
    Role.OWNER: {
        *Permission,  # All permissions
    },
}

@dataclass
class AuthContext:
    """Authentication context for a request/operation."""
    user_id: str
    username: str
    email: Optional[str] = None
    roles: Set[Role] = field(default_factory=set)
    permissions: Set[Permission] = field(default_factory=set)
    tenant_id: Optional[str] = None
    metadata: dict = field(default_factory=dict)
    
    @classmethod
    def anonymous(cls) -> "AuthContext":
        """Create anonymous context with no permissions."""
        return cls(user_id="anonymous", username="anonymous")
    
    @classmethod
    def system(cls) -> "AuthContext":
        """Create system context with all permissions."""
        return cls(
            user_id="system",
            username="system",
            roles={Role.OWNER},
            permissions=set(Permission),
        )
    
    def has_permission(self, permission: Permission) -> bool:
        """Check if context has a specific permission."""
        # Direct permission
        if permission in self.permissions:
            return True
        
        # Permission via role
        for role in self.roles:
            if permission in ROLE_PERMISSIONS.get(role, set()):
                return True
        
        return False
    
    def has_any_permission(self, *permissions: Permission) -> bool:
        """Check if context has any of the permissions."""
        return any(self.has_permission(p) for p in permissions)
    
    def has_all_permissions(self, *permissions: Permission) -> bool:
        """Check if context has all permissions."""
        return all(self.has_permission(p) for p in permissions)
```

- [ ] **Step 2: Write tests**

```python
# test_permissions.py
import pytest
from graph_caster.auth.permissions import (
    Permission, Role, AuthContext, ROLE_PERMISSIONS
)

def test_viewer_permissions():
    ctx = AuthContext(
        user_id="u1",
        username="viewer",
        roles={Role.VIEWER},
    )
    
    assert ctx.has_permission(Permission.GRAPH_VIEW)
    assert not ctx.has_permission(Permission.GRAPH_EDIT)
    assert not ctx.has_permission(Permission.ADMIN_USERS)

def test_admin_permissions():
    ctx = AuthContext(
        user_id="u2",
        username="admin",
        roles={Role.ADMIN},
    )
    
    assert ctx.has_permission(Permission.GRAPH_VIEW)
    assert ctx.has_permission(Permission.GRAPH_EDIT)
    assert ctx.has_permission(Permission.ADMIN_USERS)

def test_direct_permissions():
    ctx = AuthContext(
        user_id="u3",
        username="special",
        permissions={Permission.SECRETS_MANAGE},
    )
    
    assert ctx.has_permission(Permission.SECRETS_MANAGE)
    assert not ctx.has_permission(Permission.GRAPH_VIEW)

def test_system_context():
    ctx = AuthContext.system()
    
    assert ctx.has_permission(Permission.ADMIN_SETTINGS)
    assert ctx.has_all_permissions(
        Permission.GRAPH_VIEW,
        Permission.ADMIN_USERS,
        Permission.SECRETS_MANAGE,
    )

def test_anonymous_context():
    ctx = AuthContext.anonymous()
    
    assert not ctx.has_permission(Permission.GRAPH_VIEW)
```

- [ ] **Step 3: Tests pass**

```bash
pytest python/tests/test_permissions.py -v
```

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/auth/
git commit -m "feat(auth): add permission model and auth context"
```

---

## Task 2: RBAC Hook Interface

**Files:**
- Create: `python/graph_caster/auth/rbac_hook.py`
- Test: `python/tests/test_rbac_hook.py`

- [ ] **Step 1: Define RBAC hook protocol**

```python
# rbac_hook.py
from typing import Protocol, Optional, List
from .permissions import AuthContext, Permission

class RBACHook(Protocol):
    """Interface for RBAC integration.
    
    Host applications implement this to provide authentication
    and authorization. GraphCaster core calls these hooks.
    
    Pattern: Similar to n8n's packages/cli/src/auth/auth.service.ts
    but as a pluggable interface.
    """
    
    async def authenticate(
        self,
        token: str,
        token_type: str = "bearer",
    ) -> Optional[AuthContext]:
        """Authenticate a token and return auth context.
        
        Args:
            token: The authentication token
            token_type: Type of token (bearer, api_key, basic)
        
        Returns:
            AuthContext if valid, None if invalid
        """
        ...
    
    async def authorize(
        self,
        context: AuthContext,
        permission: Permission,
        resource_type: str,
        resource_id: Optional[str] = None,
    ) -> bool:
        """Check if context is authorized for an action.
        
        Args:
            context: The auth context
            permission: Required permission
            resource_type: Type of resource (graph, run, workspace)
            resource_id: Specific resource ID (for object-level permissions)
        
        Returns:
            True if authorized, False otherwise
        """
        ...
    
    async def get_accessible_resources(
        self,
        context: AuthContext,
        resource_type: str,
        permission: Permission,
    ) -> List[str]:
        """Get IDs of resources the context can access.
        
        Args:
            context: The auth context
            resource_type: Type of resource
            permission: Required permission
        
        Returns:
            List of resource IDs
        """
        ...
    
    async def on_permission_denied(
        self,
        context: AuthContext,
        permission: Permission,
        resource_type: str,
        resource_id: Optional[str] = None,
    ) -> None:
        """Called when permission is denied. For logging/alerting."""
        ...


class DefaultRBACHook:
    """Default RBAC implementation - allows all authenticated users.
    
    This is a permissive default for development. Production deployments
    should provide a proper implementation.
    """
    
    async def authenticate(
        self,
        token: str,
        token_type: str = "bearer",
    ) -> Optional[AuthContext]:
        # Default: accept any non-empty token
        if not token:
            return None
        
        return AuthContext(
            user_id=f"user:{token[:8]}",
            username="authenticated_user",
        )
    
    async def authorize(
        self,
        context: AuthContext,
        permission: Permission,
        resource_type: str,
        resource_id: Optional[str] = None,
    ) -> bool:
        # Default: check context permissions
        return context.has_permission(permission)
    
    async def get_accessible_resources(
        self,
        context: AuthContext,
        resource_type: str,
        permission: Permission,
    ) -> List[str]:
        # Default: return empty (no filtering)
        return []
    
    async def on_permission_denied(
        self,
        context: AuthContext,
        permission: Permission,
        resource_type: str,
        resource_id: Optional[str] = None,
    ) -> None:
        # Default: no-op
        pass
```

- [ ] **Step 2: Write tests**

```python
# test_rbac_hook.py
import pytest
from graph_caster.auth.rbac_hook import DefaultRBACHook
from graph_caster.auth.permissions import Permission, AuthContext, Role

@pytest.mark.asyncio
async def test_default_authenticate():
    hook = DefaultRBACHook()
    
    ctx = await hook.authenticate("valid-token")
    assert ctx is not None
    assert ctx.user_id.startswith("user:")
    
    ctx = await hook.authenticate("")
    assert ctx is None

@pytest.mark.asyncio
async def test_default_authorize():
    hook = DefaultRBACHook()
    
    ctx = AuthContext(
        user_id="u1",
        username="test",
        roles={Role.EDITOR},
    )
    
    result = await hook.authorize(ctx, Permission.GRAPH_VIEW, "graph")
    assert result is True
    
    result = await hook.authorize(ctx, Permission.ADMIN_USERS, "user")
    assert result is False
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/auth/rbac_hook.py
git commit -m "feat(auth): add RBAC hook interface"
```

---

## Task 3: Audit Event Types

**Files:**
- Create: `python/graph_caster/audit/__init__.py`
- Create: `python/graph_caster/audit/events.py`
- Test: `python/tests/test_audit_events.py`

- [ ] **Step 1: Define audit events**

```python
# events.py
from dataclasses import dataclass, field
from typing import Any, Optional, Literal
from enum import Enum
import time
import uuid

class AuditAction(str, Enum):
    """Audit action types."""
    # Graph actions
    GRAPH_CREATE = "graph.create"
    GRAPH_UPDATE = "graph.update"
    GRAPH_DELETE = "graph.delete"
    GRAPH_VIEW = "graph.view"
    GRAPH_EXPORT = "graph.export"
    GRAPH_IMPORT = "graph.import"
    
    # Run actions
    RUN_START = "run.start"
    RUN_CANCEL = "run.cancel"
    RUN_COMPLETE = "run.complete"
    RUN_FAIL = "run.fail"
    RUN_VIEW = "run.view"
    
    # Auth actions
    AUTH_LOGIN = "auth.login"
    AUTH_LOGOUT = "auth.logout"
    AUTH_FAILED = "auth.failed"
    AUTH_TOKEN_REFRESH = "auth.token_refresh"
    
    # Admin actions
    ADMIN_USER_CREATE = "admin.user.create"
    ADMIN_USER_UPDATE = "admin.user.update"
    ADMIN_USER_DELETE = "admin.user.delete"
    ADMIN_ROLE_ASSIGN = "admin.role.assign"
    ADMIN_SETTINGS_UPDATE = "admin.settings.update"
    
    # Secrets actions
    SECRET_ACCESS = "secret.access"
    SECRET_CREATE = "secret.create"
    SECRET_UPDATE = "secret.update"
    SECRET_DELETE = "secret.delete"

class AuditSeverity(str, Enum):
    """Audit event severity levels."""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    CRITICAL = "critical"

@dataclass
class AuditEvent:
    """Audit event record.
    
    Pattern: Similar to enterprise audit logging systems.
    """
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: float = field(default_factory=time.time)
    
    # Actor
    user_id: str = ""
    username: str = ""
    tenant_id: Optional[str] = None
    ip_address: Optional[str] = None
    user_agent: Optional[str] = None
    
    # Action
    action: AuditAction = AuditAction.GRAPH_VIEW
    severity: AuditSeverity = AuditSeverity.INFO
    
    # Target
    resource_type: str = ""
    resource_id: Optional[str] = None
    resource_name: Optional[str] = None
    
    # Details
    details: dict[str, Any] = field(default_factory=dict)
    changes: Optional[dict[str, Any]] = None  # Before/after for updates
    
    # Result
    success: bool = True
    error_message: Optional[str] = None
    
    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "user_id": self.user_id,
            "username": self.username,
            "tenant_id": self.tenant_id,
            "ip_address": self.ip_address,
            "action": self.action.value,
            "severity": self.severity.value,
            "resource_type": self.resource_type,
            "resource_id": self.resource_id,
            "resource_name": self.resource_name,
            "details": self.details,
            "changes": self.changes,
            "success": self.success,
            "error_message": self.error_message,
        }
```

- [ ] **Step 2: Write tests**

```python
# test_audit_events.py
from graph_caster.audit.events import AuditEvent, AuditAction, AuditSeverity

def test_audit_event_creation():
    event = AuditEvent(
        user_id="u1",
        username="admin",
        action=AuditAction.GRAPH_CREATE,
        resource_type="graph",
        resource_id="g-123",
        resource_name="My Workflow",
    )
    
    assert event.action == AuditAction.GRAPH_CREATE
    assert event.success is True
    assert event.id is not None

def test_audit_event_to_dict():
    event = AuditEvent(
        user_id="u1",
        username="admin",
        action=AuditAction.AUTH_FAILED,
        severity=AuditSeverity.WARNING,
        success=False,
        error_message="Invalid credentials",
    )
    
    d = event.to_dict()
    assert d["action"] == "auth.failed"
    assert d["severity"] == "warning"
    assert d["success"] is False
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/audit/
git commit -m "feat(audit): add audit event types"
```

---

## Task 4: Audit Hook Interface

**Files:**
- Create: `python/graph_caster/audit/audit_hook.py`
- Test: `python/tests/test_audit_hook.py`

- [ ] **Step 1: Define audit hook protocol**

```python
# audit_hook.py
from typing import Protocol, Optional, List, Any
from datetime import datetime
from .events import AuditEvent, AuditAction

class AuditHook(Protocol):
    """Interface for audit logging integration.
    
    Host applications implement this to capture audit events.
    Events are sent asynchronously and should not block operations.
    """
    
    async def record(self, event: AuditEvent) -> None:
        """Record an audit event.
        
        Implementations should be fast and non-blocking.
        Consider buffering events for batch writes.
        """
        ...
    
    async def query(
        self,
        user_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        action: Optional[AuditAction] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[AuditEvent]:
        """Query audit events.
        
        Returns matching events sorted by timestamp descending.
        """
        ...
    
    async def flush(self) -> None:
        """Flush any buffered events.
        
        Called on graceful shutdown.
        """
        ...


class InMemoryAuditHook:
    """In-memory audit hook for development/testing.
    
    Not suitable for production - events are lost on restart.
    """
    
    def __init__(self, max_events: int = 10000):
        self.max_events = max_events
        self._events: List[AuditEvent] = []
    
    async def record(self, event: AuditEvent) -> None:
        self._events.append(event)
        
        # Trim old events
        if len(self._events) > self.max_events:
            self._events = self._events[-self.max_events:]
    
    async def query(
        self,
        user_id: Optional[str] = None,
        tenant_id: Optional[str] = None,
        action: Optional[AuditAction] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[AuditEvent]:
        filtered = self._events
        
        if user_id:
            filtered = [e for e in filtered if e.user_id == user_id]
        if tenant_id:
            filtered = [e for e in filtered if e.tenant_id == tenant_id]
        if action:
            filtered = [e for e in filtered if e.action == action]
        if resource_type:
            filtered = [e for e in filtered if e.resource_type == resource_type]
        if resource_id:
            filtered = [e for e in filtered if e.resource_id == resource_id]
        if start_time:
            ts = start_time.timestamp()
            filtered = [e for e in filtered if e.timestamp >= ts]
        if end_time:
            ts = end_time.timestamp()
            filtered = [e for e in filtered if e.timestamp <= ts]
        
        # Sort by timestamp descending
        filtered.sort(key=lambda e: e.timestamp, reverse=True)
        
        return filtered[offset:offset + limit]
    
    async def flush(self) -> None:
        pass  # No-op for in-memory
    
    def clear(self) -> None:
        """Clear all events (for testing)."""
        self._events.clear()
```

- [ ] **Step 2: Write tests**

```python
# test_audit_hook.py
import pytest
from datetime import datetime, timedelta
from graph_caster.audit.audit_hook import InMemoryAuditHook
from graph_caster.audit.events import AuditEvent, AuditAction

@pytest.mark.asyncio
async def test_record_and_query():
    hook = InMemoryAuditHook()
    
    event = AuditEvent(
        user_id="u1",
        username="admin",
        action=AuditAction.GRAPH_CREATE,
        resource_type="graph",
        resource_id="g-1",
    )
    
    await hook.record(event)
    
    results = await hook.query(user_id="u1")
    assert len(results) == 1
    assert results[0].action == AuditAction.GRAPH_CREATE

@pytest.mark.asyncio
async def test_query_filters():
    hook = InMemoryAuditHook()
    
    await hook.record(AuditEvent(
        user_id="u1", action=AuditAction.GRAPH_CREATE, resource_type="graph"
    ))
    await hook.record(AuditEvent(
        user_id="u2", action=AuditAction.RUN_START, resource_type="run"
    ))
    
    results = await hook.query(action=AuditAction.GRAPH_CREATE)
    assert len(results) == 1
    
    results = await hook.query(user_id="u2")
    assert len(results) == 1
    assert results[0].action == AuditAction.RUN_START

@pytest.mark.asyncio
async def test_max_events():
    hook = InMemoryAuditHook(max_events=10)
    
    for i in range(20):
        await hook.record(AuditEvent(user_id=f"u{i}"))
    
    results = await hook.query(limit=100)
    assert len(results) == 10
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/audit/audit_hook.py
git commit -m "feat(audit): add audit hook interface"
```

---

## Task 5: Audit Decorators

**Files:**
- Create: `python/graph_caster/audit/decorators.py`
- Test: `python/tests/test_audit_decorators.py`

- [ ] **Step 1: Implement audit decorators**

```python
# decorators.py
import functools
import traceback
from typing import Callable, Optional, Any
from .events import AuditEvent, AuditAction, AuditSeverity
from .audit_hook import AuditHook

# Global audit hook registry
_audit_hook: Optional[AuditHook] = None

def set_audit_hook(hook: AuditHook) -> None:
    """Set the global audit hook."""
    global _audit_hook
    _audit_hook = hook

def get_audit_hook() -> Optional[AuditHook]:
    """Get the global audit hook."""
    return _audit_hook

def audited(
    action: AuditAction,
    resource_type: str,
    get_resource_id: Optional[Callable[..., str]] = None,
    get_resource_name: Optional[Callable[..., str]] = None,
    severity: AuditSeverity = AuditSeverity.INFO,
):
    """Decorator to audit function calls.
    
    Example:
        @audited(
            action=AuditAction.GRAPH_CREATE,
            resource_type="graph",
            get_resource_id=lambda result, *args, **kwargs: result.id,
        )
        async def create_graph(name: str) -> Graph:
            ...
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            # Get auth context from kwargs or first arg
            auth_context = kwargs.get('auth_context') or (
                args[0] if args and hasattr(args[0], 'user_id') else None
            )
            
            event = AuditEvent(
                action=action,
                severity=severity,
                resource_type=resource_type,
                user_id=auth_context.user_id if auth_context else "",
                username=auth_context.username if auth_context else "",
                tenant_id=getattr(auth_context, 'tenant_id', None) if auth_context else None,
            )
            
            try:
                result = await func(*args, **kwargs)
                
                # Extract resource info from result
                if get_resource_id:
                    event.resource_id = get_resource_id(result, *args, **kwargs)
                if get_resource_name:
                    event.resource_name = get_resource_name(result, *args, **kwargs)
                
                event.success = True
                
            except Exception as e:
                event.success = False
                event.error_message = str(e)
                event.severity = AuditSeverity.ERROR
                event.details["traceback"] = traceback.format_exc()
                raise
                
            finally:
                # Record event
                hook = get_audit_hook()
                if hook:
                    await hook.record(event)
            
            return result
        
        return wrapper
    return decorator


def audit_changes(
    action: AuditAction,
    resource_type: str,
    resource_id_param: str = "resource_id",
):
    """Decorator to audit changes with before/after state.
    
    Example:
        @audit_changes(
            action=AuditAction.GRAPH_UPDATE,
            resource_type="graph",
            resource_id_param="graph_id",
        )
        async def update_graph(graph_id: str, updates: dict) -> Graph:
            ...
    """
    def decorator(func: Callable):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs):
            resource_id = kwargs.get(resource_id_param)
            
            # Get auth context
            auth_context = kwargs.get('auth_context')
            
            event = AuditEvent(
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                user_id=auth_context.user_id if auth_context else "",
                username=auth_context.username if auth_context else "",
            )
            
            # Capture before state if possible
            # This depends on the specific implementation
            
            try:
                result = await func(*args, **kwargs)
                event.success = True
                
                # Capture changes if result supports it
                if hasattr(result, '__dict__'):
                    event.changes = {"after": dict(result.__dict__)}
                    
            except Exception as e:
                event.success = False
                event.error_message = str(e)
                event.severity = AuditSeverity.ERROR
                raise
                
            finally:
                hook = get_audit_hook()
                if hook:
                    await hook.record(event)
            
            return result
        
        return wrapper
    return decorator
```

- [ ] **Step 2: Write tests**

```python
# test_audit_decorators.py
import pytest
from graph_caster.audit.decorators import audited, set_audit_hook, get_audit_hook
from graph_caster.audit.audit_hook import InMemoryAuditHook
from graph_caster.audit.events import AuditAction
from graph_caster.auth.permissions import AuthContext

@pytest.fixture
def audit_hook():
    hook = InMemoryAuditHook()
    set_audit_hook(hook)
    yield hook
    set_audit_hook(None)

@pytest.mark.asyncio
async def test_audited_decorator(audit_hook):
    @audited(
        action=AuditAction.GRAPH_CREATE,
        resource_type="graph",
        get_resource_id=lambda result, *args, **kwargs: result["id"],
    )
    async def create_graph(name: str, auth_context: AuthContext) -> dict:
        return {"id": "g-123", "name": name}
    
    ctx = AuthContext(user_id="u1", username="admin")
    result = await create_graph("Test", auth_context=ctx)
    
    events = await audit_hook.query()
    assert len(events) == 1
    assert events[0].action == AuditAction.GRAPH_CREATE
    assert events[0].resource_id == "g-123"
    assert events[0].success is True

@pytest.mark.asyncio
async def test_audited_captures_errors(audit_hook):
    @audited(action=AuditAction.GRAPH_DELETE, resource_type="graph")
    async def failing_delete(auth_context: AuthContext):
        raise ValueError("Not found")
    
    ctx = AuthContext(user_id="u1", username="admin")
    
    with pytest.raises(ValueError):
        await failing_delete(auth_context=ctx)
    
    events = await audit_hook.query()
    assert len(events) == 1
    assert events[0].success is False
    assert "Not found" in events[0].error_message
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/audit/decorators.py
git commit -m "feat(audit): add audit decorators for automatic logging"
```

---

## Task 6: Tenant Isolation

**Files:**
- Create: `python/graph_caster/tenant/__init__.py`
- Create: `python/graph_caster/tenant/context.py`
- Create: `python/graph_caster/tenant/isolation.py`
- Test: `python/tests/test_tenant_isolation.py`

- [ ] **Step 1: Define tenant context**

```python
# context.py
from dataclasses import dataclass, field
from typing import Optional, Any
from contextvars import ContextVar

@dataclass
class TenantContext:
    """Multi-tenant context."""
    tenant_id: str
    tenant_name: str
    settings: dict[str, Any] = field(default_factory=dict)
    limits: dict[str, int] = field(default_factory=dict)
    
    @property
    def workspace_prefix(self) -> str:
        """Prefix for tenant-specific paths."""
        return f"tenants/{self.tenant_id}"
    
    def get_limit(self, key: str, default: int = 0) -> int:
        """Get a tenant limit."""
        return self.limits.get(key, default)

# Context variable for current tenant
_current_tenant: ContextVar[Optional[TenantContext]] = ContextVar(
    "current_tenant", default=None
)

def get_current_tenant() -> Optional[TenantContext]:
    """Get the current tenant context."""
    return _current_tenant.get()

def set_current_tenant(tenant: Optional[TenantContext]) -> None:
    """Set the current tenant context."""
    _current_tenant.set(tenant)
```

- [ ] **Step 2: Implement tenant isolation**

```python
# isolation.py
from typing import Protocol, Optional, List
from pathlib import Path
from .context import TenantContext, get_current_tenant

class TenantIsolation(Protocol):
    """Interface for tenant isolation.
    
    Ensures data and resources are isolated between tenants.
    """
    
    def get_workspace_path(self, tenant: TenantContext, subpath: str = "") -> Path:
        """Get tenant-specific workspace path."""
        ...
    
    def get_secrets_path(self, tenant: TenantContext) -> Path:
        """Get tenant-specific secrets path."""
        ...
    
    def validate_access(
        self,
        tenant: TenantContext,
        resource_type: str,
        resource_id: str,
    ) -> bool:
        """Validate tenant can access resource."""
        ...


class FileSystemIsolation:
    """File system based tenant isolation.
    
    Each tenant gets a separate directory tree.
    """
    
    def __init__(self, base_path: Path):
        self.base_path = Path(base_path)
    
    def get_workspace_path(self, tenant: TenantContext, subpath: str = "") -> Path:
        path = self.base_path / tenant.workspace_prefix / subpath
        
        # Security: ensure path doesn't escape tenant directory
        resolved = path.resolve()
        tenant_root = (self.base_path / tenant.workspace_prefix).resolve()
        
        if not str(resolved).startswith(str(tenant_root)):
            raise ValueError(f"Path escape attempt: {subpath}")
        
        return path
    
    def get_secrets_path(self, tenant: TenantContext) -> Path:
        return self.get_workspace_path(tenant, "secrets")
    
    def validate_access(
        self,
        tenant: TenantContext,
        resource_type: str,
        resource_id: str,
    ) -> bool:
        # Check if resource belongs to tenant
        # This depends on how resources are stored
        # For file-based: check path prefix
        if resource_type == "graph":
            graph_path = self.get_workspace_path(tenant, f"graphs/{resource_id}.json")
            return graph_path.exists()
        
        return True
    
    def ensure_tenant_directories(self, tenant: TenantContext) -> None:
        """Create tenant directory structure."""
        dirs = [
            self.get_workspace_path(tenant, "graphs"),
            self.get_workspace_path(tenant, "runs"),
            self.get_secrets_path(tenant),
        ]
        
        for d in dirs:
            d.mkdir(parents=True, exist_ok=True)
```

- [ ] **Step 3: Write tests**

```python
# test_tenant_isolation.py
import pytest
from pathlib import Path
from graph_caster.tenant.context import TenantContext
from graph_caster.tenant.isolation import FileSystemIsolation

@pytest.fixture
def isolation(tmp_path):
    return FileSystemIsolation(tmp_path)

@pytest.fixture
def tenant():
    return TenantContext(
        tenant_id="tenant-123",
        tenant_name="Acme Corp",
    )

def test_workspace_path(isolation, tenant):
    path = isolation.get_workspace_path(tenant, "graphs")
    assert "tenant-123" in str(path)
    assert str(path).endswith("graphs")

def test_path_escape_prevention(isolation, tenant):
    with pytest.raises(ValueError, match="escape"):
        isolation.get_workspace_path(tenant, "../../../etc/passwd")

def test_ensure_directories(isolation, tenant):
    isolation.ensure_tenant_directories(tenant)
    
    graphs_path = isolation.get_workspace_path(tenant, "graphs")
    assert graphs_path.exists()
```

- [ ] **Step 4: Tests pass**

- [ ] **Step 5: Commit**

```bash
git add python/graph_caster/tenant/
git commit -m "feat(tenant): add multi-tenant isolation"
```

---

## Task 7: Enterprise Hook Registry

**Files:**
- Create: `python/graph_caster/enterprise/__init__.py`
- Create: `python/graph_caster/enterprise/hooks.py`

- [ ] **Step 1: Implement hook registry**

```python
# hooks.py
from typing import Optional
from dataclasses import dataclass
from graph_caster.auth.rbac_hook import RBACHook, DefaultRBACHook
from graph_caster.audit.audit_hook import AuditHook, InMemoryAuditHook
from graph_caster.tenant.isolation import TenantIsolation, FileSystemIsolation
from pathlib import Path

@dataclass
class EnterpriseHooks:
    """Registry for enterprise hooks.
    
    Provides a single point of configuration for enterprise features.
    """
    rbac: RBACHook
    audit: AuditHook
    tenant_isolation: Optional[TenantIsolation] = None
    
    @classmethod
    def default(cls, workspace_path: Path) -> "EnterpriseHooks":
        """Create default hooks for development."""
        return cls(
            rbac=DefaultRBACHook(),
            audit=InMemoryAuditHook(),
            tenant_isolation=FileSystemIsolation(workspace_path),
        )
    
    @classmethod
    def minimal(cls) -> "EnterpriseHooks":
        """Create minimal hooks (no tenant isolation)."""
        return cls(
            rbac=DefaultRBACHook(),
            audit=InMemoryAuditHook(),
        )

# Global hooks instance
_hooks: Optional[EnterpriseHooks] = None

def configure_enterprise(hooks: EnterpriseHooks) -> None:
    """Configure enterprise hooks globally."""
    global _hooks
    _hooks = hooks
    
    # Also set audit hook for decorators
    from graph_caster.audit.decorators import set_audit_hook
    set_audit_hook(hooks.audit)

def get_enterprise_hooks() -> Optional[EnterpriseHooks]:
    """Get configured enterprise hooks."""
    return _hooks

def require_enterprise_hooks() -> EnterpriseHooks:
    """Get enterprise hooks, raising if not configured."""
    if _hooks is None:
        raise RuntimeError("Enterprise hooks not configured")
    return _hooks
```

- [ ] **Step 2: Commit**

```bash
git add python/graph_caster/enterprise/
git commit -m "feat(enterprise): add hook registry"
```

---

## Task 8: Integration with Runner

**Files:**
- Modify: `python/graph_caster/runner/context.py`
- Create: `python/graph_caster/runner/auth_middleware.py`

- [ ] **Step 1: Add auth to runner context**

```python
# In context.py, add:

from graph_caster.auth.permissions import AuthContext
from graph_caster.tenant.context import TenantContext

@dataclass
class RunContext:
    # ... existing fields
    auth_context: Optional[AuthContext] = None
    tenant_context: Optional[TenantContext] = None
    
    def require_permission(self, permission: Permission) -> None:
        """Check permission, raising if denied."""
        if self.auth_context and not self.auth_context.has_permission(permission):
            raise PermissionError(f"Permission denied: {permission.name}")
```

- [ ] **Step 2: Create auth middleware**

```python
# auth_middleware.py
from fastapi import Request, HTTPException
from typing import Optional
from graph_caster.auth.permissions import AuthContext
from graph_caster.enterprise.hooks import get_enterprise_hooks

async def get_auth_context(request: Request) -> Optional[AuthContext]:
    """Extract auth context from request."""
    hooks = get_enterprise_hooks()
    if not hooks:
        return AuthContext.system()  # Default to system if not configured
    
    # Get token from header
    auth_header = request.headers.get("Authorization", "")
    if not auth_header:
        return None
    
    # Parse "Bearer <token>"
    parts = auth_header.split(" ", 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    
    token = parts[1]
    return await hooks.rbac.authenticate(token)

async def require_auth(request: Request) -> AuthContext:
    """Dependency that requires authentication."""
    context = await get_auth_context(request)
    if not context:
        raise HTTPException(status_code=401, detail="Authentication required")
    return context
```

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(runner): integrate auth context and middleware"
```

---

## Task 9: Documentation

**Files:**
- Create: `doc/ENTERPRISE.md`

- [ ] **Step 1: Document enterprise features**

```markdown
# GraphCaster Enterprise Features

## Overview

GraphCaster provides enterprise-grade features through a hook-based architecture. Host applications implement these hooks to integrate with their existing infrastructure.

## RBAC (Role-Based Access Control)

### Permissions

GraphCaster defines fine-grained permissions:

- **Graph**: `GRAPH_VIEW`, `GRAPH_CREATE`, `GRAPH_EDIT`, `GRAPH_DELETE`, `GRAPH_EXECUTE`
- **Run**: `RUN_VIEW`, `RUN_CREATE`, `RUN_CANCEL`, `RUN_VIEW_LOGS`
- **Admin**: `ADMIN_USERS`, `ADMIN_SETTINGS`, `ADMIN_AUDIT`
- **Secrets**: `SECRETS_VIEW`, `SECRETS_MANAGE`

### Built-in Roles

| Role | Permissions |
|------|-------------|
| Viewer | View graphs and runs |
| Editor | Create/edit/delete graphs |
| Executor | Execute graphs, manage runs |
| Admin | All except owner-only |
| Owner | All permissions |

### Implementing RBAC

```python
from graph_caster.auth.rbac_hook import RBACHook
from graph_caster.auth.permissions import AuthContext, Permission

class MyRBACHook(RBACHook):
    async def authenticate(self, token: str, token_type: str) -> AuthContext:
        # Validate token with your auth provider
        user = await my_auth_provider.validate(token)
        return AuthContext(
            user_id=user.id,
            username=user.name,
            roles=user.roles,
        )
    
    async def authorize(
        self,
        context: AuthContext,
        permission: Permission,
        resource_type: str,
        resource_id: str | None,
    ) -> bool:
        # Check permission
        return context.has_permission(permission)
```

## Audit Logging

### Event Types

- Authentication events (login, logout, failed)
- Graph operations (create, update, delete)
- Run operations (start, cancel, complete)
- Admin operations (user management, settings)

### Implementing Audit

```python
from graph_caster.audit.audit_hook import AuditHook
from graph_caster.audit.events import AuditEvent

class MyAuditHook(AuditHook):
    async def record(self, event: AuditEvent) -> None:
        # Send to your audit system
        await my_audit_service.log(event.to_dict())
    
    async def query(self, **filters) -> list[AuditEvent]:
        # Query your audit store
        return await my_audit_service.search(**filters)
```

## Multi-Tenancy

### Tenant Isolation

Each tenant gets isolated:
- Workspace directory
- Secrets storage
- Run history
- Resource access

### Configuration

```python
from graph_caster.enterprise.hooks import EnterpriseHooks, configure_enterprise
from graph_caster.tenant.isolation import FileSystemIsolation

hooks = EnterpriseHooks(
    rbac=MyRBACHook(),
    audit=MyAuditHook(),
    tenant_isolation=FileSystemIsolation(Path("/data/tenants")),
)

configure_enterprise(hooks)
```

## Configuration

### Environment Variables

| Variable | Description |
|----------|-------------|
| `GC_ENTERPRISE_RBAC` | RBAC hook module path |
| `GC_ENTERPRISE_AUDIT` | Audit hook module path |
| `GC_TENANT_ISOLATION` | Enable tenant isolation |
| `GC_TENANT_BASE_PATH` | Base path for tenant data |
```

- [ ] **Step 2: Commit**

```bash
git add doc/ENTERPRISE.md
git commit -m "docs: add enterprise features documentation"
```

---

## Success Criteria

- [ ] Permission model tests pass
- [ ] RBAC hook interface works
- [ ] Audit events recorded correctly
- [ ] Audit decorators capture operations
- [ ] Tenant isolation prevents path escape
- [ ] Hook registry configures all hooks
- [ ] Auth middleware extracts context
- [ ] Documentation complete

---

## Dependencies

No new external dependencies required. All enterprise features use standard library and existing GraphCaster modules.
