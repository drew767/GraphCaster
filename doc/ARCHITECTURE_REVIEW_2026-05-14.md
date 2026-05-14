# GraphCaster — Архитектурный аудит

**Дата:** 2026-05-14
**Объём кодовой базы:** 557 Python-файлов, 753 TS/TSX-файлов (~35 000 строк UI), 224 тест-файла Python + ~291 в UI
**Метод:** статический анализ всех директорий `python/graph_caster/` и `ui/src/`, схем, документации, build-конфигураций; четыре параллельных прохода (ядро Python, обвязка Python, UI, кросс-cutting).

---

## 1. Краткое резюме

GraphCaster — лёгкий редактор и рантайм направленных графов: **Vite + React 18 + TypeScript + Tauri** на фронте, **Python**-пакет `graph_caster` на бэке (CLI + опциональный HTTP/SSE/WS-broker на FastAPI/Starlette). Контракт данных описан JSON-схемами в `schemas/`, рантайм-события и схема графа разделены явно.

**Оценка зрелости:** beta — добротный фундамент, реалистичный roadmap, но видны следы быстрого роста (две монолитные TSX-компоненты на 2–4 тыс. строк, ~50 неprocommitжен­ных файлов с целыми подсистемами, два «patch»-скрипта в корне, дубль `PRODUCT_DESIGN.md` / `PRODUCT_DESIGNE.md`).

**Что сделано правильно:**
- единственный «источник правды» — JSON-схема графа, которая разделяется и фронтом, и Python-валидатором;
- безопасная экспрессия с AST-фильтром и таймаутом, безопасные subprocess-вызовы (без `shell=True`), грамотная криптография (`secrets`, `scrypt`, `compare_digest`);
- цепочечный SHA-256 в audit-логе (tamper-evidence);
- LOD-рендер и React Flow с виртуализацией для канвы;
- разделение SSE → WS-fallback с reorder NDJSON-секвенций;
- Zustand плюс `useSyncExternalStore` для рантайм-стейта без избыточных ре-рендеров.

**Главные риски** (детально ниже):
1. Уязвимости периметра HTTP-нод: нет SSRF-фильтра приватных подсетей, DNS-rebind обходит локальный TLS-бypass.
2. Плагины не подписаны и без runtime-enforcement permissions — фактически произвольное выполнение кода.
3. Файловые синки и шаг-кэш race-prone: `NdjsonAppendFileSink` без внутренней блокировки; шаг-кэш без CAS.
4. Чрезмерно крупные компоненты UI: `InspectorPanel.tsx` (3829 строк), `AppShell.tsx` (2377), `GraphCanvas.tsx` (822). Сложно сопровождать и тестировать.
5. ~40–50 непровомитченных Python-файлов c целыми подсистемами (auth/, audit/, llm/, mcp_server/, credentials/, ai_builder/) — HEAD не отражает реального состояния продукта.
6. Мёртвый код в корне: `_fix_main.py`, `_patch_main.py` плюс дубль `PRODUCT_DESIGN.md` / `PRODUCT_DESIGNE.md`.

---

## 2. Архитектурное описание по слоям

### 2.1. Контракт данных
- `schemas/graph-document.schema.json` — структура графа: nodes / edges / handles / pins, поле `gcPin` для кэша вывода, `stepCache` для F17.
- `schemas/run-event.schema.json` — поток runtime-событий (NDJSON).
- `schemas/ai-route-wire.schema.json` — DSL условий для AI-route.
- 24 фикстуры в `schemas/test-fixtures/` покрывают fork/merge, петли, триггеры, ошибки.

**Сила:** один JSON-Schema контракт ⇒ один источник правды для UI-валидации и Python-раннера.

### 2.2. Python-ядро

| Подсистема | Ключевые файлы | Назначение |
|---|---|---|
| **Runner** | `runner/graph_runner.py` (~1800 строк), `runner/edge_routing.py`, `runner/retry_policy.py`, `fork_parallel.py`, `step_queue.py` | Загрузка графа, обход, retry/circuit, fork→merge, эмит событий. |
| **Узлы** | `nodes/*.py` (14 типов), `runner/node_visits.py`, `*_exec.py` (`process_exec.py` 36 KB, `python_code_exec.py`, `http_request_exec.py`, `nested_run_subprocess.py`) | Реестр версионируемых обработчиков (`node_registry.py`), built-in dispatch и плагинные хэндлеры. |
| **Run broker** | `run_broker/app.py`, `run_broker/registry.py`, `run_broker/routes/*` (REST v1, SSE, WS, webhooks, CRDT), `run_broker_redis_bus.py`, `run_broker_scheduler.py`, `run_broker_poller.py`, `run_broker_fs_watcher.py`, `run_broker/heartbeat.py`, `run_broker/idempotency.py` | FastAPI/Starlette с middleware (auth, idempotency), Redis-relay, polling/cron/fs-triggers, бесконечная подписка SSE/WS. |
| **Транспорт событий** | `run_event_sink.py`, `run_transport/`, `run_audit.py`, `run_notifications.py` | NDJSON stdout + append-file + S3 + audit-зеркало + notifications. |
| **Состояние / история** | `history/`, `pause_resume.py`, `run_sessions.py`, `run_catalog.py`, `versioning.py`, `node_output_cache.py`, `replay.py`, `partial_exec.py` | SQLite-каталог ранов, JSON-чекпоинты, реплей, частичный exec, версии графов. |
| **Параллелизм / масштабирование** | `parallel/`, `fork_parallel.py`, `execution/{worker_pool,ready_queue,execution_coordinator}.py`, `scaling/`, `resilience/` | ThreadPoolExecutor in-process; задел под Redis ready-queue/RQ. |
| **Безопасность / sandbox** | `auth/` (rbac, oauth, api_keys, sso, scope_map), `credentials/`, `secrets/`, `secrets_loader.py`, `tenancy/`, `redaction/`, `sandbox/` (AST-blocker, runner, python_worker) | Scrypt-хэширование, RBAC через scope wildcards, цепной audit, маскирование секретов в событиях. |
| **AI / RAG / MCP** | `ai_builder/`, `ai_routing.py`, `llm/{providers,provider.py}`, `rag/embeddings/*`, `rag_index_exec.py`, `rag_query_exec.py`, `mcp_client/`, `mcp_server/`, `mcp_oauth/`, `tools/` | Провайдер-абстракция (OpenAI/Anthropic/Ollama), эмбеддинги (Voyage/Jina/Cohere/HF/OpenAI), rerankers, MCP stdio+HTTP. |
| **Наблюдаемость** | `observability/adapters/{langsmith,langfuse,phoenix}.py`, `otel_tracing.py`, `audit/audit_event.py`, `audit/audit_query.py` | Цепной SHA-256 audit-лог, OTel экспорт, third-party sink-адаптеры. |
| **Экспрессии / валидация** | `expression/{evaluator,parser,templates}.py`, `edge_conditions.py`, `validate.py`, `runtime_validate.py`, `handle_contract.py`, `port_data_kinds.py` | Безопасный AST-eval с timeout, JSONLogic-подобный DSL для рёбер. |
| **Плагины / расширения** | `plugin/{loader,manifest,permissions,registry}.py`, `marketplace.py`, `node_api/`, `agent/`, `agent_delegate.py`, `source_control/git_ops.py`, `triggers/`, `node_registry.py` | Entry-point discovery, манифесты, advisory-разрешения. |
| **CLI** | `__main__.py` (543 строки), `cli_run_args.py`, `cursor_agent_argv.py` | Подкоманды `run/serve/worker/mcp/mcp-oauth/artifacts-*/catalog-rebuild`, normalize argv, stdin cancel-loop. |

### 2.3. UI

| Слой | Ключевые файлы | Заметки |
|---|---|---|
| **Shell / роутинг** | `App.tsx`, `main.tsx`, `layout/AppShell.tsx` (**2377 строк, 92 KB**), `i18n.ts`, `pages/` | Без явной роутинг-библиотеки (типично для Tauri), модалки и сайдбары через состояние. |
| **Канва** | `components/GraphCanvas.tsx` (822 строки), `components/canvas/LODNodeRenderer.tsx`, `components/canvas/MemoizedNode.tsx`, `components/nodes/GcFlowNode.tsx`, `components/edges/GcBranchEdge.tsx`, 46 модулей в `graph/` | `@xyflow/react` 12.8.2 + кастомная LOD-стратегия (GHOST/LOW/MEDIUM/FULL). |
| **Инспектор** | `components/InspectorPanel.tsx` (**3829 строк, 166 KB**) | Самый крупный компонент — отдельный SaaS внутри одного файла. |
| **Стейт** | `app/stores/*` (Zustand: editorUi, notifications, banner, commandBar, presence, aiContext, run, autosave), `run/runSessionStore.ts` (`useSyncExternalStore`), `graph/`, `collab/` (Yjs CRDT), `crdt/` | Гибрид Zustand + локальные хуки + Yjs для co-edit. |
| **Run / телеметрия** | `run/webRunBroker.ts` (562 строки), `run/webRunBrokerDispatch.ts`, `run/ndjsonSeqReorder.ts`, `run/nodeRunOverlay.ts`, `run/runEdgeOverlay.ts`, `components/ExecutionTimeline.tsx`, `components/RunHistoryModal.tsx` | SSE → WS-fallback с exponential backoff (400 мс → 25 с, 12 попыток), reorder NDJSON по `seq`. |
| **Embed** | `embed/EmbedBridge.tsx`, `embed/host.ts`, `embed/index.ts` | iframe-postMessage, поддерживает только `navigate(path)`. |
| **API** | `api/{credentialsApi,variables,nodeDocs,templates,workers}.ts` | Минимальная обёртка с fallback в localStorage и поддержкой `AbortSignal`. |
| **Тауриintegration** | `tauri/`, скрипты `dev` / `build:desktop` в `package.json` | Web-first, нативка через Tauri 2. |
| **Тесты** | Vitest + RTL, 291 файл, плотные моки `@xyflow/react`, i18n, stores | Хороший охват юнит-уровня, бедно с интеграцией. |

### 2.4. Транспорт run-событий

NDJSON-stream (`run_event.schema.json`) идёт по трём путям:
1. **stdout** runner-процесса → читается родителем (CLI / broker).
2. **append-file** в `runs/<graphId>/<runId>/events.ndjson` (опционально).
3. **SSE/WebSocket** через `RunBroadcaster` в `run_broker/registry.py` для всех подписанных клиентов.

`RunBroadcaster` стартует **до** spawn-а подпроцесса и буферизует события в bounded-queue (8192 по умолчанию). `TeeRunEventSink` сериализует выводы из нескольких источников под одним lock-ом.

---

## 3. Оценка архитектуры — лучший ли это вариант?

**Что выбрано удачно (оставлять как есть):**

- **JSON-Schema как контракт.** Альтернативы (Protobuf, custom DSL) дороже и не дают видимой выгоды на текущем масштабе.
- **NDJSON-стрим событий с reorder по `seq`.** Простой формат, легко логировать/реплеить; reorder-окно решает проблему out-of-order без необходимости в Kafka.
- **CLI-first, broker — опциональный слой.** Позволяет запускать графы как обычные процессы, легко тестировать и встраивать; broker строится поверх того же sink-абстрагирования.
- **React Flow + LOD.** Виртуализация для больших графов реализована корректно; перепрыгивать на Konva/Canvas-only оверкилл.
- **Zustand + `useSyncExternalStore`** для run-stream — правильный выбор: позволяет дробить ре-рендеры по узлам без Redux-overhead.
- **Scrypt + `secrets` + RBAC через scope wildcards** — индустриальный стандарт; не нужно переписывать на Argon2 без явной выгоды.

**Что выбрано спорно (стоит обсудить):**

- **ThreadPoolExecutor для fork-параллелизма с GIL-bound нодами (`python_code`).** В одном процессе CPU-bound нагрузка сериализуется; для масштабирования по CPU нужен `multiprocessing` или вынос в worker-pool (есть задел в `execution/worker_pool.py`).
- **Файловая персистентность шаг-кэша (SQLite) без атомарных compare-and-swap.** При высокой конкурентности два рана пересчитают и перезапишут один ключ; для single-node это норма, но при горизонтальном масштабе понадобится Redis-замок.
- **Plugin-система через entry-points с advisory-permissions.** Подходит для self-hosted, но в SaaS-сценариях даёт arbitrary code execution.
- **Один файл `__main__.py` на 543 строки** с восемью подкомандами — близко к границе maintainability; стоит сразу разносить.
- **UI без явного роутинга.** Для одностраничного Tauri-приложения приемлемо, но добавляет связность в `AppShell.tsx` (отсюда и 2377 строк).

**Что выбрано неудачно (нуждается в рефакторе):**

- **`InspectorPanel.tsx` (3829 строк) и `AppShell.tsx` (2377 строк) — монолиты.** Это не вопрос вкуса: они уже мешают тестам (heavy mocking) и расширению.
- **`process_exec.py` (36 KB) и `runner/graph_runner.py` (~1800 строк) на Python-стороне** — те же симптомы.
- **Шаг-кэш ключи через `stable_json(default=str)`** — collision-prone между `"123"` и `123`; для замены нужно нормализовать тип в схеме узла.
- **Heartbeat-таймаут 30 с в `run_broker/heartbeat.py`** — слишком грубо для нод с минимальной активностью; нужно адаптивно или явный keep-alive event.

**Главный архитектурный вопрос:** масштабирование за пределы одной машины.

Сейчас всё (raсё, run-state, шаг-кэш, sessions, pause-checkpoints) хранится локально файлами или в памяти. Есть **задел** в `run_broker_redis_bus.py`, `execution/ready_queue.py`, `execution/worker_pool.py`, `scaling/`, но это пока scaffolding. Если продукт целится в multi-tenant SaaS, потребуется:
- общий Redis (run sessions, ready-queue, idempotency, шаг-кэш CAS),
- объектное хранилище (S3) как первичный, а не зеркальный канал для артефактов,
- разделение control-plane (broker) и data-plane (workers).

На текущем масштабе (desktop-first + опциональный single-node serve) выбранная архитектура **адекватна**.

---

## 4. Найденные баги и проблемы (с привязкой к файлам)

### 4.1. Безопасность (наивысший приоритет)

| # | Файл / место | Описание | Severity |
|---|---|---|---|
| 1 | `nodes/api_call.py:280-282` | TLS-bypass для localhost через `GC_API_CALL_ALLOW_INSECURE_LOCALHOST=1` уязвим к DNS rebind (`127.0.0.1.attacker.com`). Проверка по `urlparse().hostname`, без CIDR. | **High** |
| 2 | `nodes/api_call.py:164-175` | Нет SSRF-фильтра: атакующий может постучаться в `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.169.254` (cloud metadata). | **High** |
| 3 | `nodes/api_call.py:313` | `follow_redirects=True` без лимита редиректов и cross-origin policy. | Medium |
| 4 | `plugin/loader.py` + `plugin/permissions.py` | Permissions — advisory, runtime-enforcement отсутствует; нет подписей плагинов, манифест не верифицируется. Любой установленный плагин = arbitrary code. | **High** |
| 5 | `auth/api_keys.py:138-154` | `verify()` итерирует все ключи без rate-limit/backoff — открыт для brute-force и timing-атак (несмотря на `compare_digest`, IO-таймингэто видно). | Medium |
| 6 | `auth/api_keys.py:28` vs `tenancy/service.py` | Параметры scrypt рассогласованы: ключи `n=2048`, пароли `n=16384`. Стоит привести к `n=16384` минимум. | Low |
| 7 | `auth/oauth/flow.py:38` | OAuth-state без timestamp-валидации — replay-окно неограничено по времени. | Medium |
| 8 | `expression/evaluator.py:23-47` | `FORBIDDEN_NAMES` не покрывает `type`, `vars`, `help`; известный escape `().__class__.__mro__[1].__subclasses__()`. | Medium |
| 9 | `expression/evaluator.py:79-83` | Таймаут wall-clock через `ThreadPoolExecutor` не отнимает CPU у busy-loop; в multi-tenant сценарии — DoS. | Medium |
| 10 | `audit/audit_event.py:48-52` | Цепной SHA-256 без HMAC: при доступе к файлу злоумышленник перестраивает цепь. | Low (acceptable detective-only control) |
| 11 | `python_code_exec.py` + `sandbox/python_worker.py` | AST-блокировка — best-effort; в комментариях явное предупреждение. При недоверенном вводе нужен контейнер. | Medium |
| 12 | `sandbox/runner.py:64-65` | `memory_limit` игнорируется на Windows — единственный лимит — `timeout`. | Low |

### 4.2. Конкурентность и состояние

| # | Файл | Описание |
|---|---|---|
| 13 | `run_event_sink.py` (`NdjsonAppendFileSink`) | Ленивый `open()` в `emit()` без internal lock; thread-safety зависит исключительно от внешнего `TeeRunEventSink`. При прямом использовании — race. |
| 14 | `node_output_cache.py` (шаг-кэш) | Нет atomic compare-and-swap: два рана с одинаковым ключом оба считают и перезаписывают. |
| 15 | `node_output_cache.py` | Ключ через `stable_json(default=str)` — collision-prone (`"123"` ≡ `123`). |
| 16 | `runner/node_visits.py:206, 807, 1034, 1244` | Busy-wait через `time.sleep(min(0.2, deadline - monotonic()))` в `human_input` / `wait_for`. Использовать condition variable / asyncio.Event. |
| 17 | `run_broker/registry.py` | Между spawn-ом подпроцесса и подпиской subscriber-а — узкое окно потери ранних событий. Сейчас broadcaster стартует первым, но timing хрупкий. |
| 18 | `run_broker/heartbeat.py` | 30 с без SIGTERM-эскалации; зависший процесс держится все 30 с. |
| 19 | `run_broker_redis_bus.py` (relay fanout hook) | OSError при недоступности Redis молча проглатывается в `TeeRunEventSink` — нет ретрая/алёрта. |
| 20 | `run_sessions.py` | In-memory регистрация без авто-cleanup; `reap_stale_running_sessions()` нужно дёргать руками. |
| 21 | `pause_resume.py:74-80` | Scan чекпоинтов O(N²) (граф × раны). При тысячах ранов — деградация. |
| 22 | `annotations.py` | Module-level `_LOCKS: dict[str, asyncio.Lock] = {}` растёт неограниченно. |

### 4.3. UI

| # | Файл | Описание |
|---|---|---|
| 23 | `ui/src/components/InspectorPanel.tsx` (3829 строк) | Монолит на 166 KB — узел/ребро/настройки графа/шаг-кэш/импорт файлов в одном модуле. Очень тяжело тестировать и поддерживать. |
| 24 | `ui/src/layout/AppShell.tsx` (2377 строк) | Управляет историей, runs, selection, модалками, sidebar; prop-drilling на 30+ значений в `GraphCanvas`. |
| 25 | `ui/src/components/GraphCanvas.tsx` (822 строки) | На грани maintainability; connections / LOD / viewport / mini-map / edge-insert менажерятся в одном файле. |
| 26 | `ui/src/run/webRunBroker.ts` | Глобальные Maps `brokerStreams`, `brokerSockets`, `ndjsonSeqSinksByRun` без TTL — при упавшем клиенте handle утекает. |
| 27 | `ui/src/run/runSessionStore.ts` (731 строка) | `MAX_LINES_PER_RUN` объявлен, но enforcement по коду не очевиден; при долгом run буфер NDJSON-строк растёт. |
| 28 | `ui/src/run/parseRunEventLine.ts` | Толерантный парсинг `JSON.parse` без логирования отброшенных строк — повреждённые события «исчезают». |
| 29 | `ui/src/components/canvas/LODNodeRenderer.tsx` | Inline-объекты стиля создаются каждый рендер до `memo()` — `memo` всё равно ловит, но нагрузка на сборщик мусора есть. |
| 30 | `ui/src/components/canvas/MemoizedNode.tsx` | Кастомная `areNodePropsEqual` сравнивает по `id`/`selected`/`data`; при обновлении ссылочно новой `data` с равным содержимым обновление пропускается — риск устаревших handler-ов в closure. |
| 31 | `ui/src/lib/keyboardShortcutsCatalog.ts` / `useCanvasKeybindings.ts` | 15+ TODO с тегом F100 — большой блок keybindings — no-op stubs. |
| 32 | `ui/src/components/InspectorPanel.tsx` + `findStructureIssues()` | Валидация графа дёргается на каждый keystroke; для больших графов — заметный лаг. |

### 4.4. Корректность модели / контракт

| # | Место | Описание |
|---|---|---|
| 33 | `ui/src/graph/nodeKinds.ts` vs `python/graph_caster/nodes/` | UI знает ~28 типов узлов (`ai_route`, `mcp_tool`, `rag_query`, `rag_index`, `llm_agent`, `agent`, …), в Python-каталоге `nodes/` — 14 файлов; часть типов обрабатывается напрямую в раннере (`runner/node_visits.py`), но **asymmetric coverage не отражена в схеме**, что приведёт к runtime-падениям. |
| 34 | `nested_run_subprocess.py` | JSON-IPC без лимитов размера: большой payload может молча таймаутить. |
| 35 | `replay.py` | Реплей не идемпотентных нод (HTTP, LLM) дублирует side-effects; нет механизма guard-rail. |
| 36 | `source_control/git_ops.py:59` | `GitCommandError.stderr` пробрасывается в события — может содержать пути / внутренние URL. |
| 37 | `__main__.py:377-382` | `--start` без `--context-json` — warning в stderr, но без abort: рантайм-условия могут сорваться на полпути. |

### 4.5. Гигиена репозитория и документации

| # | Место | Описание |
|---|---|---|
| 38 | `_fix_main.py`, `_patch_main.py` (корень репо) | Одноразовые скрипты-патчи `__main__.py` для `_cmd_ai_build` / `_cmd_ai_refine`. В текущем `__main__.py` этих функций нет (грep пуст), в `_SUBCOMMANDS` тоже нет `ai-build`/`ai-refine`. **Мёртвый код.** |
| 39 | `doc/PRODUCT_DESIGN.md` vs `doc/PRODUCT_DESIGNE.md` | Дубль; второй файл — русский перевод с опечаткой в имени. Канонический — `PRODUCT_DESIGN.md`. |
| 40 | git status | ~40–50 untracked Python-файлов в `auth/`, `audit/`, `credentials/`, `ai_builder/`, `llm/`, `mcp_server/`, `node_api/`, `i18n/`, `nodes/`. HEAD не отражает реального состояния продукта. |
| 41 | `python/tests/` | 44 пропущенных теста (`@pytest.mark.skip`) — много привязано к будущим фичам (F63, F65, F100, …); часть может быть давно заброшена. |
| 42 | `ui/src/.../SingleNodeRun.test.tsx:111,146,161,173,209` | 4 пропуска с TODO(F100) — связано с не­домигрированными инспектор-фичами. |

---

## 5. План улучшений (по приоритетам)

### 5.1. Critical / P0 — сделать в ближайший спринт

1. **SSRF + DNS-rebind фикс в `nodes/api_call.py`:**
   - white-list публичных IP / явный block для приватных подсетей и cloud-metadata (`169.254.169.254`, `fd00::/8`, `fc00::/7`);
   - lookup имени до коннекта, использовать резолвленный IP при подключении;
   - кэп редиректов (5) и same-origin redirect policy.
2. **Plugin trust model:** включить cryptographic signatures (Sigstore или GPG) для манифеста, валидацию хэша при загрузке, явный warning «untrusted plugin» в UI. Permissions нужно реально enforce-ить (как минимум — file system jail).
3. **Удалить `_fix_main.py`, `_patch_main.py`** и либо завести `ai-build` / `ai-refine` в CLI (`__main__.py`), либо удалить `ai_builder/`.
4. **Закрыть untracked-bulk:** разнести содержимое `auth/`, `audit/`, `credentials/`, `llm/`, `mcp_server/`, `ai_builder/`, `i18n/` по логически выделенным коммитам с тестами. Сейчас HEAD не отражает поставляемый продукт — любые PR-ревью невозможны.

### 5.2. High / P1 — следующий релиз

5. **Auth hardening:**
   - rate-limit + exponential backoff в `auth/api_keys.py:verify()`;
   - таймштамп + TTL для OAuth-state в `auth/oauth/flow.py`;
   - привести scrypt-параметры к единому минимуму (`n=16384, r=8, p=1`) во всех модулях.
6. **Расколоть `ui/src/components/InspectorPanel.tsx` (3829 строк)** на:
   - `inspector/NodeInspector.tsx`,
   - `inspector/EdgeInspector.tsx`,
   - `inspector/GraphSettingsInspector.tsx`,
   - `inspector/StepCacheInspector.tsx`,
   - чистая логика валидации — в `graph/inspectorValidation.ts`.
7. **Раз­бить `ui/src/layout/AppShell.tsx` (2377 строк)** на хуки: `useGraphDocumentHistory`, `useRunSessionController`, `useCanvasSelection`, `useModalsController`; модалки развести через portal-route и анмаунтить при закрытии.
8. **`NdjsonAppendFileSink`** — добавить internal `threading.Lock` (даже ценой контеншна — это write-behind, не hot-path). Подразумеваемая зависимость от внешнего lock-а опасна.
9. **Atomic step cache:** перейти на SQLite `INSERT OR IGNORE` + UNIQUE index по `(key, version)` или, при наличии Redis, на `SETNX`.
10. **webRunBroker cleanup:** TTL для `brokerStreams` / `brokerSockets` / `ndjsonSeqSinksByRun` (30 минут wall-clock), реальный `MAX_LINES_PER_RUN` enforcement в `runSessionStore`.
11. **Heartbeat:** SIGTERM при 30 с тишины, SIGKILL при 60 с; явные keep-alive события каждые 5 с.
12. **Synchronize Python ↔ UI node catalog:** ввести единый источник правды — `schemas/node-types.json`, генерить из него и `nodeKinds.ts`, и регистрацию в `node_registry.py`. Заодно резолвится риск #33.

### 5.3. Medium / P2 — в течение квартала

13. **Выделить из `runner/graph_runner.py` (~1800 строк)** этапы: `scheduler.py`, `event_emitter.py`, `secrets_resolver.py`, `state_machine.py`. Граф-раннер должен оркестрировать, а не реализовывать всё.
14. **Расколоть `nodes/process_exec.py` (36 KB)** на env-merging, IO-pump, error-handling — три модуля.
15. **Виртуализация длинных списков** в `RunHistoryModal`, `ConsolePanel`: `@tanstack/react-virtual`.
16. **Memoize-ить `findStructureIssues()` / `findBranchAmbiguities()`** в инспекторе по `documentVersion`.
17. **Expression hardening:** расширить `FORBIDDEN_NAMES` (`type`, `vars`, `help`), убрать ThreadPoolExecutor wall-clock таймаут в пользу `signal.SIGALRM` (POSIX) либо вынести eval в дочерний процесс. Для multi-tenant — обязательно отдельный namespace.
18. **HMAC цепочечный audit:** добавить отдельный signing-key (KMS/env), считать `HMAC-SHA256(prev_hash || entry, key)` — даёт защиту от подделки.
19. **Деdup документации:** слить `PRODUCT_DESIGNE.md` в `PRODUCT_DESIGN.md` или вынести RU-перевод в `doc/locales/ru/`.
20. **Скрытые TODO F100 в `useCanvasKeybindings.ts`** — либо реализовать, либо снять из каталога shortcut-ов.
21. **Логирование dropped NDJSON-строк** в `parseRunEventLine.ts` (warn + counter).
22. **`pause_resume.py`** — индекс ранов в SQLite (`run_catalog.py` уже даёт основу), убрать O(N²) сканирование.

### 5.4. Low / P3 — техдолг

23. Прогнать `bare except` audit (uровень grep дал ноль в Python, но `try/except Exception:` встречается часто — стоит ловить и логировать корень, а не глотать).
24. Авто-cleanup `_LOCKS` в `annotations.py` (`weakref.WeakValueDictionary` или TTL).
25. Замена inline-стилей в `LODNodeRenderer.tsx` на CSS-классы.
26. Интеграционные тесты под канву (drag-drop, edge-insert, undo/redo end-to-end). Сейчас тесты сильно замоканы.
27. Vitest bench-ярус: рендер 500 / 2000 узлов, проверка regression-ов LOD.
28. Перевести scrappy `print(`-вывод в библиотечных модулях на `logging` (15 файлов).
29. Лимит размера IPC-payload в `nested_run_subprocess.py`.
30. Replay guard-rail: помечать неидемпотентные ноды и предупреждать в UI перед replay.

---

## 6. Сводная таблица архитектурного риска

| Подсистема | LOC (≈) | Зрелость | Главный риск | Приоритет работ |
|---|---:|---|---|---|
| Runner / execution | 2 500 | Beta | thread-unsafe file-sink, busy-wait | P1 |
| Nodes / exec | 3 000 | Beta | SSRF + sandbox-побег | **P0** |
| Run broker | 2 500 | Beta | heartbeat coarse, fanout silent fail | P1 |
| Persistence / cache | 1 500 | Beta | step-cache collisions, нет atomic | P1 |
| Concurrency | 800 | Alpha | GIL, нет deadlock-detect | P2 |
| CLI | 543 | Stable | loose validation | P3 |
| Auth / secrets | 1 200 | Beta | rate-limit, OAuth-state TTL | P1 |
| Plugin | 600 | **Alpha** | без signatures, advisory perms | **P0** |
| Expression | 400 | Beta | FORBIDDEN incomplete, wall-clock | P2 |
| UI shell + inspector | 6 200 | **Tech-debt** | монолиты 2.4–3.8 K LoC | P1 |
| UI canvas | 1 500 | Beta | prop-drilling, валидация на keystroke | P2 |
| UI run/telemetry | 1 800 | Beta | memory leak in maps, нет cleanup TTL | P1 |
| Tests | — | Mixed | моки-всё, нет integration-у крыла | P2 |
| Документация / репо | — | **Cleanup** | дубли, untracked-bulk, мёртвые скрипты | **P0** |

---

## 7. Краткий вердикт

Архитектурный костяк — **верный для текущей продуктовой ниши** (desktop-first редактор + опциональный broker). Главные проблемы — не в дизайне, а в гигиене и периметре безопасности:

1. **HTTP-периметр** (`api_call`, plugins) — единственный класс рисков, который требует немедленного действия.
2. **Гигиена репозитория** — `_fix_main.py`, дубль `PRODUCT_DESIGN*`, ~50 untracked-файлов — снимаются за день, дают резкий выигрыш в восприятии проекта.
3. **UI-монолиты** — известный техдолг, рефакторинг можно растянуть, но дальше тянуть нельзя: тесты уже страдают.
4. **Масштабирование на multi-node** — задел есть, но нужно сознательно решить: оставаться single-node или достроить Redis-плоскость.

Все остальные пункты — нормальная работа над качеством для проекта в beta-стадии.
