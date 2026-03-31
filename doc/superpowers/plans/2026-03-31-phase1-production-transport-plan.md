# Phase 1: Production Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close §39 gap — production-grade event relay between workers and API servers with Redis pub/sub, bounded queues, and heartbeat for proxy compatibility.

**Architecture:** Adopt n8n's `Push` abstraction pattern — pluggable backends (in-memory, Redis) behind unified interface. Keep current SSE/WS as default, add Redis relay as optional scaling layer.

**Tech Stack:** Python 3.11+, redis.asyncio, Starlette/FastAPI, existing run_broker

---

## File Structure

```
python/graph_caster/run_broker/
├── relay/
│   ├── __init__.py
│   ├── base.py           # Abstract relay interface
│   ├── memory.py         # In-memory relay (current behavior)
│   └── redis_relay.py    # Redis pub/sub relay
├── heartbeat.py          # WebSocket/SSE heartbeat manager
└── bounded_queue.py      # Priority-aware bounded queue
```

---

## Task 1: Abstract Relay Interface

**Files:**
- Create: `python/graph_caster/run_broker/relay/__init__.py`
- Create: `python/graph_caster/run_broker/relay/base.py`
- Test: `python/tests/test_relay_base.py`

- [ ] **Step 0: Create package __init__.py**

```python
# __init__.py
from .base import EventRelay, RelayMessage

__all__ = ["EventRelay", "RelayMessage"]
```

- [ ] **Step 1: Write the interface definition**

```python
# base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import AsyncIterator, Literal
import time

@dataclass
class RelayMessage:
    """Message envelope for cross-instance relay."""
    run_id: str
    channel: Literal["stdout", "stderr", "exit", "control"]
    payload: str  # Raw NDJSON line or control JSON
    instance_id: str = ""
    timestamp: float = field(default_factory=time.time)
    
    def to_dict(self) -> dict:
        return {
            "runId": self.run_id,
            "channel": self.channel,
            "payload": self.payload,
            "instanceId": self.instance_id,
            "timestamp": self.timestamp,
        }

class EventRelay(ABC):
    """Abstract interface for run event relay (inspired by n8n Push abstraction)."""
    
    @abstractmethod
    async def connect(self) -> None:
        """Initialize connection to relay backend."""
        pass
    
    @abstractmethod
    async def disconnect(self) -> None:
        """Clean up connection."""
        pass
    
    @abstractmethod
    async def publish(self, message: RelayMessage) -> int:
        """Publish message to relay. Returns number of subscribers reached."""
        pass
    
    @abstractmethod
    async def subscribe(self, run_id: str) -> AsyncIterator[RelayMessage]:
        """Subscribe to messages for a specific run."""
        pass
    
    @abstractmethod
    async def unsubscribe(self, run_id: str) -> None:
        """Unsubscribe from a run's messages."""
        pass
    
    @property
    @abstractmethod
    def is_distributed(self) -> bool:
        """True if relay supports multi-instance (e.g., Redis)."""
        pass
```

- [ ] **Step 2: Write basic interface test**

```python
# test_relay_base.py
import pytest

def test_relay_base_imports():
    from graph_caster.run_broker.relay import EventRelay, RelayMessage
    assert hasattr(EventRelay, "connect")
    assert hasattr(EventRelay, "publish")
    assert hasattr(EventRelay, "subscribe")
    assert hasattr(RelayMessage, "to_dict")

def test_relay_message_to_dict():
    from graph_caster.run_broker.relay import RelayMessage
    msg = RelayMessage(run_id="r1", channel="stdout", payload="test")
    d = msg.to_dict()
    assert d["runId"] == "r1"
    assert d["channel"] == "stdout"
    assert d["payload"] == "test"

def test_relay_message_defaults():
    from graph_caster.run_broker.relay import RelayMessage
    msg = RelayMessage(run_id="r1", channel="stdout", payload="test")
    assert msg.instance_id == ""
    assert msg.timestamp > 0
```

- [ ] **Step 3: Run test to verify interface is importable**

```bash
pytest python/tests/test_relay_base.py -v
```
Expected: PASSED

- [ ] **Step 4: Commit**

```bash
git add python/graph_caster/run_broker/relay/
git commit -m "feat(relay): add abstract EventRelay interface for pluggable backends"
```

---

## Task 2: In-Memory Relay Implementation

**Files:**
- Create: `python/graph_caster/run_broker/relay/memory.py`
- Test: `python/tests/test_relay_memory.py`

- [ ] **Step 1: Write failing test**

```python
# test_relay_memory.py
import pytest
import asyncio
from graph_caster.run_broker.relay import MemoryRelay, RelayMessage

@pytest.mark.asyncio
async def test_memory_relay_publish_subscribe():
    relay = MemoryRelay()
    await relay.connect()
    
    received = []
    
    async def subscriber():
        async for msg in relay.subscribe("run-123"):
            received.append(msg)
            if len(received) >= 2:
                break
    
    sub_task = asyncio.create_task(subscriber())
    await asyncio.sleep(0.01)  # Let subscriber start
    
    await relay.publish(RelayMessage(
        run_id="run-123",
        channel="stdout",
        payload='{"type":"node_enter","nodeId":"n1"}'
    ))
    await relay.publish(RelayMessage(
        run_id="run-123",
        channel="stdout",
        payload='{"type":"node_exit","nodeId":"n1"}'
    ))
    
    await asyncio.wait_for(sub_task, timeout=1.0)
    
    assert len(received) == 2
    assert received[0].payload == '{"type":"node_enter","nodeId":"n1"}'
    await relay.disconnect()

@pytest.mark.asyncio
async def test_memory_relay_isolates_runs():
    relay = MemoryRelay()
    await relay.connect()
    
    received_123 = []
    received_456 = []
    
    async def sub_123():
        async for msg in relay.subscribe("run-123"):
            received_123.append(msg)
            break
    
    async def sub_456():
        async for msg in relay.subscribe("run-456"):
            received_456.append(msg)
            break
    
    task_123 = asyncio.create_task(sub_123())
    task_456 = asyncio.create_task(sub_456())
    await asyncio.sleep(0.01)
    
    await relay.publish(RelayMessage(run_id="run-123", channel="stdout", payload="a"))
    await relay.publish(RelayMessage(run_id="run-456", channel="stdout", payload="b"))
    
    await asyncio.gather(task_123, task_456)
    
    assert len(received_123) == 1
    assert received_123[0].payload == "a"
    assert len(received_456) == 1
    assert received_456[0].payload == "b"
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest python/tests/test_relay_memory.py -v
```
Expected: ImportError or test failure

- [ ] **Step 3: Implement MemoryRelay**

```python
# memory.py
import asyncio
from collections import defaultdict
from typing import AsyncIterator
from .base import EventRelay, RelayMessage

class MemoryRelay(EventRelay):
    """In-memory relay for single-instance deployments."""
    
    def __init__(self, queue_maxsize: int = 1000):
        self._subscribers: dict[str, list[asyncio.Queue[RelayMessage | None]]] = defaultdict(list)
        self._queue_maxsize = queue_maxsize
        self._connected = False
    
    async def connect(self) -> None:
        self._connected = True
    
    async def disconnect(self) -> None:
        # Signal all subscribers to stop
        for run_id, queues in self._subscribers.items():
            for q in queues:
                try:
                    q.put_nowait(None)
                except asyncio.QueueFull:
                    pass
        self._subscribers.clear()
        self._connected = False
    
    async def publish(self, message: RelayMessage) -> int:
        queues = self._subscribers.get(message.run_id, [])
        delivered = 0
        for q in queues:
            try:
                q.put_nowait(message)
                delivered += 1
            except asyncio.QueueFull:
                # Drop message for slow subscriber
                pass
        return delivered
    
    async def subscribe(self, run_id: str) -> AsyncIterator[RelayMessage]:
        queue: asyncio.Queue[RelayMessage | None] = asyncio.Queue(maxsize=self._queue_maxsize)
        self._subscribers[run_id].append(queue)
        try:
            while True:
                msg = await queue.get()
                if msg is None:
                    break
                yield msg
        finally:
            self._subscribers[run_id].remove(queue)
            if not self._subscribers[run_id]:
                del self._subscribers[run_id]
    
    async def unsubscribe(self, run_id: str) -> None:
        queues = self._subscribers.pop(run_id, [])
        for q in queues:
            try:
                q.put_nowait(None)
            except asyncio.QueueFull:
                pass
    
    @property
    def is_distributed(self) -> bool:
        return False
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest python/tests/test_relay_memory.py -v
```
Expected: PASSED

- [ ] **Step 5: Commit**

```bash
git add python/graph_caster/run_broker/relay/memory.py python/tests/test_relay_memory.py
git commit -m "feat(relay): implement in-memory relay for single-instance mode"
```

---

## Task 3: Redis Relay Implementation

**Files:**
- Create: `python/graph_caster/run_broker/relay/redis_relay.py`
- Test: `python/tests/test_relay_redis.py`

- [ ] **Step 1: Write failing test**

```python
# test_relay_redis.py
import pytest
import asyncio
import os

# Skip if no Redis available
REDIS_URL = os.environ.get("GC_TEST_REDIS_URL", "redis://localhost:6379")

@pytest.fixture
async def redis_relay():
    from graph_caster.run_broker.relay import RedisRelay
    relay = RedisRelay(redis_url=REDIS_URL, channel_prefix="gc:test:")
    await relay.connect()
    yield relay
    await relay.disconnect()

@pytest.mark.asyncio
@pytest.mark.skipif(not os.environ.get("GC_TEST_REDIS_URL"), reason="No Redis URL")
async def test_redis_relay_publish_subscribe(redis_relay):
    from graph_caster.run_broker.relay import RelayMessage
    
    received = []
    
    async def subscriber():
        async for msg in redis_relay.subscribe("run-redis-test"):
            received.append(msg)
            if len(received) >= 2:
                break
    
    sub_task = asyncio.create_task(subscriber())
    await asyncio.sleep(0.1)  # Redis needs time to subscribe
    
    await redis_relay.publish(RelayMessage(
        run_id="run-redis-test",
        channel="stdout",
        payload='{"type":"node_enter"}',
        instance_id="instance-1"
    ))
    await redis_relay.publish(RelayMessage(
        run_id="run-redis-test",
        channel="stdout",
        payload='{"type":"node_exit"}',
        instance_id="instance-1"
    ))
    
    await asyncio.wait_for(sub_task, timeout=5.0)
    
    assert len(received) == 2
    assert received[0].instance_id == "instance-1"

@pytest.mark.asyncio
@pytest.mark.skipif(not os.environ.get("GC_TEST_REDIS_URL"), reason="No Redis URL")
async def test_redis_relay_cross_instance(redis_relay):
    """Test that messages from one instance reach subscribers on another."""
    from graph_caster.run_broker.relay import RedisRelay, RelayMessage
    
    # Create second relay (simulating another instance)
    relay2 = RedisRelay(redis_url=REDIS_URL, channel_prefix="gc:test:")
    await relay2.connect()
    
    received = []
    
    async def subscriber():
        async for msg in relay2.subscribe("run-cross"):
            received.append(msg)
            break
    
    sub_task = asyncio.create_task(subscriber())
    await asyncio.sleep(0.1)
    
    # Publish from first instance
    await redis_relay.publish(RelayMessage(
        run_id="run-cross",
        channel="stdout",
        payload='{"type":"test"}',
        instance_id="instance-1"
    ))
    
    await asyncio.wait_for(sub_task, timeout=5.0)
    
    assert len(received) == 1
    assert received[0].instance_id == "instance-1"
    
    await relay2.disconnect()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
GC_TEST_REDIS_URL=redis://localhost:6379 pytest python/tests/test_relay_redis.py -v
```

- [ ] **Step 3: Implement RedisRelay**

```python
# redis_relay.py
import asyncio
import json
import uuid
from typing import AsyncIterator
import redis.asyncio as redis
from .base import EventRelay, RelayMessage

class RedisRelay(EventRelay):
    """Redis pub/sub relay for multi-instance deployments.
    
    Pattern inspired by n8n's packages/cli/src/scaling/pubsub/publisher.service.ts
    and Flowise's packages/server/src/queue/RedisEventPublisher.ts.
    """
    
    def __init__(
        self,
        redis_url: str,
        channel_prefix: str = "gc:run:",
        instance_id: str | None = None,
    ):
        self.redis_url = redis_url
        self.channel_prefix = channel_prefix
        self.instance_id = instance_id or str(uuid.uuid4())[:8]
        self._client: redis.Redis | None = None
        self._pubsub_clients: dict[str, redis.client.PubSub] = {}
    
    async def connect(self) -> None:
        self._client = redis.from_url(self.redis_url, decode_responses=True)
        # Verify connection
        await self._client.ping()
    
    async def disconnect(self) -> None:
        # Close all pubsub connections
        for pubsub in self._pubsub_clients.values():
            await pubsub.close()
        self._pubsub_clients.clear()
        
        if self._client:
            await self._client.close()
            self._client = None
    
    def _channel_name(self, run_id: str) -> str:
        return f"{self.channel_prefix}{run_id}"
    
    async def publish(self, message: RelayMessage) -> int:
        if not self._client:
            raise RuntimeError("Not connected")
        
        # Ensure instance_id is set
        if not message.instance_id:
            message.instance_id = self.instance_id
        
        channel = self._channel_name(message.run_id)
        payload = json.dumps(message.to_dict())
        
        return await self._client.publish(channel, payload)
    
    async def subscribe(self, run_id: str) -> AsyncIterator[RelayMessage]:
        if not self._client:
            raise RuntimeError("Not connected")
        
        channel = self._channel_name(run_id)
        pubsub = self._client.pubsub()
        await pubsub.subscribe(channel)
        self._pubsub_clients[run_id] = pubsub
        
        try:
            async for message in pubsub.listen():
                if message["type"] == "message":
                    data = json.loads(message["data"])
                    yield RelayMessage(
                        run_id=data["runId"],
                        channel=data["channel"],
                        payload=data["payload"],
                        instance_id=data.get("instanceId", ""),
                        timestamp=data.get("timestamp", 0),
                    )
        finally:
            await pubsub.unsubscribe(channel)
            await pubsub.close()
            self._pubsub_clients.pop(run_id, None)
    
    async def unsubscribe(self, run_id: str) -> None:
        pubsub = self._pubsub_clients.pop(run_id, None)
        if pubsub:
            await pubsub.unsubscribe(self._channel_name(run_id))
            await pubsub.close()
    
    @property
    def is_distributed(self) -> bool:
        return True
```

- [ ] **Step 4: Run test to verify it passes**

```bash
GC_TEST_REDIS_URL=redis://localhost:6379 pytest python/tests/test_relay_redis.py -v
```

- [ ] **Step 5: Add to __init__.py**

```python
# __init__.py
from .base import EventRelay, RelayMessage
from .memory import MemoryRelay

# Optional Redis import
try:
    from .redis_relay import RedisRelay
except ImportError:
    RedisRelay = None  # type: ignore

__all__ = ["EventRelay", "RelayMessage", "MemoryRelay", "RedisRelay"]
```

- [ ] **Step 6: Commit**

```bash
git add python/graph_caster/run_broker/relay/redis_relay.py python/tests/test_relay_redis.py
git commit -m "feat(relay): implement Redis pub/sub relay for multi-instance scaling (§39)"
```

---

## Task 4: Heartbeat Manager

**Files:**
- Create: `python/graph_caster/run_broker/heartbeat.py`
- Test: `python/tests/test_heartbeat.py`

- [ ] **Step 1: Write failing test**

```python
# test_heartbeat.py
import pytest
import asyncio
from graph_caster.run_broker.heartbeat import HeartbeatManager

@pytest.mark.asyncio
async def test_heartbeat_sends_pings():
    pings_sent = []
    
    async def send_ping():
        pings_sent.append(asyncio.get_event_loop().time())
    
    hb = HeartbeatManager(interval_sec=0.1, send_ping=send_ping)
    await hb.start()
    
    await asyncio.sleep(0.35)
    
    await hb.stop()
    
    # Should have sent ~3 pings in 0.35 seconds at 0.1 interval
    assert len(pings_sent) >= 2
    assert len(pings_sent) <= 4

@pytest.mark.asyncio
async def test_heartbeat_stops_cleanly():
    calls = []
    
    async def send_ping():
        calls.append(1)
    
    hb = HeartbeatManager(interval_sec=0.05, send_ping=send_ping)
    await hb.start()
    await asyncio.sleep(0.12)
    await hb.stop()
    
    count_at_stop = len(calls)
    await asyncio.sleep(0.1)
    
    # No more pings after stop
    assert len(calls) == count_at_stop
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest python/tests/test_heartbeat.py -v
```

- [ ] **Step 3: Implement HeartbeatManager**

```python
# heartbeat.py
import asyncio
from typing import Callable, Awaitable

class HeartbeatManager:
    """Manages periodic heartbeat/ping for WebSocket and SSE connections.
    
    Pattern from n8n: ~60s keepalive for nginx proxy compatibility.
    """
    
    def __init__(
        self,
        interval_sec: float = 60.0,
        send_ping: Callable[[], Awaitable[None]] | None = None,
    ):
        self.interval_sec = interval_sec
        self._send_ping = send_ping
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
    
    async def start(self) -> None:
        """Start heartbeat loop."""
        if self._task is not None:
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._ping_loop())
    
    async def stop(self) -> None:
        """Stop heartbeat loop."""
        if self._task is None:
            return
        self._stop_event.set()
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None
    
    async def _ping_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=self.interval_sec
                )
                # Event was set, exit
                break
            except asyncio.TimeoutError:
                # Timeout = time to send ping
                if self._send_ping:
                    try:
                        await self._send_ping()
                    except Exception:
                        # Log but don't crash heartbeat
                        pass
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest python/tests/test_heartbeat.py -v
```

- [ ] **Step 5: Commit**

```bash
git add python/graph_caster/run_broker/heartbeat.py python/tests/test_heartbeat.py
git commit -m "feat(broker): add heartbeat manager for nginx proxy compatibility"
```

---

## Task 5: Priority-Aware Bounded Queue

**Files:**
- Create: `python/graph_caster/run_broker/bounded_queue.py`
- Test: `python/tests/test_bounded_queue.py`

- [ ] **Step 1: Write failing test**

```python
# test_bounded_queue.py
import pytest
import asyncio
from graph_caster.run_broker.bounded_queue import PriorityBoundedQueue, MessagePriority

@pytest.mark.asyncio
async def test_priority_queue_orders_correctly():
    q = PriorityBoundedQueue(maxsize=10)
    
    await q.put("low", MessagePriority.LOW)
    await q.put("high", MessagePriority.HIGH)
    await q.put("critical", MessagePriority.CRITICAL)
    await q.put("normal", MessagePriority.NORMAL)
    
    results = []
    while not q.empty():
        results.append(await q.get())
    
    # Critical > High > Normal > Low
    assert results == ["critical", "high", "normal", "low"]

@pytest.mark.asyncio
async def test_bounded_queue_drops_low_priority_when_full():
    q = PriorityBoundedQueue(maxsize=3)
    
    await q.put("critical1", MessagePriority.CRITICAL)
    await q.put("normal1", MessagePriority.NORMAL)
    await q.put("low1", MessagePriority.LOW)
    
    # Queue is full, try to add more
    dropped = await q.try_put("low2", MessagePriority.LOW)
    assert dropped is True  # Low priority was dropped
    
    dropped = await q.try_put("critical2", MessagePriority.CRITICAL)
    assert dropped is False  # Critical got in (kicked out low)
    
    results = []
    while not q.empty():
        results.append(await q.get())
    
    # Should have critical1, critical2, normal1 (low1 was evicted)
    assert "critical1" in results
    assert "critical2" in results
    assert "normal1" in results
    assert "low1" not in results
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pytest python/tests/test_bounded_queue.py -v
```

- [ ] **Step 3: Implement PriorityBoundedQueue**

```python
# bounded_queue.py
import asyncio
import heapq
from dataclasses import dataclass, field
from enum import IntEnum
from typing import TypeVar, Generic

class MessagePriority(IntEnum):
    """Message priority levels (lower number = higher priority)."""
    CRITICAL = 0  # run_started, run_finished
    HIGH = 1      # node_enter, node_exit, error
    NORMAL = 2    # process_complete, branch_taken
    LOW = 3       # process_output (droppable)

T = TypeVar('T')

@dataclass(order=True)
class _PriorityItem(Generic[T]):
    priority: int
    sequence: int
    item: T = field(compare=False)

class PriorityBoundedQueue(Generic[T]):
    """Bounded queue with priority-aware eviction.
    
    When full, drops lowest priority items first.
    Pattern inspired by Dify's AppQueueManager.
    """
    
    def __init__(self, maxsize: int = 1000):
        self.maxsize = maxsize
        self._heap: list[_PriorityItem[T]] = []
        self._sequence = 0
        self._lock = asyncio.Lock()
        self._not_empty = asyncio.Event()
        self._dropped_count = 0
    
    @property
    def dropped_count(self) -> int:
        return self._dropped_count
    
    def empty(self) -> bool:
        return len(self._heap) == 0
    
    def full(self) -> bool:
        return len(self._heap) >= self.maxsize
    
    async def put(self, item: T, priority: MessagePriority) -> None:
        """Put item, blocking if necessary to make room."""
        async with self._lock:
            await self._make_room_for(priority)
            self._enqueue(item, priority)
    
    async def try_put(self, item: T, priority: MessagePriority) -> bool:
        """Try to put item, returning True if dropped."""
        async with self._lock:
            if self.full():
                # Check if we can evict something lower priority
                if self._heap and self._heap[-1].priority > priority.value:
                    # Evict lowest priority item
                    self._heap.pop()
                    self._dropped_count += 1
                    self._enqueue(item, priority)
                    return False
                else:
                    # Can't fit, drop this item
                    self._dropped_count += 1
                    return True
            else:
                self._enqueue(item, priority)
                return False
    
    def _enqueue(self, item: T, priority: MessagePriority) -> None:
        self._sequence += 1
        heapq.heappush(self._heap, _PriorityItem(priority.value, self._sequence, item))
        self._not_empty.set()
    
    async def _make_room_for(self, priority: MessagePriority) -> None:
        """Evict items if necessary to make room for this priority."""
        while self.full():
            # Find and remove lowest priority item if lower than incoming
            if self._heap:
                # Heap is min-heap by priority, so we need to find max
                # Re-heapify to get proper ordering for eviction
                self._heap.sort(key=lambda x: (-x.priority, x.sequence))
                if self._heap[-1].priority > priority.value:
                    self._heap.pop()
                    self._dropped_count += 1
                    heapq.heapify(self._heap)
                else:
                    # Wait for space
                    await asyncio.sleep(0.001)
                    break
            else:
                break
    
    async def get(self) -> T:
        """Get highest priority item."""
        while True:
            async with self._lock:
                if self._heap:
                    item = heapq.heappop(self._heap)
                    if not self._heap:
                        self._not_empty.clear()
                    return item.item
            await self._not_empty.wait()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pytest python/tests/test_bounded_queue.py -v
```

- [ ] **Step 5: Commit**

```bash
git add python/graph_caster/run_broker/bounded_queue.py python/tests/test_bounded_queue.py
git commit -m "feat(broker): add priority-aware bounded queue for backpressure"
```

---

## Task 6: Integrate Relay into Broadcaster

**Files:**
- Modify: `python/graph_caster/run_broker/broadcaster.py`
- Modify: `python/graph_caster/run_broker/__init__.py`
- Test: `python/tests/test_broadcaster_relay.py`

- [ ] **Step 1: Write integration test**

```python
# test_broadcaster_relay.py
import pytest
import asyncio
from graph_caster.run_broker.broadcaster import RunBroadcaster
from graph_caster.run_broker.relay import MemoryRelay

@pytest.mark.asyncio
async def test_broadcaster_uses_relay():
    relay = MemoryRelay()
    await relay.connect()
    
    broadcaster = RunBroadcaster(relay=relay)
    
    # Subscribe to run
    received = []
    async def collect():
        async for msg in broadcaster.subscribe("run-123"):
            received.append(msg)
            if len(received) >= 1:
                break
    
    task = asyncio.create_task(collect())
    await asyncio.sleep(0.01)
    
    # Broadcast event
    await broadcaster.broadcast("run-123", "stdout", '{"type":"test"}')
    
    await asyncio.wait_for(task, timeout=1.0)
    
    assert len(received) == 1
    assert received[0].payload == '{"type":"test"}'
    
    await relay.disconnect()
```

- [ ] **Step 2: Modify broadcaster to use relay**

```python
# In broadcaster.py, add relay integration:

class RunBroadcaster:
    def __init__(
        self,
        relay: EventRelay | None = None,
        config: RunBroadcasterConfig | None = None,
    ):
        self._relay = relay or MemoryRelay()
        self._config = config or RunBroadcasterConfig()
        # ... existing init
    
    async def broadcast(
        self,
        run_id: str,
        channel: str,
        payload: str,
    ) -> int:
        message = RelayMessage(
            run_id=run_id,
            channel=channel,
            payload=payload,
        )
        return await self._relay.publish(message)
    
    async def subscribe(self, run_id: str) -> AsyncIterator[RelayMessage]:
        async for msg in self._relay.subscribe(run_id):
            yield msg
```

- [ ] **Step 3: Add factory function**

```python
# In __init__.py or config.py
import os

def create_relay() -> EventRelay:
    """Create appropriate relay based on environment."""
    redis_url = os.environ.get("GC_RUN_BROKER_REDIS_URL")
    if redis_url:
        from .relay import RedisRelay
        return RedisRelay(redis_url=redis_url)
    else:
        from .relay import MemoryRelay
        return MemoryRelay()
```

- [ ] **Step 4: Tests pass**

```bash
pytest python/tests/test_broadcaster_relay.py -v
```

- [ ] **Step 5: Update app.py to use factory**

- [ ] **Step 6: Commit**

```bash
git add python/graph_caster/run_broker/
git commit -m "feat(broker): integrate relay abstraction into broadcaster"
```

---

## Task 7: WebSocket Heartbeat Integration

**Files:**
- Modify: `python/graph_caster/run_broker/routes/ws.py`
- Test: `python/tests/test_ws_heartbeat.py`

- [ ] **Step 1: Write integration test**

```python
# test_ws_heartbeat.py
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock
from graph_caster.run_broker.heartbeat import HeartbeatManager

@pytest.mark.asyncio
async def test_heartbeat_integration_with_ws():
    """Test that heartbeat sends pings via WebSocket-like interface."""
    ping_messages = []
    
    async def mock_send_json(data):
        ping_messages.append(data)
    
    ws_mock = MagicMock()
    ws_mock.send_json = mock_send_json
    
    async def send_ping():
        await ws_mock.send_json({"channel": "ping"})
    
    heartbeat = HeartbeatManager(interval_sec=0.05, send_ping=send_ping)
    await heartbeat.start()
    
    await asyncio.sleep(0.15)
    await heartbeat.stop()
    
    # Should have sent multiple pings
    assert len(ping_messages) >= 2
    assert all(msg["channel"] == "ping" for msg in ping_messages)

@pytest.mark.asyncio
async def test_heartbeat_handles_send_error():
    """Test that heartbeat continues even if send fails."""
    call_count = 0
    
    async def failing_send():
        nonlocal call_count
        call_count += 1
        if call_count < 2:
            raise ConnectionError("Simulated error")
    
    heartbeat = HeartbeatManager(interval_sec=0.05, send_ping=failing_send)
    await heartbeat.start()
    
    await asyncio.sleep(0.15)
    await heartbeat.stop()
    
    # Should have tried multiple times despite errors
    assert call_count >= 2
```

- [ ] **Step 2: Integrate heartbeat into WS handler**

```python
# In ws.py

@router.websocket("/runs/{run_id}/ws")
async def run_websocket(websocket: WebSocket, run_id: str):
    await websocket.accept()
    
    async def send_ping():
        await websocket.send_json({"channel": "ping"})
    
    heartbeat = HeartbeatManager(
        interval_sec=float(os.environ.get("GC_WS_HEARTBEAT_SEC", "60")),
        send_ping=send_ping
    )
    await heartbeat.start()
    
    try:
        # ... existing WS logic
        pass
    finally:
        await heartbeat.stop()
```

- [ ] **Step 3: Tests pass**

- [ ] **Step 4: Update documentation**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ws): add heartbeat for nginx proxy compatibility"
```

---

## Task 8: Documentation and Environment Variables

**Files:**
- Modify: `python/README.md`
- Modify: `doc/RUN_EVENT_TRANSPORT.md`

- [ ] **Step 1: Document new environment variables**

```markdown
## Production Transport (§39)

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GC_RUN_BROKER_REDIS_URL` | (none) | Redis URL for multi-instance relay |
| `GC_WS_HEARTBEAT_SEC` | 60 | WebSocket ping interval |
| `GC_RUN_BROKER_QUEUE_MAXSIZE` | 8192 | Max queue size per subscriber |
| `GC_RELAY_CHANNEL_PREFIX` | gc:run: | Redis channel prefix |

### Multi-Instance Deployment

With Redis relay enabled, multiple `graph_caster serve` instances can share event streams:

```bash
# Instance 1
GC_RUN_BROKER_REDIS_URL=redis://localhost:6379 python -m graph_caster serve

# Instance 2
GC_RUN_BROKER_REDIS_URL=redis://localhost:6379 python -m graph_caster serve --port 8081
```

Runs started on Instance 1 can be subscribed from Instance 2.
```

- [ ] **Step 2: Update RUN_EVENT_TRANSPORT.md**

- [ ] **Step 3: Commit**

```bash
git commit -m "docs: add production transport configuration (§39)"
```

---

## Success Criteria

- [ ] `pytest python/tests/test_relay_*.py` — all pass
- [ ] `pytest python/tests/test_heartbeat.py` — passes
- [ ] `pytest python/tests/test_bounded_queue.py` — passes
- [ ] `pytest python/tests/test_broadcaster_relay.py` — passes
- [ ] Load test: 50 concurrent WebSocket subscribers, no message loss for critical events
- [ ] Integration test: Two `serve` instances with Redis relay, events propagate correctly
- [ ] Nginx proxy: WebSocket stays connected for 5+ minutes with heartbeat

---

## Dependencies

Add to `pyproject.toml`:

```toml
[project.optional-dependencies]
redis = ["redis>=5.0"]
```
