# GraphCaster — Detailed Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans** to implement this plan **task-by-task**. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Детальная архитектурная спецификация ключевых подсистем с референсами на лучшие решения конкурентов.

**Architecture:** Микросервисная архитектура внутри монолита с чёткими границами модулей.

**Tech Stack:** Python 3.11+, asyncio, Starlette, Redis, SQLite, React/TypeScript.

---

## Architecture Decision Records

### ADR-001: Event Transport Architecture

**Context:** Необходимо масштабируемая доставка событий от воркеров к UI клиентам.

**Decision:** Adopt Flowise pattern — `IServerSideEventStreamer` interface with in-process `SSEStreamer` and distributed `RedisEventPublisher`.

**Consequences:**
- Единый интерфейс для in-process и distributed режимов
- Redis pub/sub по `runId` как канал
- Graceful fallback при недоступности Redis

**Reference:** `Flowise-main/packages/server/src/utils/SSEStreamer.ts`, `queue/RedisEventPublisher.ts`

---

### ADR-002: Execution Engine Architecture

**Context:** Текущий `GraphRunner` однопоточный. Нужен параллелизм внутри прогона.

**Decision:** Adopt Dify `GraphEngine` pattern — ready queue + worker pool + dispatcher.

**Consequences:**
- `ReadyQueue` — thread-safe очередь нод готовых к исполнению
- `WorkerPool` — min/max workers, auto-scaling по глубине очереди
- `Dispatcher` — отдельный thread для drain event queue и edge processing
- `ExecutionCoordinator` — glue для completion, abort, pause

**Reference:** `dify-main/api/graphon/graph_engine/graph_engine.py`

---

### ADR-003: Expression Engine Architecture

**Context:** Текущие условия ограничены JSON Logic + mustache. Нужен безопасный expression runtime.

**Decision:** Adopt n8n pattern — AST parser + sandbox evaluator, без `eval()`.

**Consequences:**
- `@n8n/tournament`-style AST transformation
- Sandbox с timeout и memory limits
- Функции из allowlist, не произвольный код

**Reference:** `n8n-master/packages/@n8n/expression-runtime`

---

## Module: Event Transport (`run_broker/relay/`)

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Event Flow                              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐    ┌───────────────┐    ┌──────────────────┐ │
│  │  Runner  │───▶│  RunEventSink │───▶│  EventPublisher  │ │
│  └──────────┘    └───────────────┘    └────────┬─────────┘ │
│                                                 │           │
│                         ┌───────────────────────┼───────────┤
│                         │                       │           │
│                         ▼                       ▼           │
│               ┌─────────────────┐    ┌─────────────────────┐│
│               │  DirectPublisher │   │   RedisPublisher    ││
│               │  (in-process)    │   │   (distributed)     ││
│               └────────┬────────┘    └──────────┬──────────┘│
│                        │                        │           │
│                        ▼                        ▼           │
│               ┌─────────────────┐    ┌─────────────────────┐│
│               │  SSE/WS Handler │◀───│   RedisSubscriber   ││
│               └────────┬────────┘    └─────────────────────┘│
│                        │                                    │
│                        ▼                                    │
│               ┌─────────────────┐                           │
│               │   Browser UI    │                           │
│               └─────────────────┘                           │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

**File: `python/graph_caster/run_broker/relay/publisher.py`**

```python
from abc import ABC, abstractmethod
from typing import Protocol
from dataclasses import dataclass

@dataclass
class EventMessage:
    run_id: str
    channel: str  # 'stdout' | 'stderr' | 'exit'
    payload: dict | str | int

class EventPublisher(Protocol):
    """Interface matching Flowise IServerSideEventStreamer pattern."""
    
    async def publish(self, run_id: str, event: EventMessage) -> None:
        """Publish event to subscribers of run_id."""
        ...
    
    async def close(self, run_id: str) -> None:
        """Close channel for run_id."""
        ...

class DirectPublisher:
    """In-process publisher for single-instance mode."""
    
    def __init__(self, broadcaster: 'RunBroadcaster'):
        self._broadcaster = broadcaster
    
    async def publish(self, run_id: str, event: EventMessage) -> None:
        await self._broadcaster.broadcast(run_id, event)
    
    async def close(self, run_id: str) -> None:
        await self._broadcaster.close_run(run_id)

class RedisPublisher:
    """Distributed publisher using Redis pub/sub."""
    
    def __init__(self, redis_url: str, channel_prefix: str = 'gc:run:'):
        self._redis_url = redis_url
        self._prefix = channel_prefix
        self._client: redis.asyncio.Redis | None = None
    
    async def connect(self) -> None:
        import redis.asyncio as redis
        self._client = redis.from_url(self._redis_url)
    
    async def publish(self, run_id: str, event: EventMessage) -> None:
        if self._client is None:
            await self.connect()
        channel = f"{self._prefix}{run_id}:events"
        await self._client.publish(channel, json.dumps(asdict(event)))
    
    async def close(self, run_id: str) -> None:
        # Publish sentinel
        await self.publish(run_id, EventMessage(
            run_id=run_id,
            channel='exit',
            payload={'code': 0}
        ))
```

---

## Module: Execution Engine (`execution/`)

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Execution Engine                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                   GraphEngine                           │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │ │
│  │  │ ReadyQueue   │  │  WorkerPool  │  │  Dispatcher  │  │ │
│  │  │              │  │              │  │              │  │ │
│  │  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │  │ │
│  │  │ │ node_id  │ │  │ │ Worker 1 │ │  │ │EventQueue│ │  │ │
│  │  │ │ node_id  │◀┼──┼▶│ Worker 2 │─┼──┼▶│          │ │  │ │
│  │  │ │ node_id  │ │  │ │ Worker N │ │  │ │          │ │  │ │
│  │  │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │  │ │
│  │  └──────────────┘  └──────────────┘  └──────┬───────┘  │ │
│  │                                             │          │ │
│  │  ┌──────────────────────────────────────────▼────────┐ │ │
│  │  │              ExecutionCoordinator                  │ │ │
│  │  │  - Edge processing                                 │ │ │
│  │  │  - State management                                │ │ │
│  │  │  - Completion detection                            │ │ │
│  │  └────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

**File: `python/graph_caster/execution/engine.py`**

```python
from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor
from queue import Queue, Empty
from threading import Event, Lock
from typing import Generator, Callable
import time

@dataclass
class EngineConfig:
    min_workers: int = 2
    max_workers: int = 8
    scale_up_threshold: int = 5
    scale_down_idle_time: float = 30.0

@dataclass
class NodeResult:
    node_id: str
    success: bool
    outputs: dict
    error: str | None = None
    duration_ms: float = 0

class ReadyQueue:
    """Thread-safe queue of nodes ready for execution."""
    
    def __init__(self, maxsize: int = 0):
        self._queue: Queue[str] = Queue(maxsize=maxsize)
        self._lock = Lock()
    
    def put(self, node_id: str) -> None:
        self._queue.put(node_id)
    
    def get(self, timeout: float = 1.0) -> str | None:
        try:
            return self._queue.get(timeout=timeout)
        except Empty:
            return None
    
    def qsize(self) -> int:
        return self._queue.qsize()

class WorkerPool:
    """Dynamic pool of worker threads (Dify pattern)."""
    
    def __init__(
        self,
        config: EngineConfig,
        ready_queue: ReadyQueue,
        event_queue: Queue,
        execute_fn: Callable[[str], NodeResult],
    ):
        self._config = config
        self._ready_queue = ready_queue
        self._event_queue = event_queue
        self._execute_fn = execute_fn
        self._workers: list[Worker] = []
        self._stop_event = Event()
        self._lock = Lock()
    
    def start(self) -> None:
        """Start min_workers workers."""
        for _ in range(self._config.min_workers):
            self._add_worker()
    
    def stop(self) -> None:
        """Stop all workers gracefully."""
        self._stop_event.set()
        for w in self._workers:
            w.join(timeout=5.0)
    
    def check_and_scale(self) -> None:
        """Scale up/down based on queue depth."""
        with self._lock:
            queue_depth = self._ready_queue.qsize()
            active = len([w for w in self._workers if w.is_busy])
            
            # Scale up
            if (queue_depth > self._config.scale_up_threshold 
                and len(self._workers) < self._config.max_workers):
                self._add_worker()
            
            # Scale down (idle workers)
            idle_workers = [
                w for w in self._workers 
                if not w.is_busy 
                and w.idle_time > self._config.scale_down_idle_time
            ]
            while (len(self._workers) > self._config.min_workers 
                   and idle_workers):
                w = idle_workers.pop()
                w.stop()
                self._workers.remove(w)
    
    def _add_worker(self) -> None:
        w = Worker(
            self._ready_queue,
            self._event_queue,
            self._execute_fn,
            self._stop_event,
        )
        w.start()
        self._workers.append(w)

class GraphEngine:
    """Main execution engine (Dify GraphEngine pattern)."""
    
    def __init__(
        self,
        graph: 'GraphDocument',
        config: EngineConfig | None = None,
        event_sink: 'RunEventSink' | None = None,
    ):
        self._graph = graph
        self._config = config or EngineConfig()
        self._sink = event_sink
        self._ready_queue = ReadyQueue()
        self._event_queue: Queue[NodeResult] = Queue()
        self._state = GraphRuntimeState()
        self._coordinator: ExecutionCoordinator | None = None
        self._pool: WorkerPool | None = None
    
    def run(self) -> Generator['GraphEngineEvent', None, None]:
        """Execute graph and yield events."""
        try:
            self._start_execution()
            yield from self._process_events()
        finally:
            self._cleanup()
    
    def _start_execution(self) -> None:
        # Initialize
        self._coordinator = ExecutionCoordinator(
            self._graph,
            self._ready_queue,
            self._event_queue,
            self._state,
        )
        self._pool = WorkerPool(
            self._config,
            self._ready_queue,
            self._event_queue,
            self._execute_node,
        )
        
        # Start worker pool
        self._pool.start()
        
        # Enqueue root node
        root = self._graph.get_start_node()
        self._ready_queue.put(root.id)
    
    def _process_events(self) -> Generator['GraphEngineEvent', None, None]:
        """Main event loop."""
        while not self._coordinator.is_complete():
            # Check scaling
            self._pool.check_and_scale()
            
            # Process completed nodes
            try:
                result = self._event_queue.get(timeout=0.1)
                yield from self._coordinator.handle_node_result(result)
            except Empty:
                continue
    
    def _execute_node(self, node_id: str) -> NodeResult:
        """Execute single node (called by workers)."""
        node = self._graph.get_node(node_id)
        start = time.perf_counter()
        
        try:
            outputs = self._run_node(node)
            return NodeResult(
                node_id=node_id,
                success=True,
                outputs=outputs,
                duration_ms=(time.perf_counter() - start) * 1000,
            )
        except Exception as e:
            return NodeResult(
                node_id=node_id,
                success=False,
                outputs={},
                error=str(e),
                duration_ms=(time.perf_counter() - start) * 1000,
            )
    
    def _cleanup(self) -> None:
        if self._pool:
            self._pool.stop()
```

---

## Module: Expression Engine (`expressions/`)

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Expression Pipeline                        │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   Input: "{{ $json.name.toUpperCase() }}"                   │
│                    │                                         │
│                    ▼                                         │
│   ┌────────────────────────────────────────────────────────┐│
│   │                    Lexer                                ││
│   │   Tokens: [EXPR_START, VAR, DOT, IDENT, CALL, ...]     ││
│   └────────────────────────────────────────────────────────┘│
│                    │                                         │
│                    ▼                                         │
│   ┌────────────────────────────────────────────────────────┐│
│   │                    Parser                               ││
│   │   AST: CallExpr(MemberExpr($json, name), toUpperCase) ││
│   └────────────────────────────────────────────────────────┘│
│                    │                                         │
│                    ▼                                         │
│   ┌────────────────────────────────────────────────────────┐│
│   │                   Validator                             ││
│   │   - Check function allowlist                            ││
│   │   - Check path depth limits                             ││
│   │   - Check for forbidden patterns                        ││
│   └────────────────────────────────────────────────────────┘│
│                    │                                         │
│                    ▼                                         │
│   ┌────────────────────────────────────────────────────────┐│
│   │                   Evaluator                             ││
│   │   - Interpret AST                                       ││
│   │   - Apply timeout                                       ││
│   │   - Return result                                       ││
│   └────────────────────────────────────────────────────────┘│
│                    │                                         │
│                    ▼                                         │
│   Output: "JOHN DOE"                                         │
└─────────────────────────────────────────────────────────────┘
```

### Implementation

**File: `python/graph_caster/expressions/ast_nodes.py`**

```python
from dataclasses import dataclass
from typing import Any, List

@dataclass
class ASTNode:
    pass

@dataclass
class Literal(ASTNode):
    value: Any

@dataclass
class Identifier(ASTNode):
    name: str

@dataclass  
class MemberExpr(ASTNode):
    object: ASTNode
    property: str
    computed: bool = False  # obj["key"] vs obj.key

@dataclass
class CallExpr(ASTNode):
    callee: ASTNode
    arguments: List[ASTNode]

@dataclass
class BinaryExpr(ASTNode):
    left: ASTNode
    operator: str
    right: ASTNode

@dataclass
class UnaryExpr(ASTNode):
    operator: str
    argument: ASTNode

@dataclass
class ConditionalExpr(ASTNode):
    test: ASTNode
    consequent: ASTNode
    alternate: ASTNode
```

**File: `python/graph_caster/expressions/evaluator.py`**

```python
from typing import Any, Dict, Callable
from .ast_nodes import *
from .functions import BUILTIN_FUNCTIONS

class ExpressionEvaluator:
    """Safe AST evaluator without eval()."""
    
    def __init__(
        self,
        context: Dict[str, Any],
        functions: Dict[str, Callable] | None = None,
        timeout_sec: float = 5.0,
        max_depth: int = 100,
    ):
        self._context = context
        self._functions = {**BUILTIN_FUNCTIONS, **(functions or {})}
        self._timeout = timeout_sec
        self._max_depth = max_depth
        self._depth = 0
    
    def evaluate(self, node: ASTNode) -> Any:
        self._depth += 1
        if self._depth > self._max_depth:
            raise ExpressionError("Max recursion depth exceeded")
        
        try:
            return self._eval(node)
        finally:
            self._depth -= 1
    
    def _eval(self, node: ASTNode) -> Any:
        match node:
            case Literal(value=v):
                return v
            
            case Identifier(name=n):
                if n.startswith('$'):
                    return self._resolve_builtin(n)
                return self._context.get(n)
            
            case MemberExpr(object=obj, property=prop, computed=comp):
                obj_val = self.evaluate(obj)
                if obj_val is None:
                    return None
                if comp:
                    return obj_val.get(prop) if isinstance(obj_val, dict) else None
                return getattr(obj_val, prop, obj_val.get(prop))
            
            case CallExpr(callee=callee, arguments=args):
                return self._call(callee, args)
            
            case BinaryExpr(left=l, operator=op, right=r):
                return self._binary(op, self.evaluate(l), self.evaluate(r))
            
            case UnaryExpr(operator=op, argument=arg):
                return self._unary(op, self.evaluate(arg))
            
            case ConditionalExpr(test=t, consequent=c, alternate=a):
                return self.evaluate(c) if self.evaluate(t) else self.evaluate(a)
            
            case _:
                raise ExpressionError(f"Unknown node type: {type(node)}")
    
    def _resolve_builtin(self, name: str) -> Any:
        match name:
            case '$json':
                last = self._context.get('last_result')
                return last if isinstance(last, dict) else {'value': last}
            case '$node':
                return self._context.get('node_outputs', {})
            case '$env':
                return self._context.get('_env', {})
            case _:
                raise ExpressionError(f"Unknown builtin: {name}")
    
    def _call(self, callee: ASTNode, args: List[ASTNode]) -> Any:
        # Method call on object
        if isinstance(callee, MemberExpr):
            obj = self.evaluate(callee.object)
            method = callee.property
            
            # String methods
            if isinstance(obj, str):
                return self._string_method(obj, method, args)
            
            # List methods  
            if isinstance(obj, list):
                return self._list_method(obj, method, args)
        
        # Global function call
        if isinstance(callee, Identifier):
            fn = self._functions.get(callee.name)
            if fn is None:
                raise ExpressionError(f"Unknown function: {callee.name}")
            return fn(*[self.evaluate(a) for a in args])
        
        raise ExpressionError("Invalid call expression")
    
    def _string_method(self, s: str, method: str, args: List[ASTNode]) -> Any:
        ALLOWED = {
            'toLowerCase': lambda: s.lower(),
            'toUpperCase': lambda: s.upper(),
            'trim': lambda: s.strip(),
            'split': lambda sep=None: s.split(self.evaluate(args[0]) if args else sep),
            'startsWith': lambda: s.startswith(self.evaluate(args[0])),
            'endsWith': lambda: s.endswith(self.evaluate(args[0])),
            'includes': lambda: self.evaluate(args[0]) in s,
            'replace': lambda: s.replace(
                self.evaluate(args[0]), 
                self.evaluate(args[1]) if len(args) > 1 else ''
            ),
            'slice': lambda: s[
                self.evaluate(args[0]):
                self.evaluate(args[1]) if len(args) > 1 else None
            ],
        }
        if method not in ALLOWED:
            raise ExpressionError(f"String method not allowed: {method}")
        return ALLOWED[method]()
    
    def _binary(self, op: str, left: Any, right: Any) -> Any:
        OPS = {
            '+': lambda: left + right,
            '-': lambda: left - right,
            '*': lambda: left * right,
            '/': lambda: left / right if right != 0 else None,
            '%': lambda: left % right if right != 0 else None,
            '==': lambda: left == right,
            '!=': lambda: left != right,
            '<': lambda: left < right,
            '<=': lambda: left <= right,
            '>': lambda: left > right,
            '>=': lambda: left >= right,
            '&&': lambda: left and right,
            '||': lambda: left or right,
        }
        if op not in OPS:
            raise ExpressionError(f"Unknown operator: {op}")
        return OPS[op]()
    
    def _unary(self, op: str, val: Any) -> Any:
        match op:
            case '!': return not val
            case '-': return -val
            case '+': return +val
            case _: raise ExpressionError(f"Unknown unary: {op}")
```

---

## Module: RAG (`rag/`)

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      RAG Pipeline                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐  │
│  │   Document  │───▶│   Chunker   │───▶│    Embedder     │  │
│  │   Loader    │    │             │    │                 │  │
│  └─────────────┘    └─────────────┘    └────────┬────────┘  │
│                                                  │          │
│                                                  ▼          │
│                                        ┌─────────────────┐  │
│                                        │  Vector Store   │  │
│                                        │  ┌───────────┐  │  │
│                                        │  │   FAISS   │  │  │
│                                        │  │   Chroma  │  │  │
│                                        │  │   Pinecone│  │  │
│                                        │  └───────────┘  │  │
│                                        └────────┬────────┘  │
│                                                 │          │
│  ┌─────────────┐                               │          │
│  │    Query    │───────────────────────────────┘          │
│  │   Encoder   │                                          │
│  └──────┬──────┘                                          │
│         │                                                  │
│         ▼                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────┐│
│  │  Retriever  │───▶│  Reranker   │───▶│   Results       ││
│  │  (Top-K)    │    │  (Optional) │    │                 ││
│  └─────────────┘    └─────────────┘    └─────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Implementation

**File: `python/graph_caster/rag/vector_store.py`**

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import List, Dict, Any, Protocol
import numpy as np

@dataclass
class Document:
    id: str
    content: str
    metadata: Dict[str, Any]
    embedding: np.ndarray | None = None

@dataclass
class SearchResult:
    document: Document
    score: float

class EmbeddingProvider(Protocol):
    """Interface for embedding models."""
    
    def embed_documents(self, texts: List[str]) -> List[np.ndarray]:
        ...
    
    def embed_query(self, text: str) -> np.ndarray:
        ...

class VectorStore(ABC):
    """Abstract vector store interface."""
    
    @abstractmethod
    def add_documents(self, documents: List[Document]) -> None:
        """Add documents to the store."""
        pass
    
    @abstractmethod
    def search(
        self, 
        query_embedding: np.ndarray, 
        k: int = 10,
        filter: Dict[str, Any] | None = None,
    ) -> List[SearchResult]:
        """Search for similar documents."""
        pass
    
    @abstractmethod
    def delete(self, ids: List[str]) -> None:
        """Delete documents by ID."""
        pass

class FAISSVectorStore(VectorStore):
    """FAISS-based vector store for local usage."""
    
    def __init__(self, dimension: int, index_type: str = "Flat"):
        import faiss
        self._dimension = dimension
        if index_type == "Flat":
            self._index = faiss.IndexFlatL2(dimension)
        elif index_type == "IVF":
            quantizer = faiss.IndexFlatL2(dimension)
            self._index = faiss.IndexIVFFlat(quantizer, dimension, 100)
        self._documents: Dict[int, Document] = {}
        self._next_id = 0
    
    def add_documents(self, documents: List[Document]) -> None:
        vectors = np.array([d.embedding for d in documents]).astype('float32')
        self._index.add(vectors)
        for doc in documents:
            self._documents[self._next_id] = doc
            self._next_id += 1
    
    def search(
        self, 
        query_embedding: np.ndarray, 
        k: int = 10,
        filter: Dict[str, Any] | None = None,
    ) -> List[SearchResult]:
        query = query_embedding.reshape(1, -1).astype('float32')
        distances, indices = self._index.search(query, k)
        
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx < 0:
                continue
            doc = self._documents.get(int(idx))
            if doc and self._matches_filter(doc, filter):
                results.append(SearchResult(
                    document=doc,
                    score=float(1 / (1 + dist))  # Convert distance to similarity
                ))
        return results
    
    def _matches_filter(self, doc: Document, filter: Dict | None) -> bool:
        if not filter:
            return True
        for key, value in filter.items():
            if doc.metadata.get(key) != value:
                return False
        return True
    
    def delete(self, ids: List[str]) -> None:
        # FAISS doesn't support deletion well, mark as deleted
        for idx, doc in list(self._documents.items()):
            if doc.id in ids:
                del self._documents[idx]

class ChromaVectorStore(VectorStore):
    """ChromaDB-based vector store."""
    
    def __init__(self, collection_name: str, persist_directory: str | None = None):
        import chromadb
        if persist_directory:
            self._client = chromadb.PersistentClient(path=persist_directory)
        else:
            self._client = chromadb.Client()
        self._collection = self._client.get_or_create_collection(collection_name)
    
    def add_documents(self, documents: List[Document]) -> None:
        self._collection.add(
            ids=[d.id for d in documents],
            embeddings=[d.embedding.tolist() for d in documents],
            documents=[d.content for d in documents],
            metadatas=[d.metadata for d in documents],
        )
    
    def search(
        self, 
        query_embedding: np.ndarray, 
        k: int = 10,
        filter: Dict[str, Any] | None = None,
    ) -> List[SearchResult]:
        results = self._collection.query(
            query_embeddings=[query_embedding.tolist()],
            n_results=k,
            where=filter,
        )
        return [
            SearchResult(
                document=Document(
                    id=id_,
                    content=doc,
                    metadata=meta,
                ),
                score=1 - dist,  # Chroma returns distance
            )
            for id_, doc, meta, dist in zip(
                results['ids'][0],
                results['documents'][0],
                results['metadatas'][0],
                results['distances'][0],
            )
        ]
    
    def delete(self, ids: List[str]) -> None:
        self._collection.delete(ids=ids)
```

---

## Implementation Priority

1. **Week 1-2:** Phase 1 (Transport) — критично для production
2. **Week 3-4:** Phase 5 (Security) — критично для production
3. **Week 5-6:** Phase 4 (Parallelism) — производительность
4. **Week 7-8:** Phase 2 (Expressions) — developer experience
5. **Week 9-10:** Phase 3 (Triggers) — автоматизация
6. **Week 11-12:** Phase 6 (RAG) — AI capabilities

---

## Testing Strategy

| Module | Unit Tests | Integration Tests | Performance Tests |
|--------|-----------|-------------------|-------------------|
| Transport | Mock Redis | Docker Redis | 10K msg/sec target |
| Execution | Single node | Full graph | 100 nodes parallel |
| Expressions | Parser, Eval | Full pipeline | 1000 expr/sec |
| RAG | Store ops | End-to-end | 1M vectors |

---

## Execution Handoff

Два файла плана созданы:
1. `2026-03-31-graph-caster-comprehensive-roadmap.md` — высокоуровневый roadmap
2. `2026-03-31-graph-caster-detailed-architecture-plan.md` — детальная архитектура (этот файл)

**Режим выполнения:**
- **Subagent-Driven** — рекомендуется для сложных модулей (Transport, Execution)
- **Inline** — для небольших задач (UI, Docs)
