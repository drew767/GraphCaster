# Execution transport backpressure (§39.2) — implementation plan

> **For agentic workers:** follow **executing-plans** (agent-queue) task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Eliminate **unbounded memory** on the path **Python runner → NDJSON → SSE/Tauri → UI** when a `task` subprocess is chatty (stdout/stderr) or NDJSON events arrive faster than the browser/Tauri consumer can apply them. Preserve the **single canonical wire contract**: one JSON object per line, field **`type`**, stable **`runId`** on every line (`schemas/run-event.schema.json`, `doc/COMPETITIVE_ANALYSIS.md` §3.7). Do **not** add a second protocol inside graph-caster.

**Architecture:** Two explicit buffers (matches competitive mapping **§13.3** / **§39.2**):

1. **Core (runner ↔ emit):** Between `process_exec` pipe readers and the callback that serializes `run-event` lines — **bounded** `queue.Queue` so a fast child cannot allocate unbounded Python objects if `emit` is slow.
2. **Transport (broker ↔ subscribers):** `RunBroadcaster` currently uses `queue.Queue()` **without `maxsize`** (`python/graph_caster/run_broker/broadcaster.py`); `broadcast` calls `put` on every subscriber — **replace** with bounded queues and a **documented overflow policy** (drop-non-critical chunks, never drop lifecycle/control events).

**Tech stack:** Python 3.11 (`queue`, `threading`), Starlette/Uvicorn for dev SSE (`python/graph_caster/run_broker/`), JSON Schema, TypeScript (`ui/src/run/useRunBridge.ts`, console pipeline), Rust Tauri (`ui/src-tauri/src/run_bridge.rs`) optional coalesce.

---

## Priority decision (why this feature)

| Criterion | Rationale |
|-----------|-----------|
| **Layer G** (observability) in `doc/COMPETITIVE_ANALYSIS.md` | Console + `events.ndjson` exist; **§39.2** still names transport buffer policy as structural risk. |
| **Competitors** | **n8n:** small metadata first, optional heavy body; **~5 MiB** relay limit, fail-closed (**§3.2.1**). **Dify:** `Queue*` between engine and HTTP/SSE consumer (**§3.6**). **ComfyUI:** execution queue **separate** from WebSocket delivery queue (**§13.3**). **Flowise:** Redis between worker and SSE in queue mode (**§3.3.1**). |
| **GraphCaster today** | `RunBroadcaster.subscribe` → unbounded queues; slow EventSource = growing RAM. Verbose `process_output` amplifies the issue (**DoS-by-logging** footgun). |
| **Scope** | No Redis, no multi-main, no full **`ExecutionPushMessage`** — stays **file-first** / local dev broker + desktop. |

**Chosen behavior (best fit for GC):** Keep NDJSON everywhere. **Drop-newest** only for **`process_output`** (and optionally other explicitly classified bursty types). **Never drop:** `run_started`, `run_finished`, `process_complete`, structural events, terminal step `error`. Emit **one throttled** warning (`stream_backpressure` or cumulative field — pick one in Phase C and schema-version). Mirror **n8n** spirit (metadata always; heavy path may be skipped) without copying their WS envelope.

---

## Competitor → GC mapping

| Product | Mechanism | GC equivalent |
|---------|-----------|----------------|
| **n8n** | `nodeExecuteAfter` then optional `nodeExecuteAfterData`; relay skip for huge payloads | Size-aware drop + user-visible warning; no duplicate message types. |
| **Dify** | In-process queue → `StreamResponse` | Bounded broker queues + same SSE framing. |
| **ComfyUI** | Prompt queue vs socket queue | Runner/sink buffer **and** broker subscriber buffer — both bounded. |
| **Flowise** | Redis stream (queue mode) | Out of scope for submodule; note **Aura host** follow-up. |

---

## Files to create or modify

| Path | Responsibility |
|------|------------------|
| `python/graph_caster/process_exec.py` | Bounded queue reader → emit; policy on `queue.Full` (document in `python/README.md`). |
| `python/graph_caster/run_broker/broadcaster.py` | `RunBroadcasterConfig`, `maxsize` per subscriber, classify NDJSON `type`, drop policy, optional synthetic warning line. |
| `python/graph_caster/run_broker/registry.py` | Ensure pump threads do not deadlock when `put` blocks or uses `put_nowait`. |
| `python/graph_caster/run_broker/app.py` | Env defaults e.g. `GC_RUN_BROKER_SUB_QUEUE_MAX` (optional). |
| `schemas/run-event.schema.json` | New event **`stream_backpressure`** *or* extension of `process_output` — **one** variant; version bump if needed. |
| `python/tests/test_process_exec_streaming.py` | Core backpressure invariants. |
| `python/tests/test_run_broker_backpressure.py` | **New:** synthetic slow consumer + flood. |
| `python/tests/test_run_event_schema.py` | Schema coverage for new type/fields. |
| `python/tests/test_run_broker.py` | Regression after broadcaster changes. |
| `ui/src/run/parseRunEventLine.ts` / `runEventSideEffects.ts` / `consoleLineMeta.ts` | Parse warning; single console line meta. |
| `ui/src/i18n/` | `app.run.console.outputTruncated` (en + ru). |
| `ui/src-tauri/src/run_bridge.rs` | Optional: coalesce high-frequency lines if profiling requires. |
| `doc/IMPLEMENTED_FEATURES.md` | Short **Transport / backpressure** subsection. |
| `doc/COMPETITIVE_ANALYSIS.md` | §39.2 — Evidence (paths, tests). |

---

## Prerequisites

- [ ] Confirm `process_output` exists in schema and runner per [`doc/IMPLEMENTED_FEATURES.md`](../IMPLEMENTED_FEATURES.md) (раздел «Инкрементальный вывод подпроцесса **task**»). If missing, complete **Phase A** of `doc/plans/2026-03-28-run-event-transport-backpressure-master-plan.md` first.

---

## Phase A — Core: `process_exec` bounded queue

**Сделано:** см. [`../IMPLEMENTED_FEATURES.md`](../IMPLEMENTED_FEATURES.md) и `process_exec.py`.

- [ ] (опционально) Явная подсекция в `python/README.md`.
- [ ] (опционально) Тест slow-`emit` + fast producer.

```bash
cd python
pip install -e ".[dev]"
pytest -q tests/test_process_exec_streaming.py
```

---

## Phase B — Transport: `RunBroadcaster`

- [ ] Add `RunBroadcasterConfig` (`max_queue_depth: int`, default e.g. 4096 or 8192).
- [ ] `subscribe()` returns `queue.Queue(maxsize=config.max_queue_depth)`.
- [ ] Parse each outgoing `FanOutMsg` payload line (NDJSON) for root **`type`** or maintain classification at broadcast site:
  - **Critical (never drop):** `run_started`, `run_finished`, `process_complete`, non-`process_output` structural types.
  - **Droppable:** `process_output` (default).
- [ ] On `Full` for droppable: **drop-newest**; increment per-`runId` `dropped_chunks`; emit at most one **`stream_backpressure`** line per 100 ms per run (coalesce).
- [ ] `broadcast`: use non-blocking strategy so the **pump** thread never blocks indefinitely on a stuck subscriber.
- [ ] New tests: `python/tests/test_run_broker_backpressure.py` (mock slow consumer, no full HTTP).

```bash
cd python
pytest -q tests/test_run_broker.py tests/test_run_broker_backpressure.py tests/test_run_event_schema.py
```

---

## Phase C — UI

- [ ] Handle new event in parser and console pipeline; show **one** info/warning line (reuse filters).
- [ ] Vitest for parser and `consoleLineMeta` if applicable.

```bash
cd ui
npm test
npm run build
```

---

## Phase D — Tauri (only if Phase C profiling shows need)

- [ ] Flood test: subprocess spamming stdout; verify UI stays responsive.
- [ ] If needed: batch/coalesce in `run_bridge.rs` (50–100 ms window per `runId`) **or** batch in TS before store — smallest diff wins.
- [ ] `cargo check` / `cargo test` under `ui/src-tauri` as per project norms.

---

## Phase E — Documentation

- [ ] `doc/IMPLEMENTED_FEATURES.md`: transport guarantees + env vars.
- [ ] `doc/COMPETITIVE_ANALYSIS.md` §39.2: close gap with Evidence links.

---

## Acceptance criteria

1. **Memory:** Under synthetic flood of `process_output` and a deliberately slow SSE consumer, broker process RSS **stabilizes** (document threshold/assertion in test comment).
2. **Correctness:** Stream always ends with **`run_finished`**; **`process_complete`** for each executed task is **not** dropped.
3. **Visibility:** If drops occurred, user sees **one** clear i18n message, not silent loss.
4. **CI:** `pytest -q` in `python/`, `npm test && npm run build` in `ui/` pass.

---

## Non-goals

- Redis / BullMQ / n8n multi-main relay.
- Full WebSocket **`ExecutionPushMessage`** product surface.
- PII redaction service (**§3.2.3**) — separate track.

---

## Review (self-check)

- [ ] Paths are workspace-relative to **graph-caster** root (`python/`, `ui/`, `schemas/`, `doc/`).
- [ ] Single ADR-style decision: **drop-newest for `process_output` only** + throttled **`stream_backpressure`** (or documented alternative).
- [ ] Depends on **`process_output`** path in core; transport is **second line of defense**.

**Saved path:** `doc/plans/2026-03-28-execution-transport-backpressure-writing-plan.md`
