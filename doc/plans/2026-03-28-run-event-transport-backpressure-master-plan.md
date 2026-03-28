# Run-event transport backpressure (§39.2) — master implementation plan

> **For agentic workers:** follow **executing-plans** (agent-queue) task-by-task. Steps use `- [ ]` checkboxes.

**Goal:** Bring GraphCaster’s **execution → UI** path to the same architectural standard as n8n, Dify, Flowise, and ComfyUI: **no unbounded RAM growth** when the consumer (browser EventSource, Tauri IPC) is slower than the producer (chatty `task` subprocess, NDJSON lines). Keep **one canonical contract**: flat NDJSON `run-event` lines with `runId` ([`doc/COMPETITIVE_ANALYSIS.md`](../COMPETITIVE_ANALYSIS.md) §3.7); do **not** introduce a second wire protocol inside `graph-caster`.

**Architecture:** Explicit **two-layer** model (already described in competitive doc §13.3 / §39.2):

1. **Core:** `GraphRunner` + `process_exec` produce normalized events; bounded queues between **pipe readers** and **emit** so a fast child cannot exhaust memory if the Python thread calling `emit` is back-pressured.
2. **Transport:** Dev **SSE run broker** (`python/graph_caster/run_broker/`) and **Tauri** `run_bridge.rs` fan out the same bytes to UI; each outbound path gets a **bounded** buffer and a **documented overflow policy**.

**Tech stack:** Python 3.11 (`queue`, `threading`), Starlette/Uvicorn SSE, JSON Schema (`schemas/run-event.schema.json`), TypeScript (`useRunBridge`, `runSessionStore`), Rust Tauri (optional coalesce).

**Saved path:** `doc/plans/2026-03-28-run-event-transport-backpressure-master-plan.md`

---

## Why this is the highest-priority architecture item

| Criterion | Rationale |
|-----------|-----------|
| **Layer G (observability)** in [`doc/COMPETITIVE_ANALYSIS.md`](../COMPETITIVE_ANALYSIS.md) | F13 console + file history exist; **§39 / §39.2** still list transport buffer policy as the remaining structural risk. |
| **Competitors** | **n8n:** metadata-first push, ~5 MiB relay threshold, fail-closed on heavy payloads (**§3.2.1–§3.2.2**). **Dify:** `Queue*` between engine and HTTP/SSE (**§3.6**). **ComfyUI:** separate execution vs WebSocket delivery queues (**§13.3**). **Flowise:** Redis between worker and SSE in queue mode (**§3.3.1**). |
| **GC today** | [`RunBroadcaster.subscribe`](../python/graph_caster/run_broker/broadcaster.py) uses `queue.Queue()` **without `maxsize`**; `broadcast` does `put` into unbounded queues — memory grows if SSE is slow. Live **`process_output`** increases event rate; without transport bounds this becomes a **DoS-by-logging** footgun. |
| **Scope discipline** | Does **not** require Redis, multi-main, or n8n `ExecutionPushMessage` parity; stays inside **file-first** / local dev broker and desktop — aligned with **§39** “optional wrappers over the same `run-event`”. |

**Best fit for GC (decision):** Keep **NDJSON + `runId`** everywhere. Add **bounded subscriber queues** in the broker with **drop-newest for non-critical lines** (primarily bursty `process_output`), **never drop** lifecycle events (`run_started`, `run_finished`, `process_complete`, terminal `error` for the step). Emit a **single throttled warning event** (new `type` or cumulative field — see Task block below) so the console can show “output truncated by slow client” with i18n.

---

## Competitor patterns → GC mapping

| Product | Mechanism | GC equivalent |
|---------|-----------|----------------|
| **n8n** | `nodeExecuteAfter` then optional `nodeExecuteAfterData`; large payload may skip relay | **Metadata vs body** not needed for GC yet; **size-aware drop** + user-visible warning matches the spirit. |
| **Dify** | In-process queue → `StreamResponse` | Bounded `RunBroadcaster` queues + same SSE shape. |
| **ComfyUI** | Execution queue vs socket queue | **Runner/sink** vs **broker subscriber** — two buffers, both bounded. |
| **Flowise** | Redis stream for remote worker | **Out of scope** for submodule; document **Aura host** follow-up. |

---

## File map (create / modify)

| Path | Role |
|------|------|
| `python/graph_caster/run_broker/broadcaster.py` | Replace unbounded `queue.Queue()` with `maxsize`; classify messages (critical vs droppable). |
| `python/graph_caster/run_broker/registry.py` | `pump_out` / `pump_err`: ensure producer does not deadlock; align with `put_nowait` or timed `put`. |
| `python/graph_caster/run_broker/app.py` | Wire config defaults (env e.g. `GC_RUN_BROKER_SUB_QUEUE_MAX` optional). |
| `python/graph_caster/process_exec.py` | Bounded queue between readers and emit loop (if not already capped — verify against Phase A in sibling plans). |
| `schemas/run-event.schema.json` | New event **`stream_backpressure`** *or* optional fields on `process_output` — pick **one** variant and version-test. |
| `python/tests/test_run_event_schema.py` | Schema coverage. |
| `python/tests/test_run_broker_backpressure.py` | **New:** synthetic slow consumer + flood. |
| `python/tests/test_process_exec_streaming.py` | Core backpressure (may already exist). |
| `ui/src/run/parseRunEventLine.ts` / `runEventSideEffects.ts` | Handle warning type; one console line. |
| `ui/src/i18n/…` | `app.run.console.outputTruncated` (en/ru). |
| `ui/src-tauri/src/run_bridge.rs` | Optional: coalesce high-frequency lines (only if profiling shows need). |
| `doc/IMPLEMENTED_FEATURES.md` | Short subsection: transport buffer policy + env knobs. |
| `doc/COMPETITIVE_ANALYSIS.md` | §39.2: point to implementation / close partial gap. |

---

## Phases and tasks

### Phase A — Prerequisite: `process_output` contract in core

**Phase A (prerequisite)** — `process_output` в схеме и раннере: **сделано** (см. [`doc/IMPLEMENTED_FEATURES.md`](../IMPLEMENTED_FEATURES.md), раздел «Инкрементальный вывод подпроцесса **task**»; тесты `test_process_exec_streaming.py`). Ниже чеклист только если откатить фичу:

- [ ] `process_output` in `schemas/run-event.schema.json`; runner emits from `process_exec.py`.
- [ ] `pytest -q` including `python/tests/test_process_exec_streaming.py`.

**Skip** this phase — закрыто в продуктивном дереве по ссылке выше.

---

### Phase B — Bounded queue in `process_exec` (core backpressure)

**Сделано в коде:** `queue.Queue(maxsize=…)` между читателями и циклом **`get(timeout)`** в `process_exec.py`; политика — блокирующий **`put`** при переполнении (backpressure на пайп). Факты — [`../IMPLEMENTED_FEATURES.md`](../IMPLEMENTED_FEATURES.md). Опционально осталось: короткий абзац в `python/README.md`, синтетический тест «медленный `emit`» (см. architecture-plan Phase B).

- [ ] (опционально) Политика при **`queue.Full`** явно в `python/README.md`, если нужна ссылка извне репо.
- [ ] (опционально) Тест: fast producer + slow `emit` → ограниченное число чанков в памяти.

```bash
cd python
pip install -e ".[dev]"
pytest -q tests/test_process_exec_streaming.py
```

---

### Phase C — Run broker: `RunBroadcaster` and registry

- [ ] Add `RunBroadcasterConfig` (`max_queue_depth: int`, default e.g. 4096 or 8192).
- [ ] `subscribe()` → `queue.Queue(maxsize=config.max_queue_depth)`.
- [ ] Implement `FanOutMsg` classification or parse NDJSON `payload` for `type` field:
  - **Critical (never drop):** lines that parse to `run_started`, `run_finished`, `process_complete`, and other non-`process_output` types used for structure.
  - **Droppable:** `process_output` (and optionally unknown types if policy is conservative).
- [ ] On overflow: **drop-newest** for droppable only; increment per-run `dropped_chunks`; emit at most one **`stream_backpressure`** event per 100 ms per run (coalesced NDJSON line).
- [ ] `broadcast`: use `put_nowait` where possible; on `Full`, apply drop logic **without** blocking the pump thread indefinitely.
- [ ] New tests: `python/tests/test_run_broker_backpressure.py` (no real HTTP; mock slow `stream_queue` consumer).

```bash
cd python
pytest -q tests/test_run_broker.py tests/test_run_broker_backpressure.py tests/test_run_event_schema.py
```

---

### Phase D — UI

- [ ] Parse new event type or field; append **one** yellow/info line in console (reuse filter pipeline).
- [ ] Vitest: parser + `consoleLineMeta` if needed.

```bash
cd ui
npm test
npm run build
```

---

### Phase E — Desktop (Tauri), only if needed

- [ ] Load test: script flooding stdout → verify UI responsiveness.
- [ ] If needed: **coalesce** in Rust (timer 50–100 ms per `runId`) **or** batch in TS before `runSessionStore` append — prefer smallest diff.
- [ ] `cargo check` in `ui/src-tauri`.

---

### Phase F — Documentation

- [ ] `doc/IMPLEMENTED_FEATURES.md`: subsection **Transport / backpressure (§39.2)** with env vars and guarantees.
- [ ] `doc/COMPETITIVE_ANALYSIS.md`: update §39.2 with **Evidence** (paths + tests).

---

## Acceptance criteria

1. **Memory:** Under synthetic flood of `process_output` lines and a **deliberately slow** SSE consumer, broker process RSS stabilizes (no unbounded growth; document threshold in test comment).
2. **Correctness:** Every run still ends with valid **`run_finished`** in the stream; **`process_complete`** for each executed task is not dropped.
3. **Visibility:** If drops occurred, user sees **one** clear message in console (i18n), not silent loss.
4. **CI:** `pytest -q` and `npm test && npm run build` pass in `graph-caster` (and Aura workflow `graph-caster-ci.yml` if applicable).

---

## Explicit non-goals

- Redis / BullMQ / n8n multi-main relay.
- Full **`ExecutionPushMessage`** WebSocket product surface.
- PII redaction pipeline (**§3.2.3**) — separate track when secrets appear in `run-event`.

---

## Review (self-check)

- [ ] All paths are **workspace-relative** to graph-caster root.
- [ ] Depends on **`process_output`** existing; transport plan is the **second line of defense** after core streaming.
- [ ] Single ADR-style decision recorded: **drop-newest for `process_output` only** + **throttled `stream_backpressure` event** (adjust if implementation chooses cumulative field instead).
