# GraphCaster Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Systematically close the gap between GraphCaster and production-grade workflow platforms (n8n, Dify, Langflow) while maintaining file-first architecture and Cursor CLI focus.

**Architecture:** Layered approach — keep runner core simple, push scaling/triggers/auth to optional modules. Borrow patterns from competitors: n8n's Bull+Redis queue, Dify's typed event bus, Langflow's component system.

**Tech Stack:** Python 3.11+, Tauri 2, React 18, @xyflow/react, optional Redis/Bull for scaling, MCP SDK, OpenTelemetry

---

## Executive Summary

This plan addresses the major feature gaps identified in `COMPETITIVE_ANALYSIS.md` organized into **6 phases**:

| Phase | Focus | Key Deliverables | Priority |
|-------|-------|------------------|----------|
| **1** | Production Transport | WebSocket relay, Redis pub/sub, bounded queues | P0 |
| **2** | Triggers & Scheduling | Webhook node, schedule trigger, external API | P1 |
| **3** | Agent & RAG | In-runner agent loop, RAG nodes, tool integration | P1 |
| **4** | Scaling & Queues | Bull/Redis queue mode, worker pool, multi-instance | P2 |
| **5** | Advanced UX | CRDT co-edit preparation, advanced canvas | P2 |
| **6** | Enterprise Features | RBAC hooks, audit, compliance (host layer) | P3 |

### Plan checklist vs repository (maintenance note)

Many `- [ ]` steps below were written as a greenfield checklist; the **graph-caster** tree already implements large parts of Phases 1–6 (broker scaling, RQ worker mode, RBAC/audit hooks, CRDT stub route, Yjs UI prep, RAG nodes, API v1, webhooks, optional scheduler). Treat unchecked boxes as **historical** unless they contradict `doc/IMPLEMENTED_FEATURES.md` or failing tests.

**Recently wired in code (not necessarily reflected in every older checkbox):**

- **Redis event relay:** `python/graph_caster/run_broker/relay/redis_relay.py` (async API) plus **sync fan-out** from `RunBroadcaster` when `GC_RUN_BROKER_REDIS_URL` is set (`GC_RUN_BROKER_EVENT_RELAY=0` to disable). See `python/graph_caster/run_broker/relay/broker_sync.py`, tests in `python/tests/test_broker_relay_fanout.py`.
- **Run WebSocket keepalive:** `HeartbeatManager` integrated in `python/graph_caster/run_broker/routes/ws.py` — interval from `GC_RUN_BROKER_WS_HEARTBEAT_SEC` (default `60`, or `0` / empty to disable). Payload: `{"runId", "channel": "ping"}`. Unit tests: `python/tests/test_heartbeat.py`.

**Verification (working tree — re-run after substantive changes):**

| Scope | Command (from repo root `third_party/graph-caster/`) | Success criteria |
|-------|------------------------------------------------------|------------------|
| Python | `cd python && py -3 -m pytest tests -q` | Exit 0; expect on the order of **700+ passed**, a few skipped (optional Redis/RQ/croniter). |
| UI unit | `cd ui && npm test -- --run` | Exit 0; **450** tests passed (Vitest). |
| UI build | `cd ui && npm run build` | `tsc -b && vite build` completes without error. |

Heartbeat tests use relaxed wall-clock sleeps so they stay stable under a full `pytest tests` run (see `python/tests/test_heartbeat.py`).

---

## Phase 1: Production Transport (§39 Closure)

**Problem:** Current dev broker (SSE/WS with viewerToken) lacks production-grade relay between workers and API servers. Need bounded queues and Redis pub/sub for multi-instance.

### Task 1.1: Redis Pub/Sub Event Relay

**Files:**
- Create: `python/graph_caster/run_broker/redis_relay.py`
- Create: `python/graph_caster/run_broker/relay_config.py`
- Modify: `python/graph_caster/run_broker/broadcaster.py:50-100`
- Test: `python/tests/test_run_broker_redis_relay.py`

- [ ] **Step 1: Design relay message envelope**

```python
# redis_relay.py
from dataclasses import dataclass
from typing import Literal

@dataclass
class RelayEnvelope:
    """Message envelope for cross-instance relay (inspired by n8n ExecutionPushMessage)."""
    run_id: str
    channel: Literal["stdout", "stderr", "exit", "control"]
    payload: dict
    instance_id: str
    timestamp: float
```

- [ ] **Step 2: Write failing test for Redis relay**

```python
# test_run_broker_redis_relay.py
import pytest
from graph_caster.run_broker.redis_relay import RedisEventRelay

@pytest.mark.asyncio
async def test_relay_publishes_to_redis_channel():
    relay = RedisEventRelay(redis_url="redis://localhost:6379")
    await relay.publish("run-123", {"type": "node_enter", "nodeId": "n1"})
    # Assert message appears on channel
```

- [ ] **Step 3: Implement RedisEventRelay**

```python
# redis_relay.py
import asyncio
import json
from typing import AsyncIterator, Callable
import redis.asyncio as redis

class RedisEventRelay:
    def __init__(self, redis_url: str, channel_prefix: str = "gc:run:"):
        self.redis_url = redis_url
        self.channel_prefix = channel_prefix
        self._client: redis.Redis | None = None
    
    async def connect(self):
        self._client = redis.from_url(self.redis_url)
    
    async def publish(self, run_id: str, event: dict) -> int:
        channel = f"{self.channel_prefix}{run_id}"
        return await self._client.publish(channel, json.dumps(event))
    
    async def subscribe(self, run_id: str) -> AsyncIterator[dict]:
        pubsub = self._client.pubsub()
        await pubsub.subscribe(f"{self.channel_prefix}{run_id}")
        async for message in pubsub.listen():
            if message["type"] == "message":
                yield json.loads(message["data"])
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest python/tests/test_run_broker_redis_relay.py -v
```

- [ ] **Step 5: Integrate with broadcaster**

Modify `broadcaster.py` to optionally use Redis relay when `GC_RUN_BROKER_REDIS_URL` is set.

- [ ] **Step 6: Commit**

```bash
git add python/graph_caster/run_broker/redis_relay.py python/tests/test_run_broker_redis_relay.py
git commit -m "feat(broker): add Redis pub/sub relay for multi-instance (§39)"
```

### Task 1.2: Production WebSocket with Heartbeat

**Files:**
- Modify: `python/graph_caster/run_broker/routes/ws.py:1-150`
- Create: `python/graph_caster/run_broker/heartbeat.py`
- Test: `python/tests/test_run_broker_ws_heartbeat.py`

- [ ] **Step 1: Write failing test for heartbeat**

```python
@pytest.mark.asyncio
async def test_ws_sends_ping_every_60_seconds():
    # Test WebSocket ping frame or JSON {"channel":"ping"}
    pass
```

- [ ] **Step 2: Implement heartbeat manager**

```python
# heartbeat.py
import asyncio
from typing import Callable

class HeartbeatManager:
    def __init__(self, interval_sec: float = 60.0, send_ping: Callable):
        self.interval_sec = interval_sec
        self._send_ping = send_ping
        self._task: asyncio.Task | None = None
    
    async def start(self):
        self._task = asyncio.create_task(self._ping_loop())
    
    async def _ping_loop(self):
        while True:
            await asyncio.sleep(self.interval_sec)
            await self._send_ping()
```

- [ ] **Step 3: Integrate into WS route**

- [ ] **Step 4: Test passes**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(broker): add WebSocket heartbeat for nginx proxy compatibility"
```

### Task 1.3: Bounded Message Queue per Subscriber

**Files:**
- Modify: `python/graph_caster/run_broker/broadcaster.py:100-200`
- Test: `python/tests/test_run_broker_bounded_queue.py`

Already partially implemented (`GC_RUN_BROKER_SUB_QUEUE_MAX`). This task ensures:
- [ ] **Step 1: Add configurable queue depth per message type**
- [ ] **Step 2: Implement priority levels (run_finished > node_* > process_output)**
- [ ] **Step 3: Add metrics for dropped messages**
- [ ] **Step 4: Test edge cases**
- [ ] **Step 5: Commit**

---

## Phase 2: Triggers & External API (F9, F12)

**Problem:** No webhook or schedule triggers. External systems cannot start runs without Tauri or dev broker.

### Task 2.1: Webhook Trigger Node

**Files:**
- Create: `python/graph_caster/nodes/trigger_webhook.py`
- Create: `python/graph_caster/run_broker/routes/webhook_trigger.py`
- Modify: `schemas/graph-document.schema.json` (add `trigger_webhook` node type)
- Modify: `python/graph_caster/runner/node_visits.py`
- Test: `python/tests/test_trigger_webhook.py`

- [ ] **Step 1: Design webhook trigger contract**

```json
{
  "type": "trigger_webhook",
  "data": {
    "path": "/my-hook",
    "method": "POST",
    "responseMode": "lastNode",
    "authentication": "none"
  }
}
```

- [ ] **Step 2: Write failing test**

```python
def test_webhook_trigger_starts_run_with_payload():
    # POST to /webhooks/trigger/{graphId}/{path} 
    # Expects run to start with payload in context
    pass
```

- [ ] **Step 3: Implement TriggerWebhookNode**

Pattern from Dify: trigger node is just a mapping node that pulls inputs from `context["webhook_payload"]`.

```python
# trigger_webhook.py
class TriggerWebhookNode:
    @staticmethod
    def execute(node: Node, context: dict) -> dict:
        payload = context.get("_webhook_payload", {})
        return {
            "body": payload.get("body"),
            "headers": payload.get("headers"),
            "query": payload.get("query"),
        }
```

- [ ] **Step 4: Add HTTP route**

```python
# webhook_trigger.py
@router.post("/webhooks/trigger/{graph_id}/{path:path}")
async def trigger_webhook(graph_id: str, path: str, request: Request):
    # Load graph, verify trigger_webhook node exists with matching path
    # Start run with context["_webhook_payload"]
    pass
```

- [ ] **Step 5: Tests pass**
- [ ] **Step 6: Update schema**
- [ ] **Step 7: Commit**

```bash
git commit -m "feat(triggers): add webhook trigger node (F9)"
```

### Task 2.2: Schedule Trigger (Cron)

**Files:**
- Create: `python/graph_caster/scheduler/cron_scheduler.py`
- Create: `python/graph_caster/nodes/trigger_schedule.py`
- Test: `python/tests/test_trigger_schedule.py`

- [ ] **Step 1: Design schedule trigger**

```json
{
  "type": "trigger_schedule",
  "data": {
    "cronExpression": "0 9 * * MON-FRI",
    "timezone": "UTC"
  }
}
```

- [ ] **Step 2: Implement cron scheduler service**

Use APScheduler pattern:

```python
# cron_scheduler.py
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

class GraphCronScheduler:
    def __init__(self, workspace_root: str):
        self._scheduler = AsyncIOScheduler()
        self._workspace_root = workspace_root
    
    def register_graph(self, graph_id: str, cron_expr: str, timezone: str):
        trigger = CronTrigger.from_crontab(cron_expr, timezone=timezone)
        self._scheduler.add_job(
            self._run_graph, trigger, args=[graph_id], id=graph_id
        )
```

- [ ] **Step 3: Write tests**
- [ ] **Step 4: Integrate with serve command**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(triggers): add cron schedule trigger (F9)"
```

### Task 2.3: Public REST API for External Runs

**Files:**
- Create: `python/graph_caster/run_broker/routes/api_v1.py`
- Create: `python/graph_caster/run_broker/api_auth.py`
- Test: `python/tests/test_public_api.py`

- [ ] **Step 1: Design API contract**

```
POST /api/v1/graphs/{graphId}/run
  Headers: X-GC-API-Key: <key>
  Body: { "inputs": {...}, "waitForCompletion": false }
  Response: { "runId": "...", "status": "started" }

GET /api/v1/runs/{runId}
  Response: { "runId": "...", "status": "success", "outputs": {...} }

POST /api/v1/runs/{runId}/cancel
  Response: { "cancelled": true }
```

- [ ] **Step 2: Implement API key authentication**
- [ ] **Step 3: Implement endpoints**
- [ ] **Step 4: Tests**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(api): add public REST API for graph runs (F12)"
```

---

## Phase 3: Agent & RAG Enhancement (F10, F11)

**Problem:** Current `llm_agent` is subprocess-only. No in-runner agent loop. No RAG nodes.

### Task 3.1: In-Runner Agent Loop

**Files:**
- Create: `python/graph_caster/agent/agent_loop.py`
- Create: `python/graph_caster/agent/tool_executor.py`
- Create: `python/graph_caster/nodes/agent_node.py`
- Modify: `schemas/graph-document.schema.json` (add `agent` node type)
- Test: `python/tests/test_agent_node.py`

- [ ] **Step 1: Design agent node contract**

Pattern from n8n `@n8n/nodes-langchain` and Dify `AgentNode`:

```json
{
  "type": "agent",
  "data": {
    "model": "gpt-4",
    "systemPrompt": "You are a helpful assistant.",
    "tools": ["graph_ref:tool-graph-id", "mcp:server/tool"],
    "maxIterations": 10,
    "outputParser": "json"
  }
}
```

- [ ] **Step 2: Write failing test**

```python
def test_agent_node_executes_tool_and_returns():
    graph = load_graph("agent-with-tool.json")
    runner = GraphRunner(graph)
    events = list(runner.run())
    # Expect agent_step events showing tool calls
    assert any(e["type"] == "agent_tool_call" for e in events)
```

- [ ] **Step 3: Implement AgentLoop**

```python
# agent_loop.py
from typing import Iterator
from dataclasses import dataclass

@dataclass
class AgentStep:
    thought: str
    action: str | None
    action_input: dict | None
    observation: str | None
    is_final: bool

class AgentLoop:
    def __init__(self, llm_provider, tools: list, max_iterations: int = 10):
        self.llm = llm_provider
        self.tools = {t.name: t for t in tools}
        self.max_iterations = max_iterations
    
    def run(self, input_text: str) -> Iterator[AgentStep]:
        messages = [{"role": "user", "content": input_text}]
        for i in range(self.max_iterations):
            response = self.llm.chat(messages, tools=list(self.tools.values()))
            if response.is_tool_call:
                tool = self.tools[response.tool_name]
                observation = tool.execute(response.tool_input)
                yield AgentStep(
                    thought=response.thought,
                    action=response.tool_name,
                    action_input=response.tool_input,
                    observation=observation,
                    is_final=False
                )
                messages.append({"role": "tool", "content": observation})
            else:
                yield AgentStep(
                    thought=response.content,
                    action=None, action_input=None, observation=None,
                    is_final=True
                )
                return
```

- [ ] **Step 4: Integrate with runner**
- [ ] **Step 5: Add events to run-event.schema.json**
- [ ] **Step 6: Tests pass**
- [ ] **Step 7: Commit**

```bash
git commit -m "feat(agent): add in-runner agent loop with tool calling (F11)"
```

### Task 3.2: RAG Query Node

**Files:**
- Create: `python/graph_caster/nodes/rag_query_node.py`
- Create: `python/graph_caster/rag/retriever.py`
- Create: `python/graph_caster/rag/vector_store.py`
- Test: `python/tests/test_rag_query_node.py`

- [ ] **Step 1: Design RAG query node**

```json
{
  "type": "rag_query",
  "data": {
    "collectionId": "my-collection",
    "topK": 5,
    "minScore": 0.7,
    "reranker": "none"
  }
}
```

- [ ] **Step 2: Implement vector store abstraction**

```python
# vector_store.py
from abc import ABC, abstractmethod
from dataclasses import dataclass

@dataclass
class Document:
    id: str
    content: str
    metadata: dict
    score: float

class VectorStore(ABC):
    @abstractmethod
    async def query(self, embedding: list[float], top_k: int) -> list[Document]:
        pass

class ChromaVectorStore(VectorStore):
    def __init__(self, collection_name: str, chroma_client):
        self.collection = chroma_client.get_collection(collection_name)
    
    async def query(self, embedding, top_k):
        results = self.collection.query(query_embeddings=[embedding], n_results=top_k)
        return [Document(id=r["id"], content=r["document"], 
                        metadata=r["metadata"], score=r["distance"]) 
                for r in results]
```

- [ ] **Step 3: Implement RAG query node**
- [ ] **Step 4: Add to runner visits**
- [ ] **Step 5: Tests**
- [ ] **Step 6: Commit**

```bash
git commit -m "feat(rag): add RAG query node with vector store abstraction (F10)"
```

### Task 3.3: RAG Index Node

**Files:**
- Create: `python/graph_caster/nodes/rag_index_node.py`
- Create: `python/graph_caster/rag/indexer.py`
- Test: `python/tests/test_rag_index_node.py`

- [ ] **Step 1: Design index node**
- [ ] **Step 2: Implement document splitter**
- [ ] **Step 3: Implement embedding pipeline**
- [ ] **Step 4: Implement indexer**
- [ ] **Step 5: Tests**
- [ ] **Step 6: Commit**

```bash
git commit -m "feat(rag): add RAG index node for document ingestion (F10)"
```

---

## Phase 4: Scaling & Queue Mode (F6)

**Problem:** Single-process execution. No Bull/Redis queue like n8n.

### Task 4.1: Bull Queue Integration

**Files:**
- Create: `python/graph_caster/scaling/queue_service.py`
- Create: `python/graph_caster/scaling/job_processor.py`
- Create: `python/graph_caster/scaling/worker.py`
- Test: `python/tests/test_scaling_queue.py`

- [ ] **Step 1: Design queue job schema**

Pattern from n8n `packages/cli/src/scaling/scaling.types.ts`:

```python
@dataclass
class RunJob:
    job_id: str
    graph_id: str
    run_id: str
    context: dict
    artifacts_base: str
    priority: int = 0
    attempts: int = 0
    max_attempts: int = 3
```

- [ ] **Step 2: Implement queue service**

```python
# queue_service.py
import asyncio
from redis import Redis
from rq import Queue

class RunQueueService:
    def __init__(self, redis_url: str, queue_name: str = "gc:runs"):
        self.redis = Redis.from_url(redis_url)
        self.queue = Queue(queue_name, connection=self.redis)
    
    def enqueue(self, job: RunJob) -> str:
        return self.queue.enqueue(
            "graph_caster.scaling.job_processor.process_run",
            job,
            job_id=job.job_id,
            retry=job.max_attempts
        )
```

- [ ] **Step 3: Implement job processor**

```python
# job_processor.py
def process_run(job: RunJob) -> dict:
    from graph_caster import GraphRunner, GraphDocument
    doc = GraphDocument.from_file(f"{job.graphs_root}/{job.graph_id}.json")
    runner = GraphRunner(doc, artifacts_base=job.artifacts_base)
    events = list(runner.run(context=job.context, run_id=job.run_id))
    return {"run_id": job.run_id, "status": events[-1].get("status", "unknown")}
```

- [ ] **Step 4: Implement worker CLI**

```bash
python -m graph_caster worker --redis-url redis://localhost:6379 --concurrency 4
```

- [ ] **Step 5: Tests**
- [ ] **Step 6: Commit**

```bash
git commit -m "feat(scaling): add Bull/RQ queue mode for distributed runs (F6)"
```

### Task 4.2: Worker Pool with Concurrency Limits

**Files:**
- Modify: `python/graph_caster/scaling/worker.py`
- Create: `python/graph_caster/scaling/concurrency.py`
- Test: `python/tests/test_scaling_concurrency.py`

- [ ] **Step 1: Implement concurrency limiter**
- [ ] **Step 2: Add per-graph limits**
- [ ] **Step 3: Add global limits**
- [ ] **Step 4: Tests**
- [ ] **Step 5: Commit**

### Task 4.3: Multi-Instance Coordination

**Files:**
- Create: `python/graph_caster/scaling/leader_election.py`
- Create: `python/graph_caster/scaling/instance_registry.py`
- Test: `python/tests/test_multi_instance.py`

Pattern from n8n `multi-main-setup.ee.ts`:

- [ ] **Step 1: Implement Redis-based leader election**
- [ ] **Step 2: Implement instance heartbeat**
- [ ] **Step 3: Handle stale instance cleanup**
- [ ] **Step 4: Tests**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(scaling): add multi-instance coordination with leader election"
```

---

## Phase 5: Advanced UX (F1, F20, F22)

### Task 5.1: CRDT Foundation (Preparation for F22)

**Files:**
- Create: `ui/src/crdt/YjsProvider.ts`
- Create: `ui/src/crdt/AwarenessProvider.ts`
- Create: `python/graph_caster/run_broker/routes/crdt_sync.py`
- Test: `ui/src/crdt/YjsProvider.test.ts`

Pattern from n8n `@n8n/crdt`:

- [ ] **Step 1: Design CRDT document schema**

```typescript
// YjsProvider.ts
import * as Y from 'yjs';

export interface GraphYDoc {
  nodes: Y.Map<Y.Map<unknown>>;
  edges: Y.Array<Y.Map<unknown>>;
  meta: Y.Map<unknown>;
}

export function createGraphYDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('nodes');
  doc.getArray('edges');
  doc.getMap('meta');
  return doc;
}
```

- [ ] **Step 2: Implement awareness for cursors**
- [ ] **Step 3: Implement WebSocket sync transport**
- [ ] **Step 4: Tests**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(crdt): add Yjs foundation for collaborative editing (F22 prep)"
```

### Task 5.2: Advanced Canvas Performance

**Files:**
- Modify: `ui/src/components/canvas/LODNodeRenderer.tsx`
- Create: `ui/src/graph/virtualization.ts`
- Test: `ui/src/graph/virtualization.test.ts`

- [ ] **Step 1: Implement node virtualization for 1000+ nodes**
- [ ] **Step 2: Add WebGL fallback for minimap**
- [ ] **Step 3: Optimize edge rendering with path caching**
- [ ] **Step 4: Performance benchmarks**
- [ ] **Step 5: Commit**

---

## Phase 6: Enterprise Features (F14, Host Layer)

These features are designed as **hooks** for the host application, not full implementations in GraphCaster core.

### Task 6.1: RBAC Hook Interface

**Files:**
- Create: `python/graph_caster/auth/rbac_hook.py`
- Create: `python/graph_caster/auth/permissions.py`
- Test: `python/tests/test_rbac_hook.py`

- [ ] **Step 1: Design permission model**

```python
# permissions.py
from enum import Enum

class Permission(Enum):
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
    tenant_id: str | None
    permissions: set[Permission]
```

- [ ] **Step 2: Implement hook interface**

```python
# rbac_hook.py
from typing import Protocol

class RBACHook(Protocol):
    async def check_permission(
        self, ctx: AuthContext, resource: str, permission: Permission
    ) -> bool:
        ...
    
    async def filter_graphs(
        self, ctx: AuthContext, graph_ids: list[str]
    ) -> list[str]:
        ...
```

- [ ] **Step 3: Integrate into broker routes**
- [ ] **Step 4: Tests**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(auth): add RBAC hook interface for host integration (F14)"
```

### Task 6.2: Audit Log Hook

**Files:**
- Modify: `python/graph_caster/run_audit.py`
- Create: `python/graph_caster/audit/audit_hook.py`
- Test: `python/tests/test_audit_hook.py`

- [ ] **Step 1: Design audit event schema**
- [ ] **Step 2: Implement hook interface**
- [ ] **Step 3: Add audit events for sensitive operations**
- [ ] **Step 4: Tests**
- [ ] **Step 5: Commit**

---

## UI Implementation Tasks

### Task UI.1: Trigger Node UI

**Files:**
- Modify: `ui/src/graph/nodeKinds.ts`
- Modify: `ui/src/components/InspectorPanel.tsx`
- Create: `ui/src/components/inspector/TriggerWebhookInspector.tsx`
- Create: `ui/src/components/inspector/TriggerScheduleInspector.tsx`

- [ ] **Step 1: Add trigger node types to palette**
- [ ] **Step 2: Implement webhook inspector**
- [ ] **Step 3: Implement schedule inspector with cron builder**
- [ ] **Step 4: Add trigger status indicators**
- [ ] **Step 5: Tests**
- [ ] **Step 6: Commit**

### Task UI.2: Agent Node UI

**Files:**
- Modify: `ui/src/graph/nodeKinds.ts`
- Create: `ui/src/components/inspector/AgentNodeInspector.tsx`
- Create: `ui/src/components/AgentStepsPanel.tsx`

- [ ] **Step 1: Add agent node to palette**
- [ ] **Step 2: Implement agent inspector with tool selection**
- [ ] **Step 3: Add live agent steps panel during run**
- [ ] **Step 4: Tests**
- [ ] **Step 5: Commit**

### Task UI.3: RAG Node UI

**Files:**
- Modify: `ui/src/graph/nodeKinds.ts`
- Create: `ui/src/components/inspector/RAGQueryInspector.tsx`
- Create: `ui/src/components/inspector/RAGIndexInspector.tsx`

- [ ] **Step 1: Add RAG nodes to palette**
- [ ] **Step 2: Implement query inspector with collection selector**
- [ ] **Step 3: Implement index inspector with document preview**
- [ ] **Step 4: Tests**
- [ ] **Step 5: Commit**

---

## Schema Updates Summary

### graph-document.schema.json additions

```json
{
  "$defs": {
    "triggerWebhookNodeData": {
      "type": "object",
      "properties": {
        "path": { "type": "string" },
        "method": { "enum": ["GET", "POST", "PUT", "DELETE"] },
        "authentication": { "enum": ["none", "basic", "bearer", "hmac"] }
      }
    },
    "triggerScheduleNodeData": {
      "type": "object",
      "properties": {
        "cronExpression": { "type": "string" },
        "timezone": { "type": "string" }
      }
    },
    "agentNodeData": {
      "type": "object",
      "properties": {
        "model": { "type": "string" },
        "systemPrompt": { "type": "string" },
        "tools": { "type": "array", "items": { "type": "string" } },
        "maxIterations": { "type": "integer", "default": 10 }
      }
    },
    "ragQueryNodeData": {
      "type": "object",
      "properties": {
        "collectionId": { "type": "string" },
        "topK": { "type": "integer", "default": 5 },
        "minScore": { "type": "number", "default": 0.0 }
      }
    },
    "ragIndexNodeData": {
      "type": "object",
      "properties": {
        "collectionId": { "type": "string" },
        "chunkSize": { "type": "integer", "default": 500 },
        "chunkOverlap": { "type": "integer", "default": 50 }
      }
    }
  }
}
```

### run-event.schema.json additions

```json
{
  "type": {
    "enum": [
      "trigger_activated",
      "agent_loop_start",
      "agent_thought",
      "agent_tool_call",
      "agent_tool_result",
      "agent_loop_end",
      "rag_query_start",
      "rag_query_result",
      "rag_index_start",
      "rag_index_progress",
      "rag_index_complete"
    ]
  }
}
```

---

## Testing Strategy

### Unit Tests
- Each new module has corresponding test file in `python/tests/` or `ui/src/**/*.test.ts`
- Mock external dependencies (Redis, LLM providers, vector stores)
- Use fixtures from `schemas/test-fixtures/`

### Integration Tests
- End-to-end workflow tests with real Redis (Docker)
- Agent loop with mock LLM
- RAG with in-memory Chroma

### Performance Tests
- Canvas with 1000+ nodes
- Queue throughput with 100 concurrent runs
- WebSocket relay with 50 subscribers

---

## Dependencies to Add

### Python (pyproject.toml)
```toml
[project.optional-dependencies]
scaling = ["rq>=1.16", "redis>=5.0"]
agent = ["openai>=1.0", "anthropic>=0.20"]
rag = ["chromadb>=0.4", "sentence-transformers>=2.2"]
scheduler = ["apscheduler>=3.10"]
```

### UI (package.json)
```json
{
  "dependencies": {
    "yjs": "^13.6",
    "y-websocket": "^1.5",
    "cronstrue": "^2.50"
  }
}
```

---

## Migration Notes

1. **Schema version bump:** Each phase that adds node types bumps `schemaVersion` in graph-document.schema.json
2. **Backward compatibility:** New features are opt-in via node types or config flags
3. **Gradual rollout:** Redis/Bull features are optional extras, not required dependencies

---

## Success Criteria

- [ ] Phase 1: Dev broker handles 50 concurrent subscribers without drops
- [ ] Phase 2: Webhooks trigger runs within 100ms of receipt
- [ ] Phase 3: Agent completes 10-step tool loop correctly
- [ ] Phase 4: 100 queued runs processed with fair scheduling
- [ ] Phase 5: 2 users can edit same graph with <100ms sync latency
- [ ] Phase 6: Host can enforce permissions on all API endpoints
