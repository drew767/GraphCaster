# Phase 2: Triggers & External API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable event-driven execution — webhook triggers, cron scheduling, and public REST API for external integrations.

**Architecture:** Pattern from n8n (trigger node execution) + Dify (typed trigger constants). Webhook routes register paths, scheduler uses APScheduler with Redis job store for persistence. Public API follows REST conventions with API key auth.

**Tech Stack:** Python 3.11+, FastAPI, APScheduler, Redis (optional persistence), existing graph runner

---

## File Structure

```
python/graph_caster/
├── triggers/
│   ├── __init__.py
│   ├── base.py           # Trigger interface
│   ├── webhook.py         # Webhook trigger handler
│   └── scheduler.py       # Cron scheduler (APScheduler)
├── nodes/
│   ├── trigger_webhook.py
│   └── trigger_schedule.py
├── run_broker/
│   └── routes/
│       ├── webhook_trigger.py  # HTTP POST endpoint
│       └── api_v1.py           # Public REST API
└── auth/
    └── api_key.py              # API key authentication
```

---

## Task 1: Trigger Base Interface

**Files:**
- Create: `python/graph_caster/triggers/__init__.py`
- Create: `python/graph_caster/triggers/base.py`
- Test: `python/tests/test_trigger_base.py`

- [ ] **Step 1: Define trigger interface**

```python
# base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Literal
from enum import Enum

class TriggerType(str, Enum):
    """Trigger types aligned with Dify's trigger/constants.py"""
    WEBHOOK = "webhook"
    SCHEDULE = "schedule"
    MANUAL = "manual"
    API = "api"

@dataclass
class TriggerContext:
    """Context passed to graph execution from trigger."""
    trigger_type: TriggerType
    trigger_id: str
    payload: dict[str, Any] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    timestamp: float = 0.0
    
    def to_context_vars(self) -> dict[str, Any]:
        """Convert to variables accessible in graph as $trigger."""
        return {
            "trigger": {
                "type": self.trigger_type.value,
                "id": self.trigger_id,
                "payload": self.payload,
                "headers": self.headers,
                "timestamp": self.timestamp,
            }
        }

class Trigger(ABC):
    """Abstract trigger interface."""
    
    @property
    @abstractmethod
    def trigger_type(self) -> TriggerType:
        pass
    
    @abstractmethod
    async def setup(self, graph_id: str, config: dict) -> None:
        """Set up trigger for a graph."""
        pass
    
    @abstractmethod
    async def teardown(self, graph_id: str) -> None:
        """Remove trigger for a graph."""
        pass
```

- [ ] **Step 2: Write simple import test**

```python
# test_trigger_base.py
from graph_caster.triggers import TriggerType, TriggerContext

def test_trigger_context_to_vars():
    ctx = TriggerContext(
        trigger_type=TriggerType.WEBHOOK,
        trigger_id="wh-123",
        payload={"foo": "bar"},
        timestamp=1234567890.0
    )
    vars = ctx.to_context_vars()
    
    assert vars["trigger"]["type"] == "webhook"
    assert vars["trigger"]["payload"]["foo"] == "bar"
```

- [ ] **Step 3: Run test**

```bash
pytest python/tests/test_trigger_base.py -v
```

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/triggers/
git commit -m "feat(triggers): add base trigger interface"
```

---

## Task 2: Webhook Trigger Node

**Files:**
- Create: `python/graph_caster/nodes/trigger_webhook.py`
- Modify: `schemas/graph-document.schema.json`
- Test: `python/tests/test_trigger_webhook_node.py`

- [ ] **Step 1: Write failing test**

```python
# test_trigger_webhook_node.py
import pytest
from graph_caster.nodes.trigger_webhook import TriggerWebhookNode
from graph_caster.runner.context import RunContext

@pytest.mark.asyncio
async def test_webhook_node_extracts_payload():
    node = TriggerWebhookNode(
        id="webhook-1",
        config={
            "path": "/api/webhook/my-hook",
            "method": "POST",
            "auth": "none"
        }
    )
    
    ctx = RunContext(
        run_id="run-1",
        graph_id="graph-1",
        trigger_context={
            "type": "webhook",
            "payload": {"event": "user.created", "data": {"id": "u-123"}},
            "headers": {"x-webhook-id": "wh-1"}
        }
    )
    
    result = await node.execute(ctx)
    
    assert result["payload"]["event"] == "user.created"
    assert result["headers"]["x-webhook-id"] == "wh-1"

@pytest.mark.asyncio
async def test_webhook_node_validates_path():
    node = TriggerWebhookNode(
        id="webhook-1",
        config={"path": "", "method": "POST"}  # Invalid: empty path
    )
    
    with pytest.raises(ValueError, match="path"):
        node.validate()
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest python/tests/test_trigger_webhook_node.py -v
```

- [ ] **Step 3: Implement TriggerWebhookNode**

```python
# trigger_webhook.py
from dataclasses import dataclass
from typing import Any, Literal
from graph_caster.nodes.base import Node, NodeResult

@dataclass
class WebhookNodeConfig:
    path: str
    method: Literal["GET", "POST", "PUT", "DELETE"] = "POST"
    auth: Literal["none", "basic", "bearer", "api_key"] = "none"
    secret: str | None = None
    response_mode: Literal["immediate", "wait"] = "immediate"

class TriggerWebhookNode(Node):
    """Webhook trigger node — graph entry point for HTTP webhooks.
    
    Pattern: Similar to n8n's Webhook node and Dify's HTTP trigger.
    
    The node doesn't "execute" in the traditional sense — it extracts
    the webhook payload from TriggerContext and makes it available
    to downstream nodes.
    """
    
    node_type = "trigger_webhook"
    
    def __init__(self, id: str, config: dict):
        super().__init__(id)
        self.config = WebhookNodeConfig(**config)
    
    def validate(self) -> None:
        if not self.config.path or not self.config.path.startswith("/"):
            raise ValueError(f"Webhook path must start with '/': {self.config.path}")
        if self.config.auth in ("basic", "bearer", "api_key") and not self.config.secret:
            raise ValueError(f"Auth mode '{self.config.auth}' requires secret")
    
    async def execute(self, ctx: 'RunContext') -> NodeResult:
        """Extract webhook payload from trigger context."""
        trigger = ctx.trigger_context or {}
        
        if trigger.get("type") != "webhook":
            raise RuntimeError(
                f"TriggerWebhookNode expects webhook trigger, got: {trigger.get('type')}"
            )
        
        return {
            "payload": trigger.get("payload", {}),
            "headers": trigger.get("headers", {}),
            "method": trigger.get("method", self.config.method),
            "path": self.config.path,
            "query": trigger.get("query", {}),
        }
```

- [ ] **Step 4: Add to schema**

```json
// In graph-document.schema.json, add to node types:
{
  "type": "trigger_webhook",
  "properties": {
    "path": { "type": "string", "pattern": "^/" },
    "method": { "enum": ["GET", "POST", "PUT", "DELETE"], "default": "POST" },
    "auth": { "enum": ["none", "basic", "bearer", "api_key"], "default": "none" },
    "secret": { "type": "string" },
    "responseMode": { "enum": ["immediate", "wait"], "default": "immediate" }
  },
  "required": ["path"]
}
```

- [ ] **Step 5: Tests pass**

```bash
pytest python/tests/test_trigger_webhook_node.py -v
```

- [ ] **Step 6: Commit**

```bash
git add python/graph_caster/nodes/trigger_webhook.py schemas/ python/tests/
git commit -m "feat(nodes): add trigger_webhook node type"
```

---

## Task 3: Webhook HTTP Route

**Files:**
- Create: `python/graph_caster/run_broker/routes/webhook_trigger.py`
- Modify: `python/graph_caster/run_broker/app.py`
- Test: `python/tests/test_webhook_route.py`

- [ ] **Step 1: Write integration test**

```python
# test_webhook_route.py
import pytest
from httpx import AsyncClient
from graph_caster.run_broker.app import create_app

@pytest.fixture
async def client():
    app = create_app()
    async with AsyncClient(app=app, base_url="http://test") as c:
        yield c

@pytest.mark.asyncio
async def test_webhook_trigger_starts_run(client, tmp_path):
    # Create a simple test graph
    graph_path = tmp_path / "graphs" / "webhook-test.json"
    graph_path.parent.mkdir(parents=True)
    graph_path.write_text('''{
        "id": "webhook-test",
        "name": "Webhook Test",
        "nodes": [
            {
                "id": "webhook-1",
                "type": "trigger_webhook",
                "config": {"path": "/hooks/test"}
            },
            {
                "id": "log-1",
                "type": "task",
                "config": {"code": "print($trigger.payload)"}
            }
        ],
        "edges": [{"from": "webhook-1", "to": "log-1"}]
    }''')
    
    # Trigger webhook
    response = await client.post(
        "/hooks/test",
        json={"event": "test.event", "data": {"key": "value"}},
        headers={"X-Webhook-Secret": "test-secret"}
    )
    
    assert response.status_code == 202
    data = response.json()
    assert "runId" in data
    assert data["status"] == "queued"

@pytest.mark.asyncio
async def test_webhook_unknown_path_returns_404(client):
    response = await client.post("/hooks/nonexistent", json={})
    assert response.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest python/tests/test_webhook_route.py -v
```

- [ ] **Step 3: Implement webhook route**

```python
# webhook_trigger.py
import time
from fastapi import APIRouter, Request, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from typing import Any
from graph_caster.triggers import TriggerContext, TriggerType
from graph_caster.workspace import Workspace
from graph_caster.runner import run_graph

router = APIRouter(prefix="/hooks", tags=["webhooks"])

# Registry: path -> graph_id mapping
# In production, this would be stored in Redis/DB
_webhook_registry: dict[str, str] = {}

def register_webhook(path: str, graph_id: str) -> None:
    """Register a webhook path to a graph."""
    _webhook_registry[path] = graph_id

def unregister_webhook(path: str) -> None:
    """Unregister a webhook path."""
    _webhook_registry.pop(path, None)

@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE"])
async def handle_webhook(
    path: str,
    request: Request,
    background_tasks: BackgroundTasks,
):
    """Handle incoming webhook and trigger graph execution."""
    full_path = f"/hooks/{path}"
    
    # Find registered graph
    graph_id = _webhook_registry.get(full_path)
    if not graph_id:
        raise HTTPException(status_code=404, detail=f"No webhook registered for {full_path}")
    
    # Build trigger context
    try:
        if request.method in ("POST", "PUT"):
            payload = await request.json()
        else:
            payload = dict(request.query_params)
    except Exception:
        payload = {}
    
    trigger_ctx = TriggerContext(
        trigger_type=TriggerType.WEBHOOK,
        trigger_id=f"webhook:{full_path}",
        payload=payload,
        headers=dict(request.headers),
        timestamp=time.time(),
    )
    
    # Start run in background
    workspace = Workspace.current()
    run_id = workspace.generate_run_id()
    
    background_tasks.add_task(
        _execute_webhook_run,
        workspace=workspace,
        graph_id=graph_id,
        run_id=run_id,
        trigger_ctx=trigger_ctx,
    )
    
    return JSONResponse(
        status_code=202,
        content={
            "runId": run_id,
            "graphId": graph_id,
            "status": "queued",
        }
    )

async def _execute_webhook_run(
    workspace: 'Workspace',
    graph_id: str,
    run_id: str,
    trigger_ctx: TriggerContext,
) -> None:
    """Execute graph run in background."""
    graph = workspace.load_graph(graph_id)
    context_vars = trigger_ctx.to_context_vars()
    
    await run_graph(
        graph=graph,
        run_id=run_id,
        context_vars=context_vars,
        workspace=workspace,
    )
```

- [ ] **Step 4: Add route to app.py**

```python
# In app.py
from .routes.webhook_trigger import router as webhook_router

app.include_router(webhook_router)
```

- [ ] **Step 5: Tests pass**

```bash
pytest python/tests/test_webhook_route.py -v
```

- [ ] **Step 6: Commit**

```bash
git add python/graph_caster/run_broker/routes/webhook_trigger.py python/graph_caster/run_broker/app.py
git commit -m "feat(api): add webhook trigger HTTP endpoint"
```

---

## Task 4: Cron Scheduler Service

**Files:**
- Create: `python/graph_caster/triggers/scheduler.py`
- Test: `python/tests/test_scheduler.py`

- [ ] **Step 1: Write failing test**

```python
# test_scheduler.py
import pytest
import asyncio
from graph_caster.triggers.scheduler import GraphCronScheduler

@pytest.mark.asyncio
async def test_scheduler_adds_job():
    runs_started = []
    
    async def mock_run_graph(graph_id: str, trigger_id: str):
        runs_started.append((graph_id, trigger_id))
    
    scheduler = GraphCronScheduler(run_callback=mock_run_graph)
    await scheduler.start()
    
    # Add job that runs every second
    job_id = await scheduler.add_schedule(
        graph_id="test-graph",
        cron_expression="* * * * * *",  # Every second
        schedule_id="sched-1"
    )
    
    assert job_id == "sched-1"
    
    # Wait for at least one execution
    await asyncio.sleep(1.5)
    
    assert len(runs_started) >= 1
    assert runs_started[0][0] == "test-graph"
    
    await scheduler.remove_schedule("sched-1")
    await scheduler.stop()

@pytest.mark.asyncio
async def test_scheduler_removes_job():
    runs = []
    
    async def mock_run(graph_id: str, trigger_id: str):
        runs.append(1)
    
    scheduler = GraphCronScheduler(run_callback=mock_run)
    await scheduler.start()
    
    await scheduler.add_schedule(
        graph_id="test",
        cron_expression="* * * * * *",
        schedule_id="s-1"
    )
    
    await asyncio.sleep(0.5)
    await scheduler.remove_schedule("s-1")
    
    count_at_remove = len(runs)
    await asyncio.sleep(0.5)
    
    # No more runs after removal
    assert len(runs) == count_at_remove
    
    await scheduler.stop()
```

- [ ] **Step 2: Run to verify failure**

```bash
pytest python/tests/test_scheduler.py -v
```

- [ ] **Step 3: Implement GraphCronScheduler**

```python
# scheduler.py
import asyncio
from typing import Callable, Awaitable
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.jobstores.memory import MemoryJobStore
from dataclasses import dataclass

@dataclass
class ScheduleConfig:
    graph_id: str
    cron_expression: str
    schedule_id: str
    timezone: str = "UTC"
    enabled: bool = True

RunCallback = Callable[[str, str], Awaitable[None]]

class GraphCronScheduler:
    """Cron scheduler for graph execution.
    
    Pattern inspired by:
    - n8n: packages/cli/src/services/orchestration/main.service.ts (trigger timing)
    - Dify: api/core/trigger/constants.py (SCHEDULE trigger type)
    
    Uses APScheduler with asyncio support.
    """
    
    def __init__(
        self,
        run_callback: RunCallback,
        jobstore: str | None = None,  # Redis URL or None for memory
    ):
        self._run_callback = run_callback
        self._scheduler: AsyncIOScheduler | None = None
        self._schedules: dict[str, ScheduleConfig] = {}
        
        # Configure jobstore
        jobstores = {"default": MemoryJobStore()}
        if jobstore and jobstore.startswith("redis://"):
            try:
                from apscheduler.jobstores.redis import RedisJobStore
                jobstores["default"] = RedisJobStore.from_url(jobstore)
            except ImportError:
                pass  # Fallback to memory
        
        self._jobstores = jobstores
    
    async def start(self) -> None:
        """Start the scheduler."""
        self._scheduler = AsyncIOScheduler(jobstores=self._jobstores)
        self._scheduler.start()
    
    async def stop(self) -> None:
        """Stop the scheduler."""
        if self._scheduler:
            self._scheduler.shutdown(wait=False)
            self._scheduler = None
    
    async def add_schedule(
        self,
        graph_id: str,
        cron_expression: str,
        schedule_id: str,
        timezone: str = "UTC",
    ) -> str:
        """Add a cron schedule for a graph."""
        if not self._scheduler:
            raise RuntimeError("Scheduler not started")
        
        config = ScheduleConfig(
            graph_id=graph_id,
            cron_expression=cron_expression,
            schedule_id=schedule_id,
            timezone=timezone,
        )
        
        # Parse cron expression (APScheduler uses 6-field with seconds)
        trigger = CronTrigger.from_crontab(cron_expression, timezone=timezone)
        
        self._scheduler.add_job(
            self._trigger_run,
            trigger=trigger,
            id=schedule_id,
            args=[graph_id, schedule_id],
            replace_existing=True,
        )
        
        self._schedules[schedule_id] = config
        return schedule_id
    
    async def remove_schedule(self, schedule_id: str) -> bool:
        """Remove a schedule."""
        if not self._scheduler:
            return False
        
        try:
            self._scheduler.remove_job(schedule_id)
            self._schedules.pop(schedule_id, None)
            return True
        except Exception:
            return False
    
    async def list_schedules(self) -> list[ScheduleConfig]:
        """List all active schedules."""
        return list(self._schedules.values())
    
    async def _trigger_run(self, graph_id: str, schedule_id: str) -> None:
        """Called by APScheduler when schedule fires."""
        try:
            await self._run_callback(graph_id, schedule_id)
        except Exception as e:
            # Log error but don't crash scheduler
            import logging
            logging.error(f"Scheduled run failed: {graph_id} / {schedule_id}: {e}")
```

- [ ] **Step 4: Tests pass**

```bash
pytest python/tests/test_scheduler.py -v
```

- [ ] **Step 5: Commit**

```bash
git add python/graph_caster/triggers/scheduler.py python/tests/test_scheduler.py
git commit -m "feat(triggers): add cron scheduler with APScheduler"
```

---

## Task 5: Schedule Trigger Node

**Files:**
- Create: `python/graph_caster/nodes/trigger_schedule.py`
- Modify: `schemas/graph-document.schema.json`
- Test: `python/tests/test_trigger_schedule_node.py`

- [ ] **Step 1: Write failing test**

```python
# test_trigger_schedule_node.py
import pytest
from graph_caster.nodes.trigger_schedule import TriggerScheduleNode

def test_schedule_node_validates_cron():
    node = TriggerScheduleNode(
        id="sched-1",
        config={"cron": "0 9 * * *", "timezone": "America/New_York"}
    )
    node.validate()  # Should not raise

def test_schedule_node_rejects_invalid_cron():
    node = TriggerScheduleNode(
        id="sched-1",
        config={"cron": "invalid cron", "timezone": "UTC"}
    )
    with pytest.raises(ValueError, match="cron"):
        node.validate()

@pytest.mark.asyncio
async def test_schedule_node_returns_trigger_info():
    node = TriggerScheduleNode(
        id="sched-1",
        config={"cron": "0 9 * * *", "timezone": "UTC"}
    )
    
    from graph_caster.runner.context import RunContext
    ctx = RunContext(
        run_id="run-1",
        graph_id="graph-1",
        trigger_context={
            "type": "schedule",
            "schedule_id": "sched-1",
            "scheduled_time": "2026-03-31T09:00:00Z",
        }
    )
    
    result = await node.execute(ctx)
    
    assert result["cron"] == "0 9 * * *"
    assert result["scheduled_time"] == "2026-03-31T09:00:00Z"
```

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Implement TriggerScheduleNode**

```python
# trigger_schedule.py
from dataclasses import dataclass
from typing import Any
from croniter import croniter
from graph_caster.nodes.base import Node, NodeResult

@dataclass
class ScheduleNodeConfig:
    cron: str
    timezone: str = "UTC"
    enabled: bool = True

class TriggerScheduleNode(Node):
    """Schedule trigger node — graph entry point for cron-based execution.
    
    Pattern: Similar to n8n's Schedule Trigger node.
    """
    
    node_type = "trigger_schedule"
    
    def __init__(self, id: str, config: dict):
        super().__init__(id)
        self.config = ScheduleNodeConfig(**config)
    
    def validate(self) -> None:
        try:
            croniter(self.config.cron)
        except (ValueError, KeyError) as e:
            raise ValueError(f"Invalid cron expression '{self.config.cron}': {e}")
    
    async def execute(self, ctx: 'RunContext') -> NodeResult:
        trigger = ctx.trigger_context or {}
        
        if trigger.get("type") != "schedule":
            raise RuntimeError(
                f"TriggerScheduleNode expects schedule trigger, got: {trigger.get('type')}"
            )
        
        return {
            "cron": self.config.cron,
            "timezone": self.config.timezone,
            "schedule_id": trigger.get("schedule_id"),
            "scheduled_time": trigger.get("scheduled_time"),
            "actual_time": trigger.get("actual_time"),
        }
```

- [ ] **Step 4: Update schema**

```json
{
  "type": "trigger_schedule",
  "properties": {
    "cron": { "type": "string" },
    "timezone": { "type": "string", "default": "UTC" },
    "enabled": { "type": "boolean", "default": true }
  },
  "required": ["cron"]
}
```

- [ ] **Step 5: Tests pass**

- [ ] **Step 6: Commit**

```bash
git add python/graph_caster/nodes/trigger_schedule.py schemas/
git commit -m "feat(nodes): add trigger_schedule node type"
```

---

## Task 6: Public REST API v1

**Files:**
- Create: `python/graph_caster/run_broker/routes/api_v1.py`
- Create: `python/graph_caster/auth/api_key.py`
- Test: `python/tests/test_api_v1.py`

- [ ] **Step 1: Write failing tests**

```python
# test_api_v1.py
import pytest
from httpx import AsyncClient
from graph_caster.run_broker.app import create_app

@pytest.fixture
async def client():
    app = create_app()
    async with AsyncClient(app=app, base_url="http://test") as c:
        yield c

@pytest.mark.asyncio
async def test_api_requires_auth(client):
    response = await client.post("/api/v1/runs", json={"graphId": "test"})
    assert response.status_code == 401

@pytest.mark.asyncio
async def test_api_start_run(client, tmp_path, monkeypatch):
    # Set API key
    monkeypatch.setenv("GC_API_KEY", "test-api-key")
    
    response = await client.post(
        "/api/v1/runs",
        json={"graphId": "test-graph", "inputs": {"x": 1}},
        headers={"Authorization": "Bearer test-api-key"}
    )
    
    assert response.status_code == 201
    data = response.json()
    assert "runId" in data

@pytest.mark.asyncio
async def test_api_get_run_status(client, monkeypatch):
    monkeypatch.setenv("GC_API_KEY", "test-api-key")
    
    # First, start a run
    start_resp = await client.post(
        "/api/v1/runs",
        json={"graphId": "test-graph"},
        headers={"Authorization": "Bearer test-api-key"}
    )
    run_id = start_resp.json()["runId"]
    
    # Get status
    response = await client.get(
        f"/api/v1/runs/{run_id}",
        headers={"Authorization": "Bearer test-api-key"}
    )
    
    assert response.status_code == 200
    data = response.json()
    assert data["runId"] == run_id
    assert "status" in data

@pytest.mark.asyncio
async def test_api_cancel_run(client, monkeypatch):
    monkeypatch.setenv("GC_API_KEY", "test-api-key")
    
    start_resp = await client.post(
        "/api/v1/runs",
        json={"graphId": "test-graph"},
        headers={"Authorization": "Bearer test-api-key"}
    )
    run_id = start_resp.json()["runId"]
    
    response = await client.post(
        f"/api/v1/runs/{run_id}/cancel",
        headers={"Authorization": "Bearer test-api-key"}
    )
    
    assert response.status_code in (200, 202)
```

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Implement API key auth**

```python
# api_key.py
import os
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

security = HTTPBearer(auto_error=False)

async def verify_api_key(
    credentials: HTTPAuthorizationCredentials | None = Security(security)
) -> str:
    """Verify API key from Authorization header.
    
    Returns the authenticated key identifier.
    """
    expected_key = os.environ.get("GC_API_KEY")
    
    if not expected_key:
        raise HTTPException(
            status_code=500,
            detail="API key not configured (set GC_API_KEY)"
        )
    
    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="Missing Authorization header"
        )
    
    if credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication scheme"
        )
    
    if credentials.credentials != expected_key:
        raise HTTPException(
            status_code=401,
            detail="Invalid API key"
        )
    
    return "api-client"  # Could return different identifiers for multiple keys
```

- [ ] **Step 4: Implement API routes**

```python
# api_v1.py
import time
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Any
from graph_caster.auth.api_key import verify_api_key
from graph_caster.workspace import Workspace
from graph_caster.triggers import TriggerContext, TriggerType
from graph_caster.runner import run_graph

router = APIRouter(prefix="/api/v1", tags=["api"])

class StartRunRequest(BaseModel):
    graphId: str
    inputs: dict[str, Any] = {}
    webhookUrl: str | None = None  # Optional callback URL

class RunStatusResponse(BaseModel):
    runId: str
    graphId: str
    status: str  # "pending", "running", "completed", "failed", "cancelled"
    startedAt: float | None = None
    finishedAt: float | None = None
    outputs: dict[str, Any] | None = None
    error: str | None = None

@router.post("/runs", status_code=201)
async def start_run(
    request: StartRunRequest,
    background_tasks: BackgroundTasks,
    api_client: str = Depends(verify_api_key),
):
    """Start a new graph run via API."""
    workspace = Workspace.current()
    
    # Verify graph exists
    try:
        graph = workspace.load_graph(request.graphId)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Graph not found: {request.graphId}")
    
    run_id = workspace.generate_run_id()
    
    trigger_ctx = TriggerContext(
        trigger_type=TriggerType.API,
        trigger_id=f"api:{api_client}",
        payload=request.inputs,
        timestamp=time.time(),
    )
    
    background_tasks.add_task(
        _execute_api_run,
        workspace=workspace,
        graph_id=request.graphId,
        run_id=run_id,
        trigger_ctx=trigger_ctx,
        webhook_url=request.webhookUrl,
    )
    
    return {
        "runId": run_id,
        "graphId": request.graphId,
        "status": "pending",
    }

@router.get("/runs/{run_id}")
async def get_run_status(
    run_id: str,
    api_client: str = Depends(verify_api_key),
) -> RunStatusResponse:
    """Get status of a run."""
    workspace = Workspace.current()
    
    try:
        summary = workspace.load_run_summary(run_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Run not found: {run_id}")
    
    return RunStatusResponse(
        runId=run_id,
        graphId=summary.get("graphId", ""),
        status=summary.get("status", "unknown"),
        startedAt=summary.get("startedAt"),
        finishedAt=summary.get("finishedAt"),
        outputs=summary.get("outputs"),
        error=summary.get("error"),
    )

@router.post("/runs/{run_id}/cancel")
async def cancel_run(
    run_id: str,
    api_client: str = Depends(verify_api_key),
):
    """Cancel a running graph."""
    workspace = Workspace.current()
    
    # Send cancellation signal
    cancelled = await workspace.cancel_run(run_id)
    
    if not cancelled:
        raise HTTPException(status_code=404, detail=f"Run not found or already finished: {run_id}")
    
    return {"runId": run_id, "status": "cancelling"}

@router.get("/graphs")
async def list_graphs(
    api_client: str = Depends(verify_api_key),
):
    """List available graphs."""
    workspace = Workspace.current()
    graphs = workspace.list_graphs()
    
    return {
        "graphs": [
            {"id": g.id, "name": g.name, "description": g.description}
            for g in graphs
        ]
    }

async def _execute_api_run(
    workspace: 'Workspace',
    graph_id: str,
    run_id: str,
    trigger_ctx: TriggerContext,
    webhook_url: str | None,
) -> None:
    """Execute graph and optionally call webhook on completion."""
    graph = workspace.load_graph(graph_id)
    context_vars = trigger_ctx.to_context_vars()
    
    result = await run_graph(
        graph=graph,
        run_id=run_id,
        context_vars=context_vars,
        workspace=workspace,
    )
    
    # Call webhook if configured
    if webhook_url:
        import httpx
        async with httpx.AsyncClient() as client:
            try:
                await client.post(webhook_url, json={
                    "runId": run_id,
                    "graphId": graph_id,
                    "status": result.status,
                    "outputs": result.outputs,
                })
            except Exception:
                pass  # Log but don't fail
```

- [ ] **Step 5: Add to app.py**

```python
from .routes.api_v1 import router as api_v1_router
app.include_router(api_v1_router)
```

- [ ] **Step 6: Tests pass**

- [ ] **Step 7: Commit**

```bash
git add python/graph_caster/run_broker/routes/api_v1.py python/graph_caster/auth/
git commit -m "feat(api): add public REST API v1 with API key auth"
```

---

## Task 7: Scheduler Integration with App

**Files:**
- Modify: `python/graph_caster/run_broker/app.py`
- Test: `python/tests/test_app_scheduler.py`

- [ ] **Step 1: Add scheduler lifecycle to app**

```python
# In app.py, add startup/shutdown events

from contextlib import asynccontextmanager
from graph_caster.triggers.scheduler import GraphCronScheduler

_scheduler: GraphCronScheduler | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _scheduler
    
    # Start scheduler
    async def run_scheduled_graph(graph_id: str, schedule_id: str):
        workspace = Workspace.current()
        run_id = workspace.generate_run_id()
        trigger_ctx = TriggerContext(
            trigger_type=TriggerType.SCHEDULE,
            trigger_id=schedule_id,
            timestamp=time.time(),
        )
        graph = workspace.load_graph(graph_id)
        await run_graph(graph, run_id, trigger_ctx.to_context_vars(), workspace)
    
    _scheduler = GraphCronScheduler(run_callback=run_scheduled_graph)
    await _scheduler.start()
    
    # Load existing schedules from workspace
    # (graphs with trigger_schedule nodes)
    workspace = Workspace.current()
    for graph in workspace.list_graphs():
        for node in graph.nodes:
            if node.type == "trigger_schedule" and node.config.get("enabled", True):
                await _scheduler.add_schedule(
                    graph_id=graph.id,
                    cron_expression=node.config["cron"],
                    schedule_id=f"{graph.id}:{node.id}",
                    timezone=node.config.get("timezone", "UTC"),
                )
    
    yield
    
    # Shutdown
    if _scheduler:
        await _scheduler.stop()
```

- [ ] **Step 2: Tests pass**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(app): integrate scheduler lifecycle with FastAPI app"
```

---

## Task 8: Documentation

**Files:**
- Modify: `doc/PRODUCT_DESIGNE.md`
- Create: `doc/API_REFERENCE.md`

- [ ] **Step 1: Document trigger nodes**

Add to PRODUCT_DESIGNE.md:

```markdown
### Trigger Nodes

#### trigger_webhook

Entry point for HTTP webhook-triggered graphs.

**Config:**
- `path`: string (required) — URL path for the webhook
- `method`: "GET" | "POST" | "PUT" | "DELETE" (default: "POST")
- `auth`: "none" | "basic" | "bearer" | "api_key" (default: "none")
- `secret`: string — Secret for auth validation
- `responseMode`: "immediate" | "wait" (default: "immediate")

**Output:**
- `payload`: object — Request body
- `headers`: object — Request headers
- `query`: object — Query parameters

#### trigger_schedule

Entry point for cron-scheduled graphs.

**Config:**
- `cron`: string (required) — Cron expression (5 or 6 fields)
- `timezone`: string (default: "UTC") — IANA timezone
- `enabled`: boolean (default: true)

**Output:**
- `scheduled_time`: string — ISO timestamp when run was scheduled
- `actual_time`: string — ISO timestamp when run actually started
```

- [ ] **Step 2: Create API reference**

```markdown
# GraphCaster Public API Reference

## Authentication

All API endpoints require Bearer token authentication:

```
Authorization: Bearer YOUR_API_KEY
```

Set the API key via `GC_API_KEY` environment variable.

## Endpoints

### POST /api/v1/runs

Start a new graph run.

**Request:**
```json
{
  "graphId": "my-graph",
  "inputs": {"key": "value"},
  "webhookUrl": "https://example.com/callback"  // optional
}
```

**Response (201):**
```json
{
  "runId": "run-abc123",
  "graphId": "my-graph",
  "status": "pending"
}
```

### GET /api/v1/runs/{runId}

Get run status.

**Response:**
```json
{
  "runId": "run-abc123",
  "graphId": "my-graph",
  "status": "completed",
  "startedAt": 1711900800.0,
  "finishedAt": 1711900805.0,
  "outputs": {"result": "..."}
}
```

### POST /api/v1/runs/{runId}/cancel

Cancel a running graph.

### GET /api/v1/graphs

List available graphs.

## Webhooks

### Registering a Webhook

Graphs with `trigger_webhook` nodes automatically register webhook endpoints.

**Example:**
```json
{
  "nodes": [{
    "id": "wh-1",
    "type": "trigger_webhook",
    "config": {"path": "/hooks/my-hook", "method": "POST"}
  }]
}
```

Webhook endpoint: `POST /hooks/my-hook`
```

- [ ] **Step 3: Commit**

```bash
git add doc/
git commit -m "docs: add trigger nodes and API reference documentation"
```

---

## Success Criteria

- [ ] `pytest python/tests/test_trigger_*.py` — all pass
- [ ] `pytest python/tests/test_webhook_route.py` — passes
- [ ] `pytest python/tests/test_scheduler.py` — passes
- [ ] `pytest python/tests/test_api_v1.py` — passes
- [ ] Manual test: POST to webhook endpoint starts run
- [ ] Manual test: Schedule triggers graph at expected time
- [ ] Manual test: API start/status/cancel workflow works
- [ ] Documentation updated

---

## Dependencies

Add to `pyproject.toml`:

```toml
dependencies = [
    # Existing...
    "apscheduler>=3.10",
    "croniter>=2.0",
]

[project.optional-dependencies]
scheduler-redis = ["apscheduler[redis]"]
```
