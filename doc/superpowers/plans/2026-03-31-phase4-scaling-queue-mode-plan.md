# Phase 4: Scaling & Queue Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Production-grade scaling — queue-based execution, worker pools, concurrency limits, and multi-instance coordination with leader election.

**Architecture:** Adopt n8n's Bull/Redis pattern for job queue with RQ (Redis Queue). Workers process jobs asynchronously, leader election coordinates singleton tasks (scheduler, cleanup). Instance registry tracks live workers with heartbeat.

**Tech Stack:** Python 3.11+, RQ (rq), Redis, existing runner and relay

---

## File Structure

```
python/graph_caster/
├── scaling/
│   ├── __init__.py
│   ├── queue_service.py     # Job queue abstraction
│   ├── job_processor.py     # Job execution logic
│   ├── worker.py            # Worker CLI
│   ├── concurrency.py       # Concurrency limits
│   ├── leader_election.py   # Redis-based leader election
│   └── instance_registry.py # Instance heartbeat tracking
└── cli/
    └── commands/
        └── worker.py        # CLI command for workers
```

---

## Task 1: Queue Service Interface

**Files:**
- Create: `python/graph_caster/scaling/__init__.py`
- Create: `python/graph_caster/scaling/queue_service.py`
- Test: `python/tests/test_queue_service.py`

- [ ] **Step 1: Define job dataclass and queue interface**

```python
# queue_service.py
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Literal
from enum import Enum
import time
import uuid

class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

@dataclass
class RunJob:
    """Job representing a graph run."""
    id: str
    graph_id: str
    run_id: str
    trigger_context: dict = field(default_factory=dict)
    context_vars: dict = field(default_factory=dict)
    priority: int = 0  # Higher = more urgent
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    status: JobStatus = JobStatus.PENDING
    error: str | None = None
    result: dict | None = None
    
    @classmethod
    def create(
        cls,
        graph_id: str,
        trigger_context: dict | None = None,
        context_vars: dict | None = None,
        priority: int = 0,
    ) -> "RunJob":
        job_id = str(uuid.uuid4())
        run_id = f"run-{job_id[:8]}"
        return cls(
            id=job_id,
            graph_id=graph_id,
            run_id=run_id,
            trigger_context=trigger_context or {},
            context_vars=context_vars or {},
            priority=priority,
        )

class QueueService(ABC):
    """Abstract queue service for job management.
    
    Pattern inspired by n8n's packages/cli/src/scaling/scaling.service.ts
    """
    
    @abstractmethod
    async def enqueue(self, job: RunJob) -> str:
        """Add job to queue. Returns job ID."""
        pass
    
    @abstractmethod
    async def dequeue(self, timeout: float = 0) -> RunJob | None:
        """Get next job from queue. Returns None if empty/timeout."""
        pass
    
    @abstractmethod
    async def get_job(self, job_id: str) -> RunJob | None:
        """Get job by ID."""
        pass
    
    @abstractmethod
    async def update_job(self, job: RunJob) -> None:
        """Update job status."""
        pass
    
    @abstractmethod
    async def cancel_job(self, job_id: str) -> bool:
        """Cancel a pending/running job."""
        pass
    
    @abstractmethod
    async def get_queue_stats(self) -> dict:
        """Get queue statistics."""
        pass
```

- [ ] **Step 2: Write test**

```python
# test_queue_service.py
from graph_caster.scaling import RunJob, JobStatus

def test_run_job_creation():
    job = RunJob.create(
        graph_id="test-graph",
        trigger_context={"type": "api"},
        priority=5
    )
    
    assert job.graph_id == "test-graph"
    assert job.status == JobStatus.PENDING
    assert job.priority == 5
    assert job.run_id.startswith("run-")

def test_job_status_enum():
    assert JobStatus.PENDING.value == "pending"
    assert JobStatus.COMPLETED.value == "completed"
```

- [ ] **Step 3: Run test**

```bash
pytest python/tests/test_queue_service.py -v
```

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/scaling/
git commit -m "feat(scaling): add queue service interface and RunJob dataclass"
```

---

## Task 2: RQ Queue Implementation

**Files:**
- Create: `python/graph_caster/scaling/rq_queue.py`
- Test: `python/tests/test_rq_queue.py`

- [ ] **Step 1: Write failing test**

```python
# test_rq_queue.py
import pytest
import os
from graph_caster.scaling import RunJob
from graph_caster.scaling.rq_queue import RQQueueService

REDIS_URL = os.environ.get("GC_TEST_REDIS_URL", "redis://localhost:6379")

@pytest.fixture
async def rq_queue():
    queue = RQQueueService(redis_url=REDIS_URL, queue_name="gc:test:jobs")
    await queue.connect()
    yield queue
    await queue.disconnect()

@pytest.mark.asyncio
@pytest.mark.skipif(not os.environ.get("GC_TEST_REDIS_URL"), reason="No Redis")
async def test_rq_enqueue_dequeue(rq_queue):
    job = RunJob.create(graph_id="test-graph")
    
    job_id = await rq_queue.enqueue(job)
    assert job_id == job.id
    
    retrieved = await rq_queue.dequeue(timeout=1)
    assert retrieved is not None
    assert retrieved.id == job.id
    assert retrieved.graph_id == "test-graph"

@pytest.mark.asyncio
@pytest.mark.skipif(not os.environ.get("GC_TEST_REDIS_URL"), reason="No Redis")
async def test_rq_priority_ordering(rq_queue):
    low = RunJob.create(graph_id="low", priority=1)
    high = RunJob.create(graph_id="high", priority=10)
    
    await rq_queue.enqueue(low)
    await rq_queue.enqueue(high)
    
    # High priority should come first
    first = await rq_queue.dequeue(timeout=1)
    assert first.graph_id == "high"
    
    second = await rq_queue.dequeue(timeout=1)
    assert second.graph_id == "low"
```

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Implement RQ queue service**

```python
# rq_queue.py
import asyncio
import json
from typing import Any
import redis.asyncio as redis
from rq import Queue
from rq.job import Job as RQJob
from .queue_service import QueueService, RunJob, JobStatus

class RQQueueService(QueueService):
    """Redis Queue (RQ) based queue service.
    
    Uses Redis sorted sets for priority queue.
    Pattern inspired by n8n's Bull queue setup.
    """
    
    def __init__(
        self,
        redis_url: str,
        queue_name: str = "gc:jobs",
    ):
        self.redis_url = redis_url
        self.queue_name = queue_name
        self._redis: redis.Redis | None = None
        self._job_key_prefix = f"{queue_name}:job:"
    
    async def connect(self) -> None:
        self._redis = redis.from_url(self.redis_url, decode_responses=True)
        await self._redis.ping()
    
    async def disconnect(self) -> None:
        if self._redis:
            await self._redis.close()
            self._redis = None
    
    def _job_to_dict(self, job: RunJob) -> dict:
        return {
            "id": job.id,
            "graph_id": job.graph_id,
            "run_id": job.run_id,
            "trigger_context": json.dumps(job.trigger_context),
            "context_vars": json.dumps(job.context_vars),
            "priority": job.priority,
            "created_at": job.created_at,
            "started_at": job.started_at,
            "finished_at": job.finished_at,
            "status": job.status.value,
            "error": job.error,
            "result": json.dumps(job.result) if job.result else None,
        }
    
    def _dict_to_job(self, data: dict) -> RunJob:
        return RunJob(
            id=data["id"],
            graph_id=data["graph_id"],
            run_id=data["run_id"],
            trigger_context=json.loads(data.get("trigger_context", "{}")),
            context_vars=json.loads(data.get("context_vars", "{}")),
            priority=int(data.get("priority", 0)),
            created_at=float(data.get("created_at", 0)),
            started_at=float(data["started_at"]) if data.get("started_at") else None,
            finished_at=float(data["finished_at"]) if data.get("finished_at") else None,
            status=JobStatus(data.get("status", "pending")),
            error=data.get("error"),
            result=json.loads(data["result"]) if data.get("result") else None,
        )
    
    async def enqueue(self, job: RunJob) -> str:
        if not self._redis:
            raise RuntimeError("Not connected")
        
        # Store job data
        job_key = f"{self._job_key_prefix}{job.id}"
        await self._redis.hset(job_key, mapping=self._job_to_dict(job))
        
        # Add to priority queue (sorted set with score = -priority for highest first)
        await self._redis.zadd(
            f"{self.queue_name}:pending",
            {job.id: -job.priority}
        )
        
        return job.id
    
    async def dequeue(self, timeout: float = 0) -> RunJob | None:
        if not self._redis:
            raise RuntimeError("Not connected")
        
        end_time = asyncio.get_event_loop().time() + timeout
        
        while True:
            # Get highest priority job (lowest score)
            results = await self._redis.zpopmin(f"{self.queue_name}:pending", count=1)
            
            if results:
                job_id = results[0][0]  # (member, score)
                job_key = f"{self._job_key_prefix}{job_id}"
                data = await self._redis.hgetall(job_key)
                
                if data:
                    job = self._dict_to_job(data)
                    job.status = JobStatus.RUNNING
                    job.started_at = asyncio.get_event_loop().time()
                    await self.update_job(job)
                    return job
            
            # Check timeout
            if timeout <= 0:
                return None
            if asyncio.get_event_loop().time() >= end_time:
                return None
            
            # Wait a bit before retrying
            await asyncio.sleep(0.1)
    
    async def get_job(self, job_id: str) -> RunJob | None:
        if not self._redis:
            raise RuntimeError("Not connected")
        
        job_key = f"{self._job_key_prefix}{job_id}"
        data = await self._redis.hgetall(job_key)
        
        if data:
            return self._dict_to_job(data)
        return None
    
    async def update_job(self, job: RunJob) -> None:
        if not self._redis:
            raise RuntimeError("Not connected")
        
        job_key = f"{self._job_key_prefix}{job.id}"
        await self._redis.hset(job_key, mapping=self._job_to_dict(job))
    
    async def cancel_job(self, job_id: str) -> bool:
        if not self._redis:
            raise RuntimeError("Not connected")
        
        # Remove from pending queue
        removed = await self._redis.zrem(f"{self.queue_name}:pending", job_id)
        
        # Update status
        job = await self.get_job(job_id)
        if job:
            job.status = JobStatus.CANCELLED
            job.finished_at = asyncio.get_event_loop().time()
            await self.update_job(job)
            return True
        
        return removed > 0
    
    async def get_queue_stats(self) -> dict:
        if not self._redis:
            raise RuntimeError("Not connected")
        
        pending = await self._redis.zcard(f"{self.queue_name}:pending")
        
        return {
            "pending": pending,
            "queue_name": self.queue_name,
        }
```

- [ ] **Step 4: Tests pass**

```bash
GC_TEST_REDIS_URL=redis://localhost:6379 pytest python/tests/test_rq_queue.py -v
```

- [ ] **Step 5: Commit**

```bash
git add python/graph_caster/scaling/rq_queue.py
git commit -m "feat(scaling): add RQ-based queue service implementation"
```

---

## Task 3: Job Processor

**Files:**
- Create: `python/graph_caster/scaling/job_processor.py`
- Test: `python/tests/test_job_processor.py`

- [ ] **Step 1: Write failing test**

```python
# test_job_processor.py
import pytest
from graph_caster.scaling import RunJob
from graph_caster.scaling.job_processor import JobProcessor

@pytest.mark.asyncio
async def test_job_processor_executes_graph(tmp_path):
    # Create test graph
    graphs_dir = tmp_path / "graphs"
    graphs_dir.mkdir()
    (graphs_dir / "test.json").write_text('''{
        "id": "test",
        "name": "Test",
        "nodes": [{"id": "start", "type": "start"}, {"id": "exit", "type": "exit"}],
        "edges": [{"from": "start", "to": "exit"}]
    }''')
    
    processor = JobProcessor(workspace_root=str(tmp_path))
    
    job = RunJob.create(graph_id="test")
    result = await processor.process(job)
    
    assert result.status.value == "completed"
    assert result.finished_at is not None

@pytest.mark.asyncio
async def test_job_processor_handles_error(tmp_path):
    processor = JobProcessor(workspace_root=str(tmp_path))
    
    job = RunJob.create(graph_id="nonexistent")
    result = await processor.process(job)
    
    assert result.status.value == "failed"
    assert result.error is not None
```

- [ ] **Step 2: Implement job processor**

```python
# job_processor.py
import asyncio
import time
import traceback
from typing import Any
from .queue_service import RunJob, JobStatus
from graph_caster.workspace import Workspace
from graph_caster.runner import run_graph
from graph_caster.triggers import TriggerContext, TriggerType

class JobProcessor:
    """Processes graph run jobs.
    
    Pattern: Similar to n8n's packages/cli/src/scaling/job-processor.ts
    """
    
    def __init__(
        self,
        workspace_root: str,
        max_retries: int = 0,
    ):
        self.workspace_root = workspace_root
        self.max_retries = max_retries
        self._workspace: Workspace | None = None
    
    async def initialize(self) -> None:
        self._workspace = Workspace(self.workspace_root)
    
    async def process(self, job: RunJob) -> RunJob:
        """Process a single job. Returns updated job with result/error."""
        job.status = JobStatus.RUNNING
        job.started_at = time.time()
        
        try:
            if not self._workspace:
                self._workspace = Workspace(self.workspace_root)
            
            # Load graph
            graph = self._workspace.load_graph(job.graph_id)
            
            # Build trigger context if provided
            trigger_ctx = None
            if job.trigger_context:
                trigger_type = TriggerType(job.trigger_context.get("type", "manual"))
                trigger_ctx = TriggerContext(
                    trigger_type=trigger_type,
                    trigger_id=job.trigger_context.get("id", ""),
                    payload=job.trigger_context.get("payload", {}),
                    headers=job.trigger_context.get("headers", {}),
                    timestamp=job.trigger_context.get("timestamp", time.time()),
                )
            
            # Merge context vars
            context_vars = job.context_vars.copy()
            if trigger_ctx:
                context_vars.update(trigger_ctx.to_context_vars())
            
            # Execute graph
            result = await run_graph(
                graph=graph,
                run_id=job.run_id,
                context_vars=context_vars,
                workspace=self._workspace,
            )
            
            job.status = JobStatus.COMPLETED
            job.result = {
                "outputs": result.outputs,
                "status": result.status,
            }
            
        except Exception as e:
            job.status = JobStatus.FAILED
            job.error = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
        
        finally:
            job.finished_at = time.time()
        
        return job
```

- [ ] **Step 3: Tests pass**

```bash
pytest python/tests/test_job_processor.py -v
```

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/scaling/job_processor.py
git commit -m "feat(scaling): add job processor for graph execution"
```

---

## Task 4: Worker Service

**Files:**
- Create: `python/graph_caster/scaling/worker.py`
- Test: `python/tests/test_worker.py`

- [ ] **Step 1: Write failing test**

```python
# test_worker.py
import pytest
import asyncio
from graph_caster.scaling.worker import WorkerService
from graph_caster.scaling import RunJob

class MockQueue:
    def __init__(self):
        self.jobs = []
        self.dequeue_count = 0
    
    async def dequeue(self, timeout=0):
        self.dequeue_count += 1
        if self.jobs:
            return self.jobs.pop(0)
        return None
    
    async def update_job(self, job):
        pass

class MockProcessor:
    def __init__(self):
        self.processed = []
    
    async def process(self, job):
        self.processed.append(job)
        job.status = "completed"
        return job

@pytest.mark.asyncio
async def test_worker_processes_jobs():
    queue = MockQueue()
    processor = MockProcessor()
    
    queue.jobs.append(RunJob.create(graph_id="test"))
    
    worker = WorkerService(
        queue=queue,
        processor=processor,
        concurrency=1,
    )
    
    # Run worker for short time
    task = asyncio.create_task(worker.start())
    await asyncio.sleep(0.2)
    worker.stop()
    
    try:
        await asyncio.wait_for(task, timeout=1)
    except asyncio.CancelledError:
        pass
    
    assert len(processor.processed) == 1
```

- [ ] **Step 2: Implement worker service**

```python
# worker.py
import asyncio
import signal
import os
from typing import Any
from .queue_service import QueueService, RunJob, JobStatus
from .job_processor import JobProcessor

class WorkerService:
    """Worker service that processes jobs from queue.
    
    Pattern inspired by n8n's packages/cli/src/commands/worker.ts
    """
    
    def __init__(
        self,
        queue: QueueService,
        processor: JobProcessor,
        concurrency: int = 5,
        poll_interval: float = 1.0,
        instance_id: str | None = None,
    ):
        self.queue = queue
        self.processor = processor
        self.concurrency = concurrency
        self.poll_interval = poll_interval
        self.instance_id = instance_id or f"worker-{os.getpid()}"
        
        self._running = False
        self._active_jobs: dict[str, asyncio.Task] = {}
        self._semaphore = asyncio.Semaphore(concurrency)
    
    async def start(self) -> None:
        """Start the worker loop."""
        self._running = True
        
        # Set up signal handlers
        loop = asyncio.get_event_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, self.stop)
            except NotImplementedError:
                pass  # Windows
        
        print(f"Worker {self.instance_id} started (concurrency={self.concurrency})")
        
        while self._running:
            # Check if we can accept more jobs
            if len(self._active_jobs) >= self.concurrency:
                await asyncio.sleep(0.1)
                continue
            
            # Try to get a job
            try:
                job = await self.queue.dequeue(timeout=self.poll_interval)
                
                if job:
                    # Process job in background
                    task = asyncio.create_task(self._process_job(job))
                    self._active_jobs[job.id] = task
                    
            except Exception as e:
                print(f"Error dequeuing job: {e}")
                await asyncio.sleep(self.poll_interval)
        
        # Wait for active jobs to complete
        if self._active_jobs:
            print(f"Waiting for {len(self._active_jobs)} active jobs...")
            await asyncio.gather(*self._active_jobs.values(), return_exceptions=True)
        
        print(f"Worker {self.instance_id} stopped")
    
    def stop(self) -> None:
        """Signal worker to stop."""
        self._running = False
    
    async def _process_job(self, job: RunJob) -> None:
        """Process a single job."""
        try:
            async with self._semaphore:
                print(f"Processing job {job.id} (graph={job.graph_id})")
                
                result = await self.processor.process(job)
                await self.queue.update_job(result)
                
                if result.status == JobStatus.COMPLETED:
                    print(f"Job {job.id} completed")
                else:
                    print(f"Job {job.id} failed: {result.error}")
                    
        except Exception as e:
            print(f"Error processing job {job.id}: {e}")
            job.status = JobStatus.FAILED
            job.error = str(e)
            await self.queue.update_job(job)
        
        finally:
            self._active_jobs.pop(job.id, None)
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/scaling/worker.py
git commit -m "feat(scaling): add worker service for job processing"
```

---

## Task 5: Concurrency Limits

**Files:**
- Create: `python/graph_caster/scaling/concurrency.py`
- Test: `python/tests/test_concurrency.py`

- [ ] **Step 1: Write failing test**

```python
# test_concurrency.py
import pytest
import asyncio
from graph_caster.scaling.concurrency import ConcurrencyManager

@pytest.mark.asyncio
async def test_concurrency_limit():
    manager = ConcurrencyManager(max_concurrent=2)
    
    execution_count = 0
    peak_concurrent = 0
    current_concurrent = 0
    
    async def task():
        nonlocal execution_count, peak_concurrent, current_concurrent
        async with manager.acquire("test"):
            current_concurrent += 1
            peak_concurrent = max(peak_concurrent, current_concurrent)
            await asyncio.sleep(0.1)
            execution_count += 1
            current_concurrent -= 1
    
    # Run 5 tasks
    await asyncio.gather(*[task() for _ in range(5)])
    
    assert execution_count == 5
    assert peak_concurrent <= 2  # Never exceeded limit

@pytest.mark.asyncio
async def test_concurrency_per_graph():
    manager = ConcurrencyManager(max_per_graph=1)
    
    concurrent_same_graph = 0
    peak_same = 0
    
    async def task(graph_id):
        nonlocal concurrent_same_graph, peak_same
        async with manager.acquire(graph_id):
            if graph_id == "graph-a":
                concurrent_same_graph += 1
                peak_same = max(peak_same, concurrent_same_graph)
            await asyncio.sleep(0.05)
            if graph_id == "graph-a":
                concurrent_same_graph -= 1
    
    # Run tasks for same graph
    tasks = [task("graph-a") for _ in range(3)] + [task("graph-b") for _ in range(2)]
    await asyncio.gather(*tasks)
    
    assert peak_same <= 1  # Only 1 concurrent per graph
```

- [ ] **Step 2: Implement concurrency manager**

```python
# concurrency.py
import asyncio
from contextlib import asynccontextmanager
from typing import AsyncIterator
from collections import defaultdict

class ConcurrencyManager:
    """Manages concurrency limits for job execution.
    
    Pattern: Similar to n8n's concurrency control in scaling service.
    """
    
    def __init__(
        self,
        max_concurrent: int = 10,
        max_per_graph: int = 5,
    ):
        self.max_concurrent = max_concurrent
        self.max_per_graph = max_per_graph
        
        self._global_semaphore = asyncio.Semaphore(max_concurrent)
        self._graph_semaphores: dict[str, asyncio.Semaphore] = defaultdict(
            lambda: asyncio.Semaphore(max_per_graph)
        )
        self._lock = asyncio.Lock()
    
    @asynccontextmanager
    async def acquire(self, graph_id: str) -> AsyncIterator[None]:
        """Acquire execution slot for a graph."""
        # Acquire global slot
        async with self._global_semaphore:
            # Acquire per-graph slot
            async with self._lock:
                if graph_id not in self._graph_semaphores:
                    self._graph_semaphores[graph_id] = asyncio.Semaphore(self.max_per_graph)
            
            async with self._graph_semaphores[graph_id]:
                yield
    
    async def get_stats(self) -> dict:
        """Get current concurrency statistics."""
        return {
            "global_available": self._global_semaphore._value,
            "global_max": self.max_concurrent,
            "graphs_tracked": len(self._graph_semaphores),
        }
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/scaling/concurrency.py
git commit -m "feat(scaling): add concurrency manager with per-graph limits"
```

---

## Task 6: Leader Election

**Files:**
- Create: `python/graph_caster/scaling/leader_election.py`
- Test: `python/tests/test_leader_election.py`

- [ ] **Step 1: Write failing test**

```python
# test_leader_election.py
import pytest
import asyncio
import os
from graph_caster.scaling.leader_election import LeaderElection

REDIS_URL = os.environ.get("GC_TEST_REDIS_URL", "redis://localhost:6379")

@pytest.mark.asyncio
@pytest.mark.skipif(not os.environ.get("GC_TEST_REDIS_URL"), reason="No Redis")
async def test_single_leader_wins():
    le = LeaderElection(
        redis_url=REDIS_URL,
        key="gc:test:leader",
        instance_id="instance-1",
        ttl_seconds=5
    )
    
    await le.connect()
    is_leader = await le.try_acquire()
    
    assert is_leader is True
    assert await le.is_leader() is True
    
    await le.release()
    await le.disconnect()

@pytest.mark.asyncio
@pytest.mark.skipif(not os.environ.get("GC_TEST_REDIS_URL"), reason="No Redis")
async def test_only_one_leader():
    le1 = LeaderElection(redis_url=REDIS_URL, key="gc:test:leader2", instance_id="i1", ttl_seconds=5)
    le2 = LeaderElection(redis_url=REDIS_URL, key="gc:test:leader2", instance_id="i2", ttl_seconds=5)
    
    await le1.connect()
    await le2.connect()
    
    is_leader1 = await le1.try_acquire()
    is_leader2 = await le2.try_acquire()
    
    # Only one should be leader
    assert is_leader1 != is_leader2 or (not is_leader1 and not is_leader2)
    
    await le1.release()
    await le2.release()
    await le1.disconnect()
    await le2.disconnect()
```

- [ ] **Step 2: Implement leader election**

```python
# leader_election.py
import asyncio
import redis.asyncio as redis

class LeaderElection:
    """Redis-based leader election for singleton tasks.
    
    Uses Redis SETNX + TTL for distributed lock.
    Pattern: Similar to n8n's multi-main coordination.
    """
    
    def __init__(
        self,
        redis_url: str,
        key: str = "gc:leader",
        instance_id: str = "default",
        ttl_seconds: int = 30,
        renew_interval: float = 10.0,
    ):
        self.redis_url = redis_url
        self.key = key
        self.instance_id = instance_id
        self.ttl_seconds = ttl_seconds
        self.renew_interval = renew_interval
        
        self._redis: redis.Redis | None = None
        self._is_leader = False
        self._renew_task: asyncio.Task | None = None
    
    async def connect(self) -> None:
        self._redis = redis.from_url(self.redis_url, decode_responses=True)
        await self._redis.ping()
    
    async def disconnect(self) -> None:
        if self._renew_task:
            self._renew_task.cancel()
            try:
                await self._renew_task
            except asyncio.CancelledError:
                pass
        
        if self._redis:
            await self._redis.close()
            self._redis = None
    
    async def try_acquire(self) -> bool:
        """Try to become leader. Returns True if successful."""
        if not self._redis:
            raise RuntimeError("Not connected")
        
        # Try to set key with NX (only if not exists)
        result = await self._redis.set(
            self.key,
            self.instance_id,
            nx=True,
            ex=self.ttl_seconds
        )
        
        if result:
            self._is_leader = True
            # Start renewal task
            self._renew_task = asyncio.create_task(self._renew_loop())
            return True
        
        # Check if we already hold it
        current = await self._redis.get(self.key)
        if current == self.instance_id:
            self._is_leader = True
            return True
        
        return False
    
    async def is_leader(self) -> bool:
        """Check if this instance is currently leader."""
        if not self._redis:
            return False
        
        current = await self._redis.get(self.key)
        self._is_leader = current == self.instance_id
        return self._is_leader
    
    async def release(self) -> None:
        """Release leadership."""
        if not self._redis:
            return
        
        if self._renew_task:
            self._renew_task.cancel()
            try:
                await self._renew_task
            except asyncio.CancelledError:
                pass
            self._renew_task = None
        
        # Only delete if we own it
        current = await self._redis.get(self.key)
        if current == self.instance_id:
            await self._redis.delete(self.key)
        
        self._is_leader = False
    
    async def _renew_loop(self) -> None:
        """Periodically renew the lock."""
        while self._is_leader:
            try:
                await asyncio.sleep(self.renew_interval)
                
                # Renew TTL if we still own it
                current = await self._redis.get(self.key)
                if current == self.instance_id:
                    await self._redis.expire(self.key, self.ttl_seconds)
                else:
                    self._is_leader = False
                    break
                    
            except asyncio.CancelledError:
                break
            except Exception:
                pass  # Log but continue
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/scaling/leader_election.py
git commit -m "feat(scaling): add Redis-based leader election"
```

---

## Task 7: Instance Registry

**Files:**
- Create: `python/graph_caster/scaling/instance_registry.py`
- Test: `python/tests/test_instance_registry.py`

- [ ] **Step 1: Implement instance registry**

```python
# instance_registry.py
import asyncio
import time
from dataclasses import dataclass
import redis.asyncio as redis

@dataclass
class InstanceInfo:
    instance_id: str
    hostname: str
    started_at: float
    last_heartbeat: float
    jobs_processed: int = 0
    
    def is_stale(self, max_age_seconds: float = 60) -> bool:
        return time.time() - self.last_heartbeat > max_age_seconds

class InstanceRegistry:
    """Tracks active worker instances via Redis.
    
    Pattern: Similar to n8n's multi-main instance heartbeat.
    """
    
    def __init__(
        self,
        redis_url: str,
        instance_id: str,
        key_prefix: str = "gc:instances:",
        heartbeat_interval: float = 10.0,
        stale_threshold: float = 60.0,
    ):
        self.redis_url = redis_url
        self.instance_id = instance_id
        self.key_prefix = key_prefix
        self.heartbeat_interval = heartbeat_interval
        self.stale_threshold = stale_threshold
        
        self._redis: redis.Redis | None = None
        self._heartbeat_task: asyncio.Task | None = None
        self._hostname = self._get_hostname()
        self._started_at = time.time()
        self._jobs_processed = 0
    
    def _get_hostname(self) -> str:
        import socket
        return socket.gethostname()
    
    async def connect(self) -> None:
        self._redis = redis.from_url(self.redis_url, decode_responses=True)
        await self._redis.ping()
    
    async def disconnect(self) -> None:
        await self.unregister()
        if self._redis:
            await self._redis.close()
    
    async def register(self) -> None:
        """Register this instance and start heartbeat."""
        await self._send_heartbeat()
        self._heartbeat_task = asyncio.create_task(self._heartbeat_loop())
    
    async def unregister(self) -> None:
        """Unregister this instance."""
        if self._heartbeat_task:
            self._heartbeat_task.cancel()
            try:
                await self._heartbeat_task
            except asyncio.CancelledError:
                pass
        
        if self._redis:
            key = f"{self.key_prefix}{self.instance_id}"
            await self._redis.delete(key)
    
    async def _send_heartbeat(self) -> None:
        if not self._redis:
            return
        
        key = f"{self.key_prefix}{self.instance_id}"
        data = {
            "instance_id": self.instance_id,
            "hostname": self._hostname,
            "started_at": self._started_at,
            "last_heartbeat": time.time(),
            "jobs_processed": self._jobs_processed,
        }
        
        await self._redis.hset(key, mapping={k: str(v) for k, v in data.items()})
        await self._redis.expire(key, int(self.stale_threshold * 2))
    
    async def _heartbeat_loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(self.heartbeat_interval)
                await self._send_heartbeat()
            except asyncio.CancelledError:
                break
            except Exception:
                pass
    
    def increment_jobs(self) -> None:
        self._jobs_processed += 1
    
    async def list_instances(self) -> list[InstanceInfo]:
        """List all registered instances."""
        if not self._redis:
            return []
        
        instances = []
        pattern = f"{self.key_prefix}*"
        
        async for key in self._redis.scan_iter(match=pattern):
            data = await self._redis.hgetall(key)
            if data:
                instances.append(InstanceInfo(
                    instance_id=data.get("instance_id", ""),
                    hostname=data.get("hostname", ""),
                    started_at=float(data.get("started_at", 0)),
                    last_heartbeat=float(data.get("last_heartbeat", 0)),
                    jobs_processed=int(data.get("jobs_processed", 0)),
                ))
        
        return instances
    
    async def cleanup_stale(self) -> int:
        """Remove stale instances. Returns count removed."""
        instances = await self.list_instances()
        removed = 0
        
        for inst in instances:
            if inst.is_stale(self.stale_threshold):
                key = f"{self.key_prefix}{inst.instance_id}"
                await self._redis.delete(key)
                removed += 1
        
        return removed
```

- [ ] **Step 2: Commit**

```bash
git add python/graph_caster/scaling/instance_registry.py
git commit -m "feat(scaling): add instance registry with heartbeat"
```

---

## Task 8: Worker CLI Command

**Files:**
- Create: `python/graph_caster/cli/commands/worker.py`
- Modify: `python/graph_caster/cli/__main__.py`

- [ ] **Step 1: Implement worker CLI**

```python
# worker.py
import asyncio
import os
import click
from graph_caster.scaling.rq_queue import RQQueueService
from graph_caster.scaling.job_processor import JobProcessor
from graph_caster.scaling.worker import WorkerService
from graph_caster.scaling.leader_election import LeaderElection
from graph_caster.scaling.instance_registry import InstanceRegistry

@click.command()
@click.option("--redis-url", envvar="GC_REDIS_URL", default="redis://localhost:6379")
@click.option("--workspace", envvar="GC_WORKSPACE", default=".")
@click.option("--concurrency", "-c", default=5, help="Max concurrent jobs")
@click.option("--queue-name", default="gc:jobs", help="Queue name")
@click.option("--leader/--no-leader", default=False, help="Enable leader election")
def worker(redis_url: str, workspace: str, concurrency: int, queue_name: str, leader: bool):
    """Start a GraphCaster worker."""
    asyncio.run(_run_worker(redis_url, workspace, concurrency, queue_name, leader))

async def _run_worker(
    redis_url: str,
    workspace: str,
    concurrency: int,
    queue_name: str,
    leader: bool,
):
    instance_id = f"worker-{os.getpid()}"
    
    # Initialize services
    queue = RQQueueService(redis_url=redis_url, queue_name=queue_name)
    await queue.connect()
    
    processor = JobProcessor(workspace_root=workspace)
    await processor.initialize()
    
    registry = InstanceRegistry(redis_url=redis_url, instance_id=instance_id)
    await registry.connect()
    await registry.register()
    
    leader_election = None
    if leader:
        leader_election = LeaderElection(redis_url=redis_url, instance_id=instance_id)
        await leader_election.connect()
        is_leader = await leader_election.try_acquire()
        if is_leader:
            print(f"This instance is the leader")
            # TODO: Start scheduler, cleanup tasks
    
    worker_service = WorkerService(
        queue=queue,
        processor=processor,
        concurrency=concurrency,
        instance_id=instance_id,
    )
    
    try:
        await worker_service.start()
    finally:
        await registry.unregister()
        await registry.disconnect()
        if leader_election:
            await leader_election.release()
            await leader_election.disconnect()
        await queue.disconnect()
```

- [ ] **Step 2: Add to CLI**

```python
# In __main__.py
from .commands.worker import worker
cli.add_command(worker)
```

- [ ] **Step 3: Test CLI**

```bash
python -m graph_caster worker --help
```

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/cli/
git commit -m "feat(cli): add worker command for distributed execution"
```

---

## Task 9: Documentation

**Files:**
- Create: `doc/SCALING.md`

- [ ] **Step 1: Document scaling architecture**

```markdown
# GraphCaster Scaling Guide

## Overview

GraphCaster supports three execution modes:

1. **Single-instance** (default): Direct execution, in-memory relay
2. **Queue mode**: Redis-backed job queue with workers
3. **Multi-instance**: Multiple workers with leader election

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GC_REDIS_URL` | (none) | Redis URL for queue mode |
| `GC_QUEUE_NAME` | gc:jobs | Job queue name |
| `GC_WORKER_CONCURRENCY` | 5 | Max concurrent jobs per worker |
| `GC_LEADER_TTL` | 30 | Leader lock TTL in seconds |

## Queue Mode

Start the API server:
```bash
python -m graph_caster serve
```

Start workers:
```bash
# Worker 1
python -m graph_caster worker --redis-url redis://localhost:6379

# Worker 2 (different terminal)
python -m graph_caster worker --redis-url redis://localhost:6379
```

Jobs will be distributed across workers.

## Leader Election

For singleton tasks (scheduler, cleanup), enable leader election:

```bash
python -m graph_caster worker --leader
```

Only one worker will be leader at a time.

## Architecture

```
┌─────────────┐     ┌─────────────┐
│ API Server  │────▶│ Redis Queue │
└─────────────┘     └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
        ▼                  ▼                  ▼
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  Worker 1   │    │  Worker 2   │    │  Worker 3   │
│  (leader)   │    │             │    │             │
└─────────────┘    └─────────────┘    └─────────────┘
```

The leader worker runs:
- Cron scheduler
- Stale instance cleanup
- Run artifact cleanup
```

- [ ] **Step 2: Commit**

```bash
git add doc/SCALING.md
git commit -m "docs: add scaling guide"
```

---

## Success Criteria

- [ ] `pytest python/tests/test_*queue*.py` — passes
- [ ] `pytest python/tests/test_worker.py` — passes
- [ ] `pytest python/tests/test_leader_election.py` — passes
- [ ] Worker CLI starts and processes jobs
- [ ] Multiple workers share jobs correctly
- [ ] Leader election works (only one leader)
- [ ] Instance registry tracks workers
- [ ] Documentation complete

---

## Dependencies

Add to `pyproject.toml`:

```toml
dependencies = [
    # Existing...
    "rq>=1.15",
]
```
