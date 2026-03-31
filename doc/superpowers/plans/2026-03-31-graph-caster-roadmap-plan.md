# GraphCaster roadmap — remaining backlog

**Architectural references:**

- `2026-03-31-graph-caster-comprehensive-roadmap.md` — high-level phased plan  
- `2026-03-31-graph-caster-detailed-architecture-plan.md` — ADRs, module diagrams, code templates  
- `2026-03-31-phase1-production-transport-plan.md` — transport / relay tasks (mostly landed in-tree)

**Canonical done register:** [`../../IMPLEMENTED_FEATURES.md`](../../IMPLEMENTED_FEATURES.md).

**For agents:** Use **executing-plans** / **subagent-driven-development** on the **open** bullets below.

**Last plan sync:** 2026-03-31 — **Worker coordination (Phase 1.4 MVP):** **`WorkerCoordinator`** / **`InMemoryWorkerCoordinator`** / **`RedisWorkerCoordinator`** (`execution/worker_coordinator.py`, `redis_lock.py`), опц. **`WorkerPool(slot_coordinator=…)`**, env **`GC_WORKER_COORDINATOR_REDIS_URL`**, **`python/tests/test_worker_coordinator.py`**. **RAG vector backends (optional):** **`GC_RAG_VECTOR_BACKEND`** (`memory` \| `chroma` \| `faiss`), **`GC_RAG_CHROMA_PATH`**; extras **`[rag-chroma]`**, **`[rag-faiss]`**; tests **`python/tests/test_rag_vector_backends.py`**. **RAG query (memory path):** **`metadataFilter`**, **`retrieveOversample`** — `rag/vector_store.py`, `retriever.py`, `rag_query_exec.py`; tests **`test_rag_query_exec.py`**, **`test_rag_vector_backends.py`**. **Comprehensive roadmap** (`2026-03-31-graph-caster-comprehensive-roadmap.md`): Phase **1**–**2**, **3**, **4.2**, **5**, **6**, **7** (частично), **8.1** — чекбоксы и «факт в дереве» сверены 2026-03-31; **`phase1-production-transport-plan.md`** помечен как исторический черновик относительно уже вмерженного relay/heartbeat. Ранее: **Forward plan Tasks 4–7, 11**; **OpenAPI v1**; expression autocomplete; workspace conflict; **`--public-stream`**.

---

## Verification (repo root `third_party/graph-caster/`)

| Scope | Command | Success |
|-------|---------|--------|
| Python | `cd python && py -3 -m pytest tests -q` | Exit 0 |
| UI unit | `cd ui && npm test -- --run` | Exit 0 |
| UI build | `cd ui && npm run build` | Exit 0 |

---

## Open priorities (P0–P2)

### P0 — Production Transport & Scaling

| Task | Status | Where / notes |
|------|--------|----------------|
| Redis Pub/Sub relay | **done** | `run_broker/relay/redis_relay.py`, `relay/broker_sync.py` + `GC_RUN_BROKER_REDIS_URL` |
| WebSocket keepalive (server) | **done** | `run_broker/heartbeat.py`, `run_broker/routes/ws.py`, `GC_RUN_BROKER_WS_HEARTBEAT_SEC` |
| WebSocket client ping / reconnect | **done** | `ui/src/run/webRunBroker.ts` (pong + exponential backoff; suppress reconnect on intentional close) |
| Consumer reorder by `seq` (UI) | **done** | `ui/src/run/ndjsonSeqReorder.ts`, wired for SSE + WS stdout NDJSON |
| Distributed worker coordination | **partial** (slot lease MVP) | **`WorkerCoordinator`** + Redis **SET NX EX** (`execution/worker_coordinator.py`); broker глобальный лимит — `redis_coord.py`; полный scale-out run-queue — **open** |

**In-tree:** `SequenceGenerator`, priority subscriber queue, backpressure / metrics on broadcaster.

### P0 — Security & Redaction

| Task | Status | Where / notes |
|------|--------|----------------|
| Two-phase event delivery (strict `nodeExecuteAfter` vs data payload split for untrusted viewers) | **partial** | `--public-stream` + `NodeExecutePublicStreamSink`; опц. **`GC_RUN_SNAPSHOT_REDACT`** / **`redact_node_outputs_snapshot`** для **`node_outputs_snapshot`**; отдельный trusted “after” канал / UI — **open** |
| AI route payload masking (beyond current runner redaction) | **done** (MVP) | `lastNodeOutput`: вложенные ключи **`authorization`**, **`cookie`** + прежний `_redact_object`; `ai_route_invoke` metadata-only; `ai_route_failed.detail` усечён |
| Vault integration | **deferred** | file / env secrets (`workspace.secrets.env`) |

### P1 — Expression Engine enhancements

| Task | Status | Where / notes |
|------|--------|----------------|
| AST-based safe evaluator | **done** | `python/graph_caster/expression/evaluator.py` |
| `$json`, `$node`, `$env` + JSON logic / mustache edges | **done** | `edge_conditions.py`, `runner/expression_conditions.py` |
| Builtin string helpers (`upper`, `lower`, `trim`, …) | **done** | `expression/functions.py` |
| n8n-style `.toUpperCase()` / `.trim()` on `str` in expressions | **done** | `expression/evaluator.py` (`toUpperCase`, `split`, `startsWith`, …) |
| Expression editor UI (autocomplete) | **done** | `$json` / `$node` / `$env`, `$node["…"]`, builtins, Ctrl+Space — `expressionAutocomplete.ts`, `ExpressionAutocompleteInput.tsx`, `InspectorPanel` (edge + HTTP URL) |

### P1 — Triggers & Scheduling

| Task | Status | Where / notes |
|------|--------|----------------|
| Schedule trigger | **done** | `nodes/trigger_schedule.py`; in-process **`GraphCronScheduler.start()`** только при **`GC_GRAPH_BUILTIN_SCHEDULER=1`** (`builtin_scheduler_policy.py`) |
| Webhook trigger route | **done** | `run_broker/routes/trigger_webhook_route.py` |
| Webhook HMAC | **done** | `run_broker/webhook_signature.py`, `X-GC-Webhook-Signature` |
| Idempotency key | **done** | `run_broker/idempotency.py`, `X-GC-Idempotency-Key` (in-memory cache + TTL) |

### P1 — In-Process Parallelism

| Task | Status | Where / notes |
|------|--------|----------------|
| Worker pool / ready queue | **done** | `execution/worker_pool.py` (**`in_flight_count`**); broker **`GET /metrics`**: **`gc_graph_fork_threadpool_max_config`** |
| Fork parallel threadpool cap (fleet / OS ceiling) | **done** | `execution/pool_sizing.py`, env `GC_GRAPH_FORK_THREADPOOL_MAX`; dynamic Dify-style grow/shrink of `ThreadPoolExecutor` remains **open** |
| Prometheus metrics | **done** (broker) | `GET /metrics` → `RunBrokerRegistry.prometheus_metrics_text()` |

### P2 — RAG & Knowledge

| Task | Status | Where / notes |
|------|--------|----------------|
| RAG index / query nodes | **done** (MVP) | `rag_index_exec.py`, `rag_query_exec.py`, runner visits; tests e.g. `test_rag_index_node.py` |
| Vector store abstraction (FAISS / Chroma plugins) | **done** (opt-in) | `GC_RAG_VECTOR_BACKEND` + `chroma_vector_store` / `faiss_vector_store`; см. **`doc/IMPLEMENTED_FEATURES.md`** (RAG vector memory) |
| Metadata filter + oversample on `rag_query` (memory) | **done** (MVP) | **`metadataFilter`** (AND), **`retrieveOversample`** (1–10); Chroma **`where`**; тесты **`test_rag_vector_backends.py`**, **`test_rag_query_exec.py`** |

### P2 — API v1 & embed

| Task | Status | Where / notes |
|------|--------|----------------|
| REST `/api/v1/graphs/.../run`, run status, persisted **`/runs/.../events`**, cancel | **done** (MVP) | `run_broker/routes/api_v1_routes.py`, `api_v1.py`, `registry_run_manager.py` |
| OpenAPI publish / contract freeze | **done** (MVP) | **`GET /api/v1/openapi.json`**, `GC_API_V1_OPENAPI_DOCUMENT_VERSION` in `api_v1_openapi.py`, `test_api_v1.py` |
| Embed npm package for hosts | **done** (MVP) | **`dist/`** entrypoints + **`ui/README.md`**, OpenAPI BFF **`/api/v1/openapi.json`**; **`private`** npm, без отдельного scoped-пакета |

### P2 — UI

| Task | Status | Where / notes |
|------|--------|----------------|
| File conflict detection (external edit) | **done** | fingerprint on open; block autosave/save until reload, overwrite, or pause autosave — `workspaceFs.ts`, `WorkspaceFileConflictModal.tsx` |
| Execution history / timeline polish | **partial** | run catalog + history UI exists — unify per product spec |

---

## Competitive feature parity matrix

| Feature | n8n | Dify | Flowise | GC Status |
|---------|-----|------|---------|-----------|
| Safe expression sandbox | ✓ | — | — | **done** (Python AST) |
| Pub/Sub event relay | ✓ | ✓ | ✓ | **done** (opt-in Redis) |
| In-process worker pool | — | ✓ | — | **done** |
| Auto-scaling workers | — | ✓ | ✓ | **partial** (env-capped fork pool + fork `max_parallel`) |
| RAG pipeline | — | ✓ | ✓ | **done** (MVP nodes) |
| NDJSON `seq` + UI reorder | — | — | — | **done** |
| WS keepalive + client reconnect | ✓ | — | — | **done** |
| Two-phase event redaction | ✓ | — | — | **partial** (public stream omits `node_execute.data`; artifact file retains redacted `data`) |
| Schedule / webhook triggers | ✓ | ✓ | ✓ | **done** |
| Webhook HMAC + idempotency | ✓ | — | — | **done** |
| Vault secrets | ✓ | — | ✓ | **deferred** |

---

## Dependencies / schema notes

Optional extras and node payloads remain in `python/pyproject.toml` and `schemas/graph-document.schema.json`. For stubs (RBAC/audit, CRDT, canvas perf) — see **IMPLEMENTED_FEATURES.md**.
