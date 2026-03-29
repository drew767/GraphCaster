# Сравнительный анализ: GraphCaster и референсные проекты

**Дата:** 2026-03-29 · **итерация 68** (**§29**: опциональный subprocess для **`graph_ref`** вынесен в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); **§32.2**: узкий **`$node`** в шаблонах и **`var`**; «открыто» — полный **n8n Expression** / JS sandbox; **§3.2.1** / **§39**: dev **WebSocket** + **`run_transport`** — факты в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) **«Dev WebSocket и `run_transport`»**; **оверлей после выхода воркера** — строка **«Итог прогона на холсте…»** в том же [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); черновик плана удалён из **`doc/plans/`**)  
**Глубина:** инженерный уровень B (подсистемы, пакеты, потоки данных без разбора каждого файла).  
**Источники:** README репозиториев, видимая структура каталогов и ключевые entry points; при расхождении с продом помечать как «по документации».

---

## 1. Зачем этот документ

Сопоставить типовые возможности редакторов воркфлоу и платформ автоматизации с тем, что уже заложено в **GraphCaster**, и дать **маппинг на целевые слои GC**, чтобы при реализации фичи было ясно, какой контракт и какой модуль затрагивать.

**Уже реализовано и вынесено из «пробела» относительно конкурентов:** см. [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (host/run state, жизненный цикл NDJSON с `runId`, **десктоп:** мост UI ↔ Python через Tauri subprocess; **веб (dev):** локальный run-брокер **`python -m graph_caster serve`**, Vite прокси **`/gc-run-broker`**, **SSE** или **WebSocket** (опц. **`VITE_GC_RUN_TRANSPORT=ws`**, **`viewerToken`**) на **`runId`** (тот же контракт событий, что у CLI) — разделы **«Веб без Tauri»**, **«Dev WebSocket и `run_transport`»** (в т.ч. **FIFO** pending при **`GC_RUN_BROKER_MAX_RUNS`** / **`runBroker`**); **частичный прогон** — **`--until-node`**, **`run_finished.status` `partial`**, **`--context-json`** — раздел «Частичный прогон»; **инкрементальный вывод подпроцесса `task`** (**NDJSON `process_output`**, живые логи в консоли) — раздел с тем же названием в том же файле; **backpressure dev run-брокера** (**SSE** и **WebSocket**: **`RunBroadcaster`**, **`stream_backpressure`**, ограниченные очереди подписчиков, без глобального лока на `broadcast`) — подраздел **«Backpressure SSE»** и **Evidence** к нему в том же файле; **закреплённый вывод `gcPin`** (UI + раннер, аналог n8n **`pinData`** для **`task`**) — подраздел «Закреплённый вывод…»; **межпрогонный кэш** (**F17**: **`task`**, **`mcp_tool`**, **`ai_route`**, **`llm_agent`** при **`data.stepCache`**) — **`--step-cache`**, **`--step-cache-dirty`**, **`node_cache_*`**, в десктопе — тоггл Run, очередь **dirty**, **транзитивное замыкание** в духе n8n **`dirtyNodeNames`** (успешные рёбра, активный документ) — подраздел «Межпрогонный кэш выходов» (перечень типов нод — **F17** в том же файле); **вложенный `graph_ref`** + step-cache **dirty** (стек навигации, **bubble** с диска, **`_parent_graph_ref_node_id`** в раннере; паритет sub-workflow / subgraph у конкурентов) — отдельный абзац **«Вложенный `graph_ref`»** перед той же таблицей F17; **опционально отдельный OS-процесс на каждый заход в `graph_ref`** (**`GC_GRAPH_REF_SUBPROCESS`**, **`nested_run_subprocess.py`** — сопоставимо с отдельным worker/headless run у n8n/Flowise/Langflow) — раздел **«Вложенный `graph_ref`: опциональная изоляция OS-процесса»** там же; **нода `ai_route`** (статическое ИИ-ветвление исходов, wire v1, **`choiceIndex`**, события **`ai_route_*`**) — подраздел **«ИИ-ветвление / нода `ai_route`»** в разделе **F4** того же файла; **файловый журнал прогонов** (**`events.ndjson`**, **`run-summary.json`**, UI **History**, replay в консоль, брокер **`POST /persisted-runs/*`**) — раздел **«Персистентный журнал прогона / execution history»** в том же файле; **ошибки при открытии графа** (чтение / синтаксис JSON / **`parseGraphDocumentJsonResult`**, модалка **`OpenGraphErrorModal`**, i18n, имя файла в заголовке — P1 в **`DEVELOPMENT_PLAN.md`**) — раздел **«Открытие графа: ошибки JSON и парсера»**; **CI** монорепо **хост** для pytest + UI build — отдельный подраздел там же; **нормализация финала при обрыве воркера** (synthetic **`run_finished`**, **`coordinator_worker_lost`**) — строка **«Обрыв воркера»** в разделе **«Десктоп…»** того же файла; **визуализация прогона на канвасе** (подсветка последнего пройденного ребра по **`edge_traverse`** / **`branch_taken`**, пульс активной ноды, режимы motion и **`prefers-reduced-motion`**, **закреплённый итог после выхода воркера** — **`settledVisualByRootGraphId`**, трек последнего ребра после **`run_finished`**, кнопка **Clear highlights**, привязка к **`rootGraphId`** из NDJSON) — раздел **«Визуализация прогона на канвасе»** там же).

---

## 2. Целевые слои GraphCaster (эталон для маппинга)

| Слой | Ответственность | У GC сейчас (коротко) |
|------|-----------------|------------------------|
| **A. Документ и схема** | JSON Schema, `GraphDocument`, версии, инварианты графа; контракт строк раннера | `schemas/graph-document.schema.json`, **`schemas/run-event.schema.json`**, `models.py`, `validate.py`; **`schemaVersion`** и миграции документа — **§30** (**F2**); **F18** (статическая совместимость **`sourceHandle`/`targetHandle`** по **`node.type`**, MVP) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); расширенная типизация портов (primitive/json, мультишины) и эталоны конкурентов — **§15**; новые **`kind`** нод — **§18** (**F15**) |
| **B. Редактор (UI)** | Канвас, ноды, инспектор, предупреждения, экспорт, история правок | `ui/` (**@xyflow/react**), `ui/src/graph/` (в т.ч. **`nodePalette.ts`**, **`nodeKinds.ts`**); канвас и паттерны UX — **§28** (**F1**); **палитра поиска**, **ПКМ → добавить ноду** (чипы категорий), **мультивыбор / буфер / групповое удаление**, защита **`start`**, **большие графы** (viewport/оверлей/sync рёбер), **рамки `group` / Group selection** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (разделы «Поиск…», меню добавления ноды, «Мультивыбор…», **«Canvas: большие графы»**, **«Визуализация прогона на канвасе»**); **нативная оболочка** (**Tauri**) — **§33** (**F16**); **Run/Stop** из десктопа — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); **веб Run/Stop** (`npm run dev:web` + **`serve`**, SSE или WebSocket брокер) — там же, **«Веб без Tauri»** и **«Dev WebSocket и `run_transport`»**; **частичный прогон** (инспектор → **`untilNodeId`**) — там же, раздел «Частичный прогон»; инспектор + маркер на канвасе для **`gcPin`** (**`task`**, аналог n8n **`pinData`**) — там же, «Закреплённый вывод…»; **`task`** / **`mcp_tool`** / **`ai_route`** / **`llm_agent`**: **`data.stepCache`**, бейдж **C**, кнопка **dirty** и тоггл **Step cache** в панели Run (F17) — там же, «Межпрогонный кэш…»; предупреждения по ручкам (**F18**) — там же; эталоны пинов у конкурентов и открытые темы — **§15**; типы нод — **§18**; i18n — **§26** (**F21**); undo/redo (**F20**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md), детали — **§21**; **CI** (Vitest/`npm run build` + pytest в родительском репо) — там же |
| **C. Workspace** | Каталог `graphs/`, индекс `graphId` → путь, автосохранение | `workspace.py`, планы в `DEVELOPMENT_PLAN.md` / `PRODUCT_DESIGNE.md`; **`graphId`** для **`graph_ref`** — **§29** (**F5**); мультиредактирование и-merge из нескольких клиентов — **§19** (**F22**), в core GC не заложено |
| **D. Рантайм** | Обход графа, условия на рёбрах, вложенные графы, субпроцессы, политика сбоев, опционально кэш шагов | `runner.py` (**§31** порядок обхода и достижимость, **F3**; **§32** условия на рёбрах и «первое истинное», **F4** — в т.ч. нода **`ai_route`** (ИИ-ветвление), [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); **§29** **`graph_ref`**, **F5**; диспетчер по **`kind`** (в т.ч. **`llm_agent`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md)), `unknown_node` — **§18**), **`process_exec.py`** (**§27**, **F7**), события NDJSON; внутренний слой «исполнитель → транспорт» (**`RunEventSink`**, **`StepQueue`**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); **частичный** отладочный прогон (**`--until-node`**, **`--context-json`**) — там же («Частичный прогон»); **`gcPin`** / short-circuit и **`node_outputs_snapshot`** (аналог n8n **`pinData`** для **`task`**) — там же («Закреплённый вывод…»); **F6** / **§13** (срез в репо): очередь ожидания слота у dev **`serve`‑брокера** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«Dev WebSocket…»**, строка «Очередь старта…»); **полный** пул / многоуровневые очереди как у **§13.3** — **хост**; ошибки — **§16** / **§37** (**F19**); **F17** (кэш **`task`** / **`mcp_tool`** / **`ai_route`** / **`llm_agent`** при **`data.stepCache`**, **`--step-cache`**, **`--step-cache-dirty`**, десктоп, транзитив **dirty**, **bubble** во вложенном **`graph_ref`**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) («Межпрогонный кэш…», абзац **«Вложенный `graph_ref`»**); **остаток** F17 (step-cache для **прочих** типов нод, TTL и др. — **§22.2**) / ревизия в ключе — **§36** |
| **E. Артефакты и Run** | Папки run, метаданные, учёт диска | `artifacts.py`, события `run_*` в раннере; при **`--artifacts-base`** — append-only **`events.ndjson`**, **`run-summary.json`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) |
| **F. Интеграции** | Credentials, HTTP, внешние API, RAG / knowledge, вызовы LLM/tools, внешний старт прогона, публичный контур | HTTP к внешнему провайдеру для ветвления — **`ai_route`**; **делегированный LLM-агент** — **`llm_agent`** ([`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md)); основной фокус на **`task`**/процесс; креды (**F8**): **file-first** workspace-секреты и **`envKeys`** — там же (**«Workspace-секреты…»**); обзор vault vs JSON — **§11** / **§35**; триггеры — **§24** (**F9**) + **§12**; **REST/embed/OpenAPI** — **§25** (**F12**), BFF-эталон — **§25.3** (Vibe); **MCP (A)** — граф как stdio tool-server — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«MCP stdio server»**); **MCP (B)** и сравнение с конкурентами — **§34**; RAG — **§14** / **F10**; полный in-runner **F11** как у референсов — **§23** |
| **G. Наблюдаемость** | Логи исполнения, история, трейсинг, экспорт | Консоль UI + NDJSON (**§3.7**), артефакты **`runs/`**; стрим, жизненный цикл **`runId`**, **UX консоли** (фильтры, поиск, экспорт, переход к ноде — фаза 7); **оверлей прогона на канвасе** (фазы нод — **`nodeRunOverlay`**; последнее пройденное ребро — **`runEdgeOverlay`**; live, replay и **settled** после процесса — **`GraphCanvas`** / **`runSessionStore`**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F13** + **«Визуализация прогона на канвасе»**); **offline-список прошлых прогонов + replay** (файловый журнал; проверка **`rootGraphId`** при replay — там же); **bounded queue** dev run-брокера (**SSE** / **WebSocket**, **`stream_backpressure`**) — там же (**«Backpressure SSE»** + **Evidence**); **нормализация финала при обрыве воркера** (synthetic **`run_finished`**) — там же, строка **«Обрыв воркера»** в **«Десктоп…»**; **§17** — сравнение с конкурентами и **остаточный** **F13** (OTel, ORM-уровень **`Execution`** как у Flowise/n8n, **prod**-транспорт **§39** / буфер **§39.2** без dev-брокера), без дубля фактов UI |

При добавлении фичи: выбрать строку из каталога ниже → сопоставить **основной слой** → посмотреть 1–2 референса в колонках конкурентов → зафиксировать контракт → код. **Мульти-тенант, роли и SSO** (**F14**) для облачного GC — **§20**; **что остаётся в repo** vs **хост** — **§38**; по умолчанию реализация на стороне **хост**, не внутри `graph-caster`.

---

## 3. Шпаргалка по репозиториям (где «живёт» граф и исполнение)

### ComfyUI
- **Назначение:** визуальный движок для diffusion / медиа-пайплайнов, не LLM-оркестратор общего назначения.
- **Стек:** Python, узлы регистрируются в `comfy/`, UI отдаёт workflow как prompt.
- **Граф:** JSON workflow + связи между нодами; загрузка весов с диска.
- **Исполнение:** `execution.py` + пакет `comfy_execution` (построение списка выполнения, кэш, прогресс); **очередь** prompt’ов (`PromptExecutor`, `PromptQueue` в `main.py`); инкрементальное переисполнение при изменениях.
- **Особенности:** типизированные сокеты нод, GPU/CPU, сильная оптимизация под большие модели.

### Dify
- **Назначение:** платформа LLM-приложений: workflow, RAG, агенты, модели, API, наблюдаемость.
- **Стек:** `api/` (Python), `web/` (фронт), Docker Compose.
- **Граф:** модель workflow в БД; исполнение через **Graphon** — `graphon.graph`, `graphon.graph_engine` (`GraphEngine`, `GraphEngineConfig`), события `graphon.graph_events`.
- **Связка:** `api/core/workflow/workflow_entry.py` — вход в прогон; `core/workflow/nodes/*` — типы нод; слои квот/observability в `core/app/workflow/layers/`.
- **Особенности:** variable pool, environment variables в графе, триггеры (webhook, schedule, plugin), RAG как первоклассные ноды, BaaS API вокруг всего.

### Flowise
- **Назначение:** визуальная сборка AI-агентов и цепочек (LangChain-стек); self-host Node.
- **Стек:** монорепо pnpm: `packages/server` (Express API), `packages/ui`, `packages/components` (ноды/интеграции), `packages/api-documentation`, `packages/agentflow` (отдельный ReactFlow-редактор агентских flow, в разработке).
- **Граф:** «chatflow» и связанные сущности в API сервера; исполнение и учёт — сервисы вроде `services/executions`, контроллеры `chatflows`.
- **Особенности:** упор на чат-ботов, маркетплейсы шаблонов, credentials для провайдеров; два направления — классические chatflows и **Agentflow** (отдельный пакет).

### Langflow
- **Назначение:** визуальные AI workflow и агенты, деплой как API/MCP, Python-first.
- **Стек:** `src/backend` (сервис), `src/frontend`, **`src/lfx`** — исполняемое ядро / CLI (`lfx serve`, `lfx run`).
- **Граф:** flows и компоненты; экспорт JSON; исполнение через движок LFX с **pluggable services** (хранилище, телеметрия, трейсинг).
- **Особенности:** Desktop, интеграции LangSmith/Langfuse, MCP-сервер из flow.

### n8n
- **Назначение:** автоматизация для интеграций (400+ сервисов), код на JS/Python в нодах, fair-code.
- **Стек:** Node.js, монорепо: `packages/workflow` (тип workflow, выражения), `packages/core`, `packages/cli` и др.; редактор в `packages/frontend/editor-ui`.
- **Граф:** workflow как JSON с нодами и связями; **выражения** в полях (`@n8n/expression-runtime` и смежные пакеты); исполнение координируется CLI/воркером, ноды — отдельные пакеты.
- **Особенности:** триггеры (cron, webhook), ветвление и error workflow, enterprise permissions/SSO; AI — в т.ч. LangChain-ноды в `@n8n/nodes-langchain`.

### Vibe Workflow
- **Назначение:** открытый node-based creative AI (картинки/видео), ближе к Comfy/Weavy, чем к n8n.
- **Стек:** `client/` Next.js, `packages/workflow-builder/` — shared редактор нод, `server/` FastAPI (**`server/app/main.py`**: префиксы **`/api/workflow`**, **`/api/app`**, CORS под **`localhost:3000`**).
- **Граф:** визуальный pipeline на клиенте; **бэкенд — BFF**: `workflow_helper.py` шлёт **`x-api-key`** на **`https://api.muapi.ai/...`** (ключ **`MU_API_KEY`** из `server/.env`), без исполнения нод в Python.
- **API (B):** **`workflow_router`** (префикс **`/api/workflow`** в **`main.py`**): create/list/delete defs, **`POST /api/workflow/{workflow_id}/run`**, **`GET /api/workflow/run/{run_id}/status`**, **`POST /api/workflow/{workflow_id}/node/{node_id}/run`**, publish/template/thumbnail, architect/poll — зеркало MuAPI; детали прокси — **§3.8** / **§3.8.1**.
- **Особенности:** узкий домен (генеративный креатив), не универсальная автоматизация; **§25.3** — эталон «тонкий хост + тяжёлый облачный раннер» для **F12**/embed; контраст с потоком **`run-event`** — **§3.8**, **§3.8.1**, **§39**.

### 3.1. Карта entry points (куда смотреть в коде)

Использовать при дизайне GC-модулей: не дублировать архитектуру, а сравнить **границы ответственности**.

| Продукт | Редактор / модель графа | Исполнение / очередь | Выражения, данные между нодами |
|--------|-------------------------|----------------------|--------------------------------|
| **ComfyUI** | Web UI → JSON prompt | `main.py` (`PromptExecutor`, `PromptQueue`), `execution.py` | `comfy_execution/graph.py`, `graph_utils.py`, `caching.py` |
| **Dify** | `web/` + API моделей workflow | `api/core/workflow/workflow_entry.py` → `graphon.graph_engine` | `graphon.runtime` (`VariablePool`), `core/workflow/variable_pool_initializer.py` |
| **Flowise** | `packages/ui`, Agentflow: `packages/agentflow` | `packages/server/src/utils/buildChatflow.ts` (`executeFlow`), `buildAgentflow.ts` (`executeAgentFlow`), очередь `queue/PredictionQueue.ts` | `constructGraphs`, `getStartingNodes` / глубина в `buildChatflow`; компоненты из `flowise-components` |
| **Langflow** | `src/frontend` | `src/lfx` (CLI), `langflow.api.v2.workflow`, `langflow.agentic.services.flow_executor` | Объект `Graph` компонентов в backend-тестах и `lfx` |
| **n8n** | `packages/frontend/editor-ui` | `packages/core/src/execution-engine/workflow-execute` (`WorkflowExecute`), `active-workflows.ts` | `packages/workflow`, `packages/@n8n/expression-runtime` |
| **Vibe Workflow** | `packages/workflow-builder`, `client/` | `server/app/` — **`main.py`**, **`routers/workflow_router.py`**, **`workflow_helper.py`** → **`api.muapi.ai`** (`x-api-key`); **§3.8**, **§3.8.1**, **§25.3** | Состояние графа на клиенте; данные между нодами — в облаке MuAPI |
| **GraphCaster** | `ui/src/graph/*`, `schemas/`; **`ui/src-tauri/`** (`run_bridge.rs`) — **§33** | `python/graph_caster/runner.py`, `process_exec.py`, `run_sessions.py`; **веб:** `graph_caster serve`, пакет **`run_broker/`** | `GraphRunner` контекст (`node_outputs`), рёбра с `condition`; реестр, отмена, **мост десктоп UI ↔ subprocess**; **SSE на `runId`** (dev web) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) («Десктоп…», «Веб без Tauri»); **MCP (A)** — stdio tools **`graph_caster mcp`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (раздел «MCP stdio server»); **MCP (B)** MVP — нода **`mcp_tool`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) («MCP client node»); расширения **(B)** (OAuth, пул сессий, …) — **§34** |

### 3.2. Уровень B+: как «тикает» движок (Dify) и что инжектится в раннер (n8n)

Эти два фрагмента полезны при расширении оркестрации GC (очереди, мульти-воркеры). **Уже реализовано у GC** (фаза 8 мост, **RunHostContext**, реестр/отмена, NDJSON + **`runId`**) — только [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); ниже — конкуренты, без повторения фактов реализации.

**Dify — `GraphEngine` (`api/graphon/graph_engine/graph_engine.py`)**

- **Модель:** очередной движок (`QueueBasedGraphEngine` в докстринге): готовые к выполнению ноды в **ready queue**, воркеры в **WorkerPool**; масштабирование задаётся **`GraphEngineConfig`** (`min_workers` / `max_workers` / пороги в `config.py`).
- **Оркестрация:** `Dispatcher` + **`ExecutionCoordinator`** (`orchestration/execution_coordinator.py`) — связка `GraphExecution`, `GraphStateManager`, обработки команд (`CommandProcessor`) и пула воркеров; проверка завершения, abort/pause.
- **Обход:** `graph_traversal/` — **`EdgeProcessor`**, **`SkipPropagator`** (пропуск веток / условная логика на уровне графа).
- **Управление снаружи:** **`CommandChannel`** (`in_memory_channel`, `redis_channel`) — пауза, abort, обновление переменных сущностями из `entities/commands.py`; поток событий через **`EventManager`** / `GraphEngineEvent` (`GraphRunStartedEvent`, `GraphRunFailedEvent`, …).
- **Состояние:** `GraphRuntimeState`, **`VariablePool`** (данные между нодами, в т.ч. дочерние графы через `ChildGraphEngineBuilderProtocol`); слои **`GraphEngineLayer`** (например лимиты исполнения, отладочный лог в `workflow_entry`).
- **Для GC:** очередь **ready queue** / пул воркеров как у Dify — вне текущего MVP (однопоточный обход). In-process **cancel** по **`runId`** (реестр, stdin, kill **`task`**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«Реестр корневых прогонов и отмена»**). Расширение: **pause**, **redis**-канал, переменные сущностей — по фазам.

**n8n — контекст хоста `IWorkflowExecuteAdditionalData` (`packages/workflow/src/interfaces.ts`, ~2997)**

`WorkflowExecute` держит ссылку на **`additionalData`**: это не часть JSON workflow, а **инъекция платформой** при запуске.

- **Креды и вложенные воркфлоу:** `credentialsHelper`, **`executeWorkflow(...)`** (рекурсивный/связанный запуск с тем же типом `additionalData`), доступ к **`IRunExecutionData`** по `executionId`.
- **HTTP / UI:** опционально `httpRequest`, `httpResponse`, **`sendDataToUI`** (см. **§3.2.1**), базовые URL webhook/waiting/form.
- **Окружение:** `variables`, **`restApiUrl`**, **`instanceBaseUrl`**, режим корня **`rootExecutionMode`**, таймаут **`executionTimeoutTimestamp`**.
- **AI / задачи:** `logAiEvent`, **`startRunnerTask`** (вынесенная работа), статус раннера `getRunnerStatus`.
- **Расширения в `packages/core`:** через module augmentation добавляются hooks, SSRF bridge, external secrets, data tables и др. (`execution-engine/index.ts`).
- **Для GC:** паттерн **документ / run state / host** и адресация прогона по id — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (начало файла **Host vs run state**, **RunSessionRegistry**). Credentials и полный паритет полей **`additionalData`** — по мере фаз.

### 3.2.1. n8n: Push в editor-ui (WebSocket или SSE), жизненный цикл исполнения и scaling

Контракт сообщений: **`@n8n/api-types`** → **`push/execution.ts`**, объединённый тип **`ExecutionPushMessage`** — дискриминант **`type`** на корне, полезная нагрузка в **`data`**.

**Каталог `ExecutionPushMessage` (уровень B, файл `packages/@n8n/api-types/src/push/execution.ts`):**

| `type` (wire) | Содержимое **`data`** (сжато) |
|---------------|------------------------------|
| **`executionStarted`** | **`executionId`**, **`workflowId`**, **`mode`**, **`startedAt`**, **`flattedRunData`** (для retry/resume, с redaction в хосте), опционально **`workflowName`**, **`retryOf`**. |
| **`executionWaiting`** | **`executionId`**. |
| **`executionFinished`** | **`executionId`**, **`workflowId`**, **`status`**. |
| **`executionRecovered`** | **`executionId`**. |
| **`nodeExecuteBefore`** | **`executionId`**, **`nodeName`**, **`ITaskStartedData`**. |
| **`nodeExecuteAfter`** | **`executionId`**, **`nodeName`**, метаданные задачи **`Omit<ITaskData, 'data'>`** (полный output **намеренно** отсутствует), **`itemCountByConnectionType`**. |
| **`nodeExecuteAfterData`** | **`executionId`**, **`nodeName`**, полный **`ITaskData`**; те же счётчики по выходам; при relay **>** ~**5 MiB** — см. абзац про scaling ниже. |

**Шире, чем исполнение:** корневой **`PushMessage`** в **`push/index.ts`** — объединение **`ExecutionPushMessage`** с **`WorkflowPushMessage`**, **`WorkerPushMessage`**, **`WebhookPushMessage`**, **`CollaborationPushMessage`**, **`DebugPushMessage`**, **`HotReloadPushMessage`**, **`BuilderCreditsPushMessage`**, **`ChatHubPushMessage`**. Редактор подписан на **один** канал **`/push`**, но не каждый кадр — это lifecycle workflow run.

**От исполнения к сокету:**

- Хуки **`hookFunctionsPush`** в **`packages/cli/src/execution-lifecycle/execution-lifecycle-hooks.ts`**: на **`nodeExecuteBefore`** / **`nodeExecuteAfter`** / **`workflowExecuteBefore`** / **`workflowExecuteAfter`** вызывается **`Push.send(...)`** с **`pushRef`** сессии редактора. **`executionStarted`** всегда уходит для инициализации UI; в **`data`** — **`executionId`**, **`workflowId`**, **`flattedRunData`** (сериализованный runData при retry/resume, с redaction).
- После ноды: сначала **`nodeExecuteAfter`** (метаданные + **`itemCountByConnectionType`**, без полного output), затем при успешной redaction и разрешённой доставке полного тела — **`nodeExecuteAfterData`** с полным **`ITaskData`** (**§3.2.2**, оркестрация — **§3.2.3**, что режется — **§3.2.4**). Для WS кадр может уйти как **binary** (`asBinary: true`), чтобы на клиенте передать **ArrayBuffer** в worker без лишнего копирования (комментарий в коде).
- Узловой код и плагины могут слать произвольные типы через **`sendDataToUI`** в **`packages/cli/src/workflow-execute-additional-data.ts`**: **`pushInstance.send({ type, data }, pushRef)`** (нужен **`pushRef`** в **`additionalData`**).

**Транспорт:** **`packages/cli/src/push/index.ts`** — класс **`Push`**: по конфигу либо **`WebSocketPush`** (апгрейд **`/{restEndpoint}/push`**), либо **`SSEPush`**; подключение после auth, query **`pushRef`**, проверка **Origin** в проде. Сердце отправки — **`AbstractPush`**: каждое сообщение сериализуется как **один JSON** **`{ type, data }`**, пинг сервера раз в ~60 с.

**Scaling:** если инстанс — **worker** или **multi-main** без локальной сессии для данного **`pushRef`**, **`Push.send`** ретранслирует событие через **pub/sub** (**`relay-execution-lifecycle-event`**); main, у которого открыта сессия, отправляет кадр в браузер. Для **`nodeExecuteAfterData`** сверх **~5 MiB** сообщение может **не ретранслироваться** (логируется warning); UI опирается на метаданные из **`nodeExecuteAfter`** и догружает execution.

**Для GC:** не копировать объём **`ExecutionPushMessage`** и политику redaction; у n8n «живой» прогон — **отдельный канал** с **`pushRef`**, не REST. **Факты реализации GC** (NDJSON, **`runId`**, границы прогона, отмена, dev **`serve`**: **SSE** и **WebSocket** **`/runs/{id}/ws`** с **`viewerToken`** / алиас **`pushRef`**, дуплекс **`cancel_run`**; адаптер **`run_transport`**; отличие канала от **`/push`**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md): «Сессия прогона…», **«Dev WebSocket и `run_transport`»**, «Реестр…», **«Десктоп…»** (в т.ч. строка **«Обрыв воркера»**), **«Веб без Tauri»**, **«Backpressure SSE»** и **Evidence**. **Открыто:** паритет n8n по **объёму** типов **`ExecutionPushMessage`**, полноценная **redaction** data-push, **prod**-мост при **вынесенном** воркере (**relay** pub/sub — **§39.2** п.7, ср. Flowise **§3.3.1**); **не** считать пробелом локальный dev-**WebSocket** (уже в репо).

### 3.2.2. n8n: redaction и fail-closed перед полным **`ITaskData`** в Push

Код: **`packages/cli/src/execution-lifecycle/execution-lifecycle-hooks.ts`** — **`hookFunctionsPush`**. Ветка **`nodeExecuteAfter`** строит **`Omit<ITaskData, 'data'>`** через **`const { data: _, ...taskData } = data`** и **сразу** шлёт **`nodeExecuteAfter`** с полем **`data: taskData`** (без тяжёлого выхода ноды). Полный **`ITaskData`** уходит только вторым сообщением **`nodeExecuteAfterData`**.

**Пайплайн redaction:** локальный **`buildRedactableExecution(hooks, { [nodeName]: [data] }, executionData)`** склеивает минимальный **`RedactableExecution`** для общего пайплайна; вызывается **`ExecutionRedactionServiceProxy.processExecution(dummy, { user, keepOriginal: true })`**. Прокси (**`packages/cli/src/executions/execution-redaction-proxy.service.ts`**) при незарегистрированной реализации **`ExecutionRedaction`** возвращает вход без изменений (**no-op**). Реальная оркестрация — **`ExecutionRedactionService`** (**`packages/cli/src/modules/redaction/executions/execution-redaction.service.ts`**); пакет **`execution:reveal`**, политика, путь **`redactExecutionData: false`** — **§3.2.3**; что делают стратегии с данными — **§3.2.4**.

**Fail-closed на полном теле:** **`user`** резолвится лениво по **`userId`** из хуков (**`UserRepository.findOne`**). Если **`user`** не найден — **`nodeExecuteAfterData`** **не** отправляется (warning в лог), метаданные из **`nodeExecuteAfter`** уже у клиента. При исключении redaction — **`nodeExecuteAfterData`** тоже пропускается (error в лог), снова без утечки необработанного output.

**Старт прогона:** в **`workflowExecuteBefore`** при непустом **`runData`** тот же **`processExecution`** поверх всего **`data.resultData.runData`** (retry/resume); если **`user`** нет или redaction падает — в **`executionStarted`** уходит **`flattedRunData: stringify({})`**, пока кадр **`executionStarted`** всё равно отсылается для инициализации UI.

**Для GC:** паттерн «метаданные всегда, тело — только после политики и идентификации субъекта» и отдельный путь при ошибке маскирования применим к мосту **§39** / **§11** при появлении чувствительных полей в **`run-event`**, без копирования **`ExecutionRedactionService`**. Оркестрация — **§3.2.3**; уровень item/поля — **§3.2.4**.

### 3.2.3. n8n: оркестрация **`ExecutionRedactionService`** (модуль, reveal vs redact, политика)

Код: **`packages/cli/src/modules/redaction/executions/execution-redaction.service.ts`**; в **`main`** инстанс подключается в прокси только при **`N8N_ENV_FEAT_EXECUTION_REDACTION === 'true'`** (**`redaction.module.ts`**); иначе **`ExecutionRedactionServiceProxy`** остаётся **no-op** (**`execution-redaction-proxy.service.ts`**).

**Пакетная проверка прав:** для списка **`RedactableExecution`** один проход по БД — **`WorkflowFinderService.findWorkflowIdsWithScopeForUser`** с областью **`execution:reveal`** только для тех прогонов, у которых **`policyAllowsReveal`** ложна (уже «разрешённые политикой» не ходят в scope-check).

**Источник политики:** **`execution.data.executionData?.runtimeData?.redaction?.policy`**, иначе **`workflowData.settings.redactionPolicy`**, иначе **`'none'`**. **`policyAllowsReveal`**: политика **`none`**; или **`non-manual`** при режиме исполнения **`manual`**; или **`manual-only`** при режиме **не** **`manual`** — в этих случаях data считается изначально доступной без redaction-пайплайна «скрыть items».

**Два режима `options.redactExecutionData`:** при **`false`** (путь **reveal** / «показать полные данные») сначала **атомарно** валидируются права: любой прогон с **`usedDynamicCredentials`** на шаге → **`ForbiddenError`**; для остальных из **`needsCheck`** без **`execution:reveal`** → аудит **`execution-data-reveal-failure`** (**`EventService`**) и **`ScopeForbiddenError`** (**`EXECUTION_REVEAL_FORBIDDEN`**). После успешной обработки всех прогонов — события **`execution-data-revealed`**. На пути reveal **`FullItemRedactionStrategy`** в пайплайн **не** включается; **`NodeDefinedFieldRedactionStrategy`** выполняется **всегда** (поля, помеченные нодой как чувствительные, «никогда не revealable»). При **`redactExecutionData !== false`** строится пайплайн из нуля: при необходимости **`FullItemRedactionStrategy`** (явный **`true`**, dynamic credentials, или сочетание политики и режима **`manual`/`non-manual`/`manual-only`/`all`** — см. **`buildPipeline`**), затем снова **`NodeDefinedFieldRedactionStrategy`**. При **`keepOriginal: true`** перед применением стратегий возможен **`structuredClone`** только если хотя бы одна стратегия **`requiresRedaction`**. После прохода для прогонов с dynamic credentials из **`executionData.runtimeData`** удаляется **`credentials`** (зашифрованный контекст не в API).

**Связь с §3.2.2:** хуки Push вызывают **`processExecution(..., { keepOriginal: true, redactExecutionData: … })`**; fail-closed на **`nodeExecuteAfterData`** при отсутствии пользователя или падении redaction остаётся в **`execution-lifecycle-hooks`**, здесь зафиксирован **внутренний** контракт сервиса. Поведение стратегий по структуре данных — **§3.2.4**; фактический перечень объявлений **`sensitiveOutputFields`** в **`nodes-base`** — **§3.2.5**.

### 3.2.4. n8n: две стратегии маскирования — полный сброс item vs поля из описания типа

Код: **`strategies/full-item-redaction.strategy.ts`**, **`strategies/node-defined-field-redaction.strategy.ts`**; контекст без проверки прав внутри стратегий — **`execution-redaction.interfaces.ts`** (**`RedactionContext.memo`** кэширует карту чувствительных путей для второй стратегии).

**`FullItemRedactionStrategy`:** обходит **`resultData.runData`**; для каждого **`taskData`** маскирует **`taskData.data`** и **`taskData.inputOverride`** через **`ITaskDataConnections`**: у каждого **`INodeExecutionData`** **`json := {}`**, **`binary`** удаляется, **`error`** на item снимается; на item пишется **`item.redaction`** `{ redacted, reason }`, при необходимости с **`error`**: урезанный **`IRedactedErrorInfo`** (только **`type`** имени ошибки; для **`NodeApiError`** ещё **`httpCode`**). Ошибки уровня шага **`taskData.error`** и уровня прогона **`resultData.error`** переносятся в **`redactedError`**, исходное **`error`** удаляется. На **`execution.data`** выставляется **`redactionInfo`** (`isRedacted`, **`reason`**: **`dynamic_credentials` | `user_requested` | `workflow_redaction_policy`**, **`canReveal`**: из контекста). Если стратегия в пайплайне, **`requiresRedaction`** всегда **true** (всегда чистит items).

**`NodeDefinedFieldRedactionStrategy`:** по **`workflowData.nodes`** для каждой ноды **`NodeTypes.getByNameAndVersion`** → **`description.sensitiveOutputFields`** (массив путей в **`item.json`**, точки в имени сегмента, wildcard **`[*]`** для массива — рекурсивный обход в **`redactPathRecursive`**). Если тип не загрузился (**community node** и т.п.) — нода в **`unknownNodes`**, **fail-closed**: все выходы **`taskData.data`** получают пустой **`json`**, без **`binary`**, **`redaction.reason: node_type_unavailable`**. Иначе по списку путей в **`item.json`** лист заменяется на маркер **`IRedactedFieldMarker`** (`__redacted`, **`reason: node_defined_field`**, **`canReveal: false`**); обход **fail-fast** по сегментам пути (нет сегмента — тихий stop). **`requiresRedaction`** — если есть хотя бы один путь или неизвестная нода.

**Для GC:** аналог «полный сброс вывода» vs «метаданные типа ноды → список секретных ключей» можно увязать с **§18** / схемой ноды, не перенося **`sensitiveOutputFields`** из n8n дословно; маркеры на partial JSON близки к идее явного placeholder в **`run-event`**, если ввести чувствительные поля.

### 3.2.5. n8n: инвентаризация **`sensitiveOutputFields`** в open **`nodes-base`**

**Метод:** поиск объявления **`sensitiveOutputFields:`** в TypeScript монорепозитория (**реализации нод**, не тесты стратегии в **`packages/cli`**).

**Снимок open tree (`n8n-master`):** в **`packages/nodes-base`** встречаются ровно **два** описания нод с непустым массивом:
- **`Webhook`** — **`packages/nodes-base/nodes/Webhook/Webhook.node.ts`**: **`headers.authorization`**, **`headers.cookie`**;
- **`DynamicCredentialCheck`** — **`…/DynamicCredentialCheck/DynamicCredentialCheck.node.ts`**: **`credentials[*].authorizationUrl`**, **`credentials[*].revokeUrl`**.

В **`packages/@n8n/**`** этого патча в том же снимке **нет** (ответвления с LangChain и др. не объявляют поле в открытых `.ts`).

**Смысл для сравнения:** **`NodeDefinedFieldRedactionStrategy`** (**§3.2.4**) спроектирован под произвольный реестр путей, но **встроенный** open-каталог объявлений **узкий**; на проде вклад дают **community** / **enterprise** пакеты и будущие правки **`nodes-base`**. При обновлении субмодуля n8n в этом документе — повторять тот же поиск по **`packages/nodes-base`** (и при сравнении с билдом — по всем подключённым пакетам нод).

**Для GC:** не принимать «масштаб n8n marketplace» за плотность **`sensitiveOutputFields`** в апстриме; для **§18** достаточно опционального контракта чувствительных выходов, без копирования двух примеров как эталона полноты.

### 3.3. Flowise: от React Flow к порядку исполнения

Код: `packages/server/src/utils/index.ts` — **`constructGraphs`**, **`getStartingNodes`**; потребители — `buildChatflow.ts`, `buildAgentGraph.ts`, `buildAgentflow.ts`, `upsertVector.ts`, `openai-realtime`.

**`constructGraphs(nodes, edges, options?)`**

- Строит **список смежности** `graph: INodeDirectedGraph` (id ноды → исходящие соседи) и **`nodeDependencies`** — по сути **входящая степень** (сколько рёбер ведёт в ноду).
- Режим **`isReversed: true`**: рёбра инвертируются (`target → [..., source]`), `nodeDependencies` считается по инвертированным рёбрам — нужен для обхода **от выходной ноды к входам**.
- Режим **`isNonDirected`**: добавляет обратные дуги (для специальных сценариев).

**`getStartingNodes(graph, endNodeId)`**

- Стартует от **конечной** ноды (например чат-выход); по структуре `graph`, где при обратном построении в списках лежат **предшественники**, рекурсивно заполняет **`IDepthQueue`**: каждой ноде сопоставляется «глубина» от конца.
- Затем глубины нормализуются (`maxDepth - depth`); ноды с нулём в этой нормализации — **стартовые для прогона к выбранному концу** (входы подграфа, ведущего к end).

**Смысл для GC:** паттерн «**якорь end / start в данных** + **инвертированный граф** + **слои глубины**» близок к сценарию «один `exit`, много путей от `start`», но у Flowise якорь часто **выход чата**, а не явная нода `start` как в GC. Для **фазы 8** можно сравнить: GC однозначно начинает с ноды `start`; Flowise вычисляет множество стартов относительно **ending node id** из типа flow.

### 3.3.1. Flowise: `SSEStreamer`, HTTP SSE и Redis при **MODE.QUEUE**

Код: **`packages/server/src/utils/SSEStreamer.ts`**, **`controllers/predictions/index.ts`**, **`controllers/internal-predictions/index.ts`**, **`queue/RedisEventPublisher.ts`**, **`queue/RedisEventSubscriber.ts`**, инстанс **`appServer.sseStreamer`** в **`index.ts`**.

**Регистрация клиента:** при **`streaming`** и валидном chatflow **`sseStreamer.addExternalClient(chatId, res)`** или **`addClient`** (internal); **`res.setHeader('Content-Type', 'text/event-stream')`**, **`Cache-Control: no-cache`**, **`Connection: keep-alive`**, **`X-Accel-Buffering: no`**, **`flushHeaders()`** — см. внешний **`predictions`**.

**Формат записи в сокет:** для большинства методов — **`response.write('message:\ndata:' + JSON.stringify({ event, data }) + '\n\n')`** (объект с полями **`event`** / **`data`**, имена событий: **`start`**, **`token`**, **`thinking`**, **`sourceDocuments`**, **`agentFlowEvent`**, **`metadata`**, TTS-типы и др.). Отдельные ветки (**`removeClient`**, **`streamAbortEvent`**, **`streamErrorEvent`**) используют вариант **`'message\ndata:'`** без двоеточия после **`message`** — несуразица относительно остальных строк, но на уровне B это одна «семья» чанков под **`text/event-stream`**.

**Интерфейс:** класс реализует **`IServerSideEventStreamer`** из **`flowise-components`**; **`buildChatflow`**, **`buildAgentflow`** и др. принимают **`sseStreamer`** и вызывают методы стрима при исполнении — полный перечень сигнатур **§3.3.2**. Реализации **`SSEStreamer`** / **`RedisEventPublisher`** дополняют контракт тремя методами, которых **нет** в **`Interface.ts`** (**§3.3.3**).

**Queue mode и Redis:** при **`process.env.MODE === MODE.QUEUE`** перед **`buildChatflow`** вызывается **`redisSubscriber.subscribe(chatId)`** (канал = **`chatId`**). Воркер **`PredictionQueue`** (**BullMQ**, `packages/server/src/queue/PredictionQueue.ts`) в **`processJob`** подменяет **`data.sseStreamer = this.redisPublisher`** (**`RedisEventPublisher`**, **`connect()`** при создании очереди). Каждый метод **`stream*`** в publisher вызывает **`redisPublisher.publish(chatId, JSON.stringify(payload))`** — тот же **`chatId`**, что и имя канала.

**Тело Redis-сообщения:** минимум **`chatId`**, **`eventType`** (строка — дальше **`switch`** в **`RedisEventSubscriber.handleEvent`**), **`data`**; опционально **`duration`** (**thinking**); для **TTS** — **`chatMessageId`** и иная форма **`data`** (**`tts_start`** / **`tts_data`** / …). Подписчик **`JSON.parse`** → **`switch (eventType)`** → вызов зеркального метода **`SSEStreamer`** (**без** повторной сериализации в Redis) — HTTP-клиент получает тот же SSE, что и при in-process.

**Каталог `eventType` / поле `event` в JSON внутри `data:` (линия `RedisEventSubscriber`):** `start`, `token`, `thinking`, `sourceDocuments`, `artifacts`, `usedTools`, `calledTools`, `fileAnnotations`, `tool`, `agentReasoning`, `nextAgent`, `agentFlowEvent`, `agentFlowExecutedData`, `nextAgentFlow`, `action`, `abort`, `error`, `metadata`, `usageMetadata`, `tts_start`, `tts_data`, `tts_end`, `tts_abort`. Новый тип через **`streamCustomEvent`** на воркере попадёт в Redis, но **до браузера не дойдёт**, пока в **`handleEvent`** нет соответствующего **`case`** (или пока не используется уже перечисленный **`eventType`**).

**Redis-конфиг (уровень B):** **`REDIS_URL`** **или** **`REDIS_HOST`** / **`REDIS_PORT`** / **`REDIS_USERNAME`** / **`REDIS_PASSWORD`** / **`REDIS_TLS`** и base64-сертификаты (**`REDIS_CERT`**, **`REDIS_KEY`**, **`REDIS_CA`**); опционально **`REDIS_KEEP_ALIVE`** (socket / **pingInterval** в клиенте **node-redis**).

**Смысл для GC:** **два уровня** — (1) **нормализованный поток событий исполнения** (как **`IServerSideEventStreamer`**), (2) **транспорт до браузера** (Express **`write`**). Масштабирование воркеров без общей памяти требует **моста** между процессом исполнения и процессом, держащим **Response** (у Flowise — **pub/sub** Redis по **`chatId`** при **`MODE=queue`**, воркеры на **BullMQ**). Для **хост** это отдельная тема от файлового **`graph_caster`**, но контракт «**один канал на сессию прогона**» близок к **`runId`** + подписка (**§17.2**, **§39**). **Backpressure:** **`res.write`** без явной паузы со стороны клиента может накапливать буфер в Node/nginx — **§39.2**.

### 3.3.2. Flowise: контракт **`IServerSideEventStreamer`** (`flowise-components`)

**Файл (от корня `Flowise-main`):** **`packages/components/src/Interface.ts`**. Исполнитель и ноды завязаны на **один** абстрактный поток: методы принимают **`chatId`** (совпадает с каналом Redis в **§3.3.1**) и полезную нагрузку.

**Методы интерфейса (имена как в TypeScript):**

| Метод | Назначение (уровень B) |
|-------|------------------------|
| **`streamStartEvent(chatId, data)`** | старт прогона (**`event` → start** в SSE) |
| **`streamTokenEvent(chatId, data)`** | поток текста / токенов |
| **`streamThinkingEvent(chatId, data, duration?)`** | «размышление» модели, опционально **`duration`** |
| **`streamCustomEvent(chatId, eventType, data)`** | произвольный **`eventType`** (на воркере без **`case`** в **`RedisEventSubscriber`** — не дойдёт до браузера — **§3.3.1**) |
| **`streamSourceDocumentsEvent`**, **`streamUsedToolsEvent`**, **`streamCalledToolsEvent`**, **`streamFileAnnotationsEvent`**, **`streamToolEvent`** | RAG / инструменты / аннотации |
| **`streamAgentReasoningEvent`**, **`streamAgentFlowExecutedDataEvent`**, **`streamAgentFlowEvent`**, **`streamNextAgentEvent`**, **`streamNextAgentFlowEvent`**, **`streamActionEvent`**, **`streamArtifactsEvent`** | агентские и agentflow кадры |
| **`streamAbortEvent(chatId)`** | прерывание (**`[DONE]`** в **`data`**) |
| **`streamEndEvent(chatId)`** | заглушка в **`SSEStreamer`** / **`RedisEventPublisher`** |
| **`streamUsageMetadataEvent(chatId, data)`** | usage / метрики |
| **`streamTTSStartEvent`**, **`streamTTSDataEvent`**, **`streamTTSEndEvent`** | TTS (**`format`**, **`audioChunk`**, **`chatMessageId`**) |

**Реализации в сервере:** **`packages/server/src/utils/SSEStreamer.ts`** — прямой **`res.write`**; **`packages/server/src/queue/RedisEventPublisher.ts`** — зеркальные **`publish(chatId, JSON.stringify({ chatId, eventType, … }))`**. Ноды в **`packages/components/nodes/**`** берут **`options.sseStreamer`** и вызывают те же методы — смена версии пакета требует синхронизации интерфейса, подписчика и UI.

### 3.3.3. Flowise: расширения **`SSEStreamer`** / **`RedisEventPublisher`** вне **`IServerSideEventStreamer`**

**Файл интерфейса:** **`packages/components/src/Interface.ts`** (**`IServerSideEventStreamer`**, ~стр. 426). В нём **нет** трёх методов, которые есть у **`SSEStreamer`** и **`RedisEventPublisher`** (`packages/server/src/utils/SSEStreamer.ts`, `packages/server/src/queue/RedisEventPublisher.ts`):

| Метод (сервер) | В **`Interface.ts`** | Wire / Redis **`eventType`** | Заметка |
|----------------|----------------------|------------------------------|---------|
| **`streamErrorEvent(chatId, msg)`** | нет | **`error`** | Нормализация текста для **`401 Incorrect API key…`**; SSE-кадр через **`message\ndata:`** (без **`:`** после **`message`**) — как **`streamAbortEvent`** (**§3.3.1**). |
| **`streamMetadataEvent(chatId, apiResponse)`** | нет | **`metadata`** (через **`streamCustomEvent`**) | Собирает **`metadataJson`** из полей ответа; при непустом объекте зовёт **`streamCustomEvent(chatId, 'metadata', metadataJson)`** — тот же **`event`** в SSE, что у явного **`metadata`** в **`RedisEventSubscriber`**. |
| **`streamTTSAbortEvent(chatId, chatMessageId)`** | нет | **`tts_abort`** | В **`SSEStreamer`**: **`event: 'tts_abort'`**, **`data: { chatMessageId }`**, затем **`response.end()`** и **`delete this.clients[chatId]`** — жёсткое закрытие SSE-сессии. |

**Drift in-process vs queue для метаданных:** в **`SSEStreamer.streamMetadataEvent`** в **`metadataJson`** попадают ещё **`followUpPrompts`** и **`flowVariables`** (с **`JSON.parse`** при строке). В **`RedisEventPublisher.streamMetadataEvent`** — только подмножество полей (**`chatId`**, **`chatMessageId`**, **`question`**, **`sessionId`**, **`memoryType`**); **`followUpPrompts`** и **`flowVariables`** в **MODE.QUEUE** через Redis **не** публикуются. Для GC: при копировании идеи «единый стример + Redis-мост» важно не расщеплять состав события между процессами.

**Потребители:** контроллеры/SQLite-путь и воркер могут передавать в **`sseStreamer`** фактическую реализацию; TypeScript у нод описывает **`IServerSideEventStreamer`**, поэтому вызовы **`streamErrorEvent`** / **`streamMetadataEvent`** / **`streamTTSAbortEvent`** — в основном из **сервера** (predictions, очередь), а не из типизированного контракта компонентов. Расширять **`Interface.ts`** или вводить **`IServerSideEventStreamer & { … }`** — продуктовое решение репозитория Flowise.

### 3.4. Langflow: стриминг событий (LFX serve vs backend API)

**Headless `lfx` — `src/lfx/src/lfx/cli/serve_app.py`**

- Один JSON-файл и папка с несколькими графами оба собираются в **`create_multi_serve_app`**: у каждого flow префикс **`/flows/{flow_id}`**, стрим — **`POST /flows/{flow_id}/stream`** (рядом **`POST …/run`**, **`GET …/info`**), глобально **`GET /flows`**, **`GET /health`**.
- Ответ: **`text/event-stream`**; **`create_stream_tokens_event_manager`** (`lfx/events/event_manager.py`) + две **`asyncio.Queue`** (события и **`client_consumed`**). **`consume_and_yield`** — **в самом `serve_app.py`**; тот же паттерн, что в **`api/v1/endpoints.py`** (**§3.4.2**), но отдельная копия кода.
- Тесты **`test_serve_app_streaming.py`**: **`content-type`**, **`x-api-key`**.
- **Факт текущего прогона в `run_flow_generator_for_serve`:** вызывается **`execute_graph_with_capture(graph, input_request.input_value)`** **без** проброса **`event_manager`** в движок — в очередь попадают в основном финальные **`on_end`** / **`on_error`** (см. **§3.4.1**). Плотный **token** / **`add_message`**-стрим — **§3.4.2** (**`run_flow_generator`** в **`endpoints.py`** + **`run_graph_internal`** с **`event_manager`**), не этот участок CLI.

**Полный backend Langflow — `src/backend/base/langflow/api/`**

- **`build.py`**: SSE при **сборке** графа в редакторе (`DisconnectHandlerStreamingResponse`) — не то же самое, что run production, но полезно как образец **разрыва соединения** и потока событий build-job.
- **`log_router.py`**: SSE логов (`/logs-stream`).
- **`api/v2/workflow.py`**: Developer Workflow API — **§3.4.3** (`POST /api/v2/workflows`: **sync** и **background** в коде; **`stream=true`** → **HTTP 501**; плотный run-SSE по-прежнему **`/api/v1/run/...`** — **§3.4.2**).

**Для GC (фаза 8):** ориентир **LFX**: одна строка NDJSON ≈ один event в очередь ≈ одна строка SSE data; не обязательно SSE, но **паттерн producer → queue → транспорт** совпадает с планом «раннер печатает JSON построчно → UI читает». Формат очереди и **bytes**-чанк без префикса **`data:`** — **§3.4.1**; **проброс `event_manager` в граф** и маршруты FastAPI — **§3.4.2**.

### 3.4.1. LFX `serve_app`: формат потока, очереди и оговорка про SSE

Код: **`src/lfx/src/lfx/cli/serve_app.py`**, **`src/lfx/src/lfx/events/event_manager.py`**.

**Маршрут:** **`POST /flows/{flow_id}/stream`** (тот же префикс, что у **single-flow** и **multi-flow** CLI-serve), тело **`StreamRequest`** (`input_value`, `input_type`, `output_type`, `output_component`, `session_id`, `tweaks`), ответ **`StreamingResponse`** с **`media_type="text/event-stream"`**, авторизация **`x-api-key`** или query (как у **`/run`**). Параллельно **`asyncio.create_task(run_flow_generator_for_serve, …)`**; при обрыве клиента **`StreamingResponse(background=on_disconnect)`** отменяет задачу.

**Исполнение и «насыщенность» стрима:** **`run_flow_generator_for_serve`** await’ит **`execute_graph_with_capture(graph, input_request.input_value)`**, затем **`event_manager.on_end(data={"result": result_data})`** или при исключении **`on_error`**. **`event_manager`** в **`execute_graph_with_capture` не передаётся** — промежуточные **`token`** / **`add_message`** из движка графа **в этот путь не попадают**; зарезервированные имена событий в **`create_stream_tokens_event_manager`** отражают **контракт**, совместимый с полным стеком (**§3.4.2**), а не текущий объём CLI. Для сравнения плотного стрима с **GC** — **§3.4.2**, не только **`serve_app`**.

**Очередь событий:** **`asyncio.Queue()`** без `maxsize` — **`EventManager.send_event`** кладёт **`(event_id, value_bytes, put_time)`**, где **`value_bytes`** — UTF-8 **`json.dumps({"event": <строка>, "data": <jsonable>}) + "\n\n"`** (**`jsonable_encoder`** для **`data`**), **`event_id`** вида **`<event_type>-<uuid>`**.

**`event` в `create_stream_tokens_event_manager` (поле JSON `event`):** регистрация **`on_*` → имя в потоке:**

| `event` (wire) | Callback `EventManager` |
|----------------|-------------------------|
| `add_message` | `on_message` |
| `token` | `on_token` |
| `end` | `on_end` |
| `end_vertex` | `on_end_vertex` |
| `error` | `on_error` |
| `build_start` | `on_build_start` |
| `build_end` | `on_build_end` |

**Выдача в HTTP:** **`consume_and_yield`** (в **`serve_app.py`**) в цикле **`await queue.get()`**; сентинел **`(None, None, time.time())`** в **`finally`** у **`run_flow_generator_for_serve`**. Успешный кадр — **`yield value`** (**bytes**, **без** префикса **`data: `**). Ошибка **инициализации** стрима — отдельный генератор с **`data: {"error":…,"success":false}\n\n`** (здесь уже **честный SSE**-префикс).

**Очередь «клиент прочитал»:** после **`yield`** — **`client_consumed_queue.put_nowait(event_id)`**; после **`on_end`** — **`await client_consumed_queue.get()`** перед **`finally`** с сентинелом — **точечная синхронизация** «кадр **`end`** ушёл» (лог **`debug`** с задержками), не полный bounded backpressure (**§39.2**).

**Смысл для GC:** **`Media-Type: text/event-stream`** при теле **без** `data:` — **EventSource** в браузере может не съесть без адаптера (**§39**); паттерн **очередь + подтверждение** — опциональный референс для моста по **`runId`**.

### 3.4.2. Langflow backend `api/v1/endpoints.py`: плотный run-stream и webhook SSE

**Файл (от корня `langflow-main`):** **`src/backend/base/langflow/api/v1/endpoints.py`**. Импорт **`create_stream_tokens_event_manager`** из **`langflow.events.event_manager`** — тонкий re-export из **`lfx/events/event_manager.py`** (тот же **`EventManager.send_event`**, что в **§3.4.1**). Функция **`consume_and_yield`** определена **в этом же файле** (дублирует логику **`serve_app.py`**, **§3.4.1**).

**Плотный стрим прогона flow при `stream=True`:** общая логика — **`_run_flow_internal`**. Создаются **`asyncio.Queue()`** (события) и вторая очередь **`client_consumed`**, **`event_manager = create_stream_tokens_event_manager(queue=…)`**, фоновая задача **`run_flow_generator`**. Ответ — **`StreamingResponse(consume_and_yield(…), background=on_disconnect, media_type="text/event-stream")`**: при обрыве HTTP **`on_disconnect`** вызывает **`main_task.cancel()`**.

**Отличие от §3.4.1:** **`run_flow_generator`** вызывает **`simple_run_flow(..., stream=True, event_manager=event_manager)`** → **`run_graph_internal(..., stream=True, event_manager=event_manager)`** — **`event_manager` доходит до движка**, поэтому в очередь попадают **`token`**, **`add_message`**, **`end_vertex`**, **`build_*`** и т.д. по мере исполнения (не только финальный **`on_end`** / **`on_error`**). После успешного **`simple_run_flow`**: **`event_manager.on_end(data={"result": result.model_dump()})`**, затем **`await client_consumed_queue.get()`** (синхронизация с **`consume_and_yield`** после выдачи кадра **`end`**), в **`finally`** — сентинел в очередь с **`value is None`**.

**HTTP-маршруты с этой веткой** (префикс приложения **`/api`** + роутер **`/v1`** → **`/api/v1/...`**): **`POST /api/v1/run/{flow_id_or_name}`** (**Bearer** API key, **`api_key_security`**) и **`POST /api/v1/run/session/{flow_id_or_name}`** (куки; **`include_in_schema=False`**; при выключенном **`agentic_experience`** — **404**). Оба делегируют **`_run_flow_internal`**. Тело и **`stream`** — **`SimplifiedAPIRequest`**, глобальные переменные из **`X-LANGFLOW-GLOBAL-VAR-*`**.

**Формат тела стрима:** как **§3.4.1** — **`consume_and_yield`** отдаёт **bytes** с **`json.dumps({"event": <str>, "data": …}) + "\n\n"`** (**без** префикса **`data: `** на кадр). Карта **`on_*` → `event`** — таблица **§3.4.1**.

**Тот же файл — другой контур: `GET /api/v1/webhook-events/{flow_id_or_name}`** (**`include_in_schema=False`**): подписка на **`webhook_event_manager`**, первая строка — **`event: connected\ndata: …\n\n`**, далее цикл **`event: <тип>\ndata: <json>\n\n`** из очереди; при **`asyncio.wait_for(..., SSE_HEARTBEAT_TIMEOUT_SECONDS)`** с **30 s** (константа в **`endpoints.py`**) и **`TimeoutError`** — **`event: heartbeat`**. Заголовки **`Cache-Control: no-cache`**, **`Connection: keep-alive`**, **`X-Accel-Buffering: no`**. Это **события вебхука/progress для UI**, не тот же байтовый формат, что **`consume_and_yield`** run-stream.

**Для GC:** эталон **«раннер с **`event_manager`** против headless serve без него»**; при проектировании моста не смешивать **два SSE-стиля** в одном клиенте (сырой JSON chunk vs **`event:`/`data:`**).

### 3.4.3. Langflow **`api/v2/workflow.py`**: Developer API (sync, background, **stream=501**)

**Файл (от корня `langflow-main`):** **`src/backend/base/langflow/api/v2/workflow.py`**. Роутер: **`prefix="/workflows"`** + корневой **`/api`**, **`/v2`** в **`api/router.py`** → **`POST` / `GET` / `POST …/stop`** на **`/api/v2/workflows`**. (Строка в модульном докстринге про **`POST /workflow`** не совпадает с фактическим префиксом.)

**Ограждение и доступ:** **`Depends(check_developer_api_enabled)`** — при **`settings.developer_api_enabled` is False** → **403** с кодом **`DEVELOPER_API_DISABLED`**. **`api_key_security`** на эндпойнтах.

**`POST ""` (`execute_workflow`):**

| Флаги запроса | Поведение (по коду) |
|---------------|---------------------|
| **`background=true`** | **`execute_workflow_background`**: **`job_service.create_job`**, **`task_service.fire_and_forget_task`** с **`run_graph_internal(..., stream=False)`**, ответ **`WorkflowJobResponse`** (**`job_id`**, **`status=QUEUED`**). |
| **`stream=true`** | **`HTTP 501`**, тело **`NOT_IMPLEMENTED`**, текст **`Streaming execution not yet implemented`**. Нет **`StreamingResponse`** и нет связки с **`create_stream_tokens_event_manager`** (**§3.4.2**). |
| иначе (sync) | **`execute_sync_workflow_with_timeout`**: **`asyncio.wait_for(..., timeout=300)`** → **`run_graph_internal(..., stream=False)`** через **`job_service.execute_with_status`**, **`RunResponse`** → **`WorkflowExecutionResponse`**. |

**Замечание по докстрингу `execute_workflow`:** там по-прежнему фигурируют формулировки «streaming / background not yet implemented»; по факту **background** и **sync** реализованы, **stream** — явный **501**.

**Статус и стоп:** **`GET /api/v2/workflows?job_id=`** — **`WorkflowExecutionResponse`** / **`WorkflowJobResponse`** по **`JobService`**; **`POST /api/v2/workflows/stop`** — **`revoke_task`**, **`JobStatus.CANCELLED`**.

**OpenAPI / примеры:** в **`lfx/schema/workflow.py`** (**`WorkflowExecutionRequest`**, блоки ответов для **`stream`**) фигурирует **`text/event-stream`**; фактический **`execute_workflow`** при **`stream=True`** отдаёт **501** — дрейф контракта в open repo.

**Для GC:** публичный streaming execution для Langflow в open repo — ось **`§3.4.1`** / **`§3.4.2`**, не **v2 workflows**; при сравнении с **хост BFF** не предполагать **`POST /api/v2/workflows`** + **`stream`** до смены кода upstream.

### 3.5. ComfyUI: WebSocket-транспорт и типы сообщений

**Подключение:** HTTP-маршрут **`GET /ws`**, опциональный query **`clientId`** (`server.py` — `websocket_handler`). При отсутствии id выдаётся новый `sid`; сокет кладётся в **`PromptServer.sockets[sid]`**.

**Каркас JSON-сообщений:** метод **`send_json`** формирует объект **`{"type": <имя_события>, "data": <полезная_нагрузка>}`** и шлёт через **`ws.send_json`**. Потокобезопасная отправка с рабочих потоков: **`send_sync`** через **`loop.call_soon_threadsafe`** вызывает **`messages.put_nowait((event, data, sid))`**; корутина **`publish_loop`** в цикле **`await self.messages.get()`** и **`await self.send(*msg)`**. Очередь **`PromptServer.messages`** — **`asyncio.Queue()`** (по умолчанию **без** `maxsize`) и **не** то же самое, что **`PromptQueue`** для исполнения графа — **§13.3**.

**Каталог JSON-`type` (исходящие, ядро open repo):** в **`send_json`** поле **`type`** совпадает с первым аргументом **`send_sync`** / **`send`** для строковых событий. Ниже — типы, зафиксированные в **`server.py`**, **`main.py`**, **`execution.py`**, **`comfy_execution/progress.py`**, **`api_server/services/terminal_service.py`**. Расширения из **`custom_nodes/`** — **§3.5.1** (отдельная инсталляция = ядро + локальный набор пакетов).

| `type` | Источник (уровень B) | `data` (кратко) |
|--------|----------------------|-----------------|
| `status` | **`server.queue_updated`** | `status`: `get_queue_info()` → **`queue_remaining`** и др. |
| `executing` | **`main`**, **`execution`** | `node`, `display_node`, `prompt_id`; **`node: null`** — старт/завершение этапа prompt. |
| `executed` | **`execution`** | `output` (UI), `node`, `display_node`, `prompt_id`. |
| `progress` | **`main`** (progress hook) | `value`, `max`, `prompt_id`, `node`, … |
| `progress_state` | **`comfy_execution/progress.py`** **`_send_progress_state`** | `prompt_id`, **`nodes`**: снимок состояний нод (не только одна нода). |
| `execution_start` | **`execution`** **`PromptExecutor.add_message`** | `prompt_id`; **`timestamp`** добавляется в **`add_message`**. |
| `execution_cached` | то же | `prompt_id`, **`nodes`** — список нод, взятых из кэша. |
| `execution_success` | то же | `prompt_id` при нормальном завершении цикла исполнения. |
| `execution_interrupted` | **`handle_execution_error`** | `InterruptProcessingException`: `prompt_id`, `node_id`, `executed`, … |
| `execution_error` | **`execution`** (прямой **`send_sync`** и **`add_message`**) | детали сбоя ноды / стека (два пути — один тип в UI). |
| `feature_flags` | **`server`** **`websocket_handler`** (ответ на клиента) | возможности сервера (**`feature_flags.get_server_features()`**) после первого сообщения клиента с **`type: feature_flags`**. |
| `logs` | **`terminal_service`** | **`entries`**, **`size`** — поток терминала в UI (опциональная фича API-сервера). |

**Входящее от клиента (первое сообщение):** в **`websocket_handler`** ожидается JSON с **`type: feature_flags`** и телом флагов клиента — дальше сервер шлёт ответ **`feature_flags`** выше. Иные типы и ноды могут добавлять произвольные **`type`** (**`app/assets/seeder.py`**: **`send_sync(event_type, data)`**); интеграции не должны считать enum замкнутым.

**Бинарные кадры:** превью изображений и пр. через **`send_bytes`** / **`protocol.BinaryEventTypes`** (`protocol.py`, целочисленный тип кадра + полезная нагрузка), не через JSON-оболочку:

| Константа | Значение | Где используется (уровень B) |
|-----------|----------|------------------------------|
| `PREVIEW_IMAGE` | 1 | **`server.py`** `send_bytes` — сжатый превью-кадр |
| `UNENCODED_PREVIEW_IMAGE` | 2 | **`main.py`** / прогресс без лишнего кодирования |
| `TEXT` | 3 | **`send_sync`** текстовые вставки в сокет |
| `PREVIEW_IMAGE_WITH_METADATA` | 4 | **`comfy_execution/progress.py`**, **`server.py`** — превью + метаданные |

**Фрейминг binary WebSocket:** **`server.encode_bytes`** — **`struct.pack(">I", event)`** (4 байта, **big-endian UInt32** типа кадра) **+** полезная нагрузка. **`PREVIEW_IMAGE`**: **`send_image`** собирает тело (**UInt32 BE** подтипа JPEG/PNG, далее байты картинки) и вызывает **`send_bytes(BinaryEventTypes.PREVIEW_IMAGE, …)`** — на wire первый UInt32 всегда **`1`**. Внутренний **`UNENCODED_PREVIEW_IMAGE`** (константа **`2`** в **`progress`/`main`**) в **`send`** перенаправляется в **`send_image`** и тоже уходит клиенту как кадр с типом **`PREVIEW_IMAGE`**, не **`2`**; это ветка для клиентов **без** **`supports_preview_metadata`**, пока **`PREVIEW_IMAGE_WITH_METADATA`** недоступен. **`PREVIEW_IMAGE_WITH_METADATA`**: первый UInt32 кадра **`4`**, тело — **UInt32 BE** длины UTF-8 JSON, JSON, сырые байты картинки. **`TEXT`**: тип кадра **`3`**, полезная нагрузка — переданные байты.

**Для GC:** тот же паттерн, что у вас в плане — **стабильный словарь событий + `prompt_id`/`run_id`**, но Comfy привязан к **одному** `client_id` исполнения; для нескольких параллельных Run в GC лучше заложить **идентификатор сессии в каждое событие** (уже близко к NDJSON-строкам раннера). Сравнение транспортов (WS/SSE/NDJSON) — **§39**; отделение очереди run от буфера к сокету — **§13.3**.

### 3.5.1. ComfyUI: **`custom_nodes/`**, загрузка расширений и произвольные **`type`**

**Путь на диске:** **`folder_paths.py`** регистрирует ключ **`custom_nodes`** → список каталогов (по умолчанию **`…/custom_nodes`** рядом с приложением); пакет может добавить путь через **`add_model_folder_path`**.

**Загрузка:** **`nodes.py`** — **`init_external_custom_nodes`**: обход подкаталогов/файлов в каждом пути **`custom_nodes`**, пропуск **`.disabled`**, опционально **`args.disable_all_custom_nodes`** + **`whitelist_custom_nodes`**. **`load_custom_node`**: **`importlib`** модуля; поддержка **V1** (**`NODE_CLASS_MAPPINGS`**, **`NODE_DISPLAY_NAME_MAPPINGS`**) и **V3** (**`comfy_entrypoint`** → **`ComfyExtension`**); опционально **`pyproject.toml`** (**`comfy_config`**, **`WEB_DIRECTORY`** / **`tool_comfy.web`**) для фронтовых ассетов; дубликаты имён нод отлавливаются через **`base_node_names`**.

**Тот же механизм** с другим **`module_parent`** подключает **`comfy_extras`** и **`comfy_api_nodes`** (**`init_builtin_extra_nodes`**, **`init_builtin_api_nodes`** в **`nodes.init_extra_nodes`**, вызов из **`main.py`**).

**WebSocket JSON-`type`:** в ядре таблица **§3.5**; код ноды (включая **custom**) может вызывать **`PromptServer.instance.send_sync(строка, данные)`** / **`send_json`** с **любой** строкой **`type`** — **центрального реестра** исходящих типов в рантайме нет. Практическая инвентаризация для форка/деплоя: **grep** / статический обход по **`custom_nodes/**/*.py`** (и по **`comfy_extras`**) плюс **`logs`** при типичном прогоне, а не только open-repo upstream.

**Смежно, не wire:** **`app/custom_node_manager.py`** — карта пакетов и примеров workflow; **`app/subgraph_manager.py`** — привязка subgraph к имени пакета **`custom_nodes.*`** — **не** заменяет каталог **`type`**.

**Для GC:** при сравнении с Comfy как эталоном «живого» UI фиксировать, что **контракт сокета зависит от набора установленных нод**; для **хост** предпочтительнее **закрытый enum `run-event`**, а не открытый список строк как у сторонних Comfy-нод.

### 3.6. Dify: от GraphEngine до клиентской очереди

**Внутри движка:** события — типизированные классы в **`api/graphon/graph_events/`** (`GraphRunStartedEvent`, `NodeRunStreamChunkEvent`, успех/ошибка ноды, пауза, human input, итерации/циклы и т.д.), общий предок **`GraphEngineEvent`**.

**Слой приложения:** **`core/app/apps/workflow_app_runner.py`**, метод **`_handle_event`**: по `isinstance(event, …)` сопоставляет событие движка с **очередными сущностями** (`QueueWorkflowStartedEvent`, `QueueWorkflowSucceededEvent`, `QueueNodeRetryEvent`, …) и публикует их дальше (**`_publish_event`**) — уже контракт API/Streaming для web и фоновых задач.

**Смысл для GC:** два уровня — **(1) внутренние события раннера** (как Graphon), **(2) нормализованный поток для UI** (как Queue*). Копировать Dify не нужно; при расширении консоли GC иметь в виду **маппинг «движок → UI-модель»**, если типов событий станет много. Цепочка до HTTP **`data:`/`event:`** — **§3.6.1**; разбор **`listen()`** → **`StreamResponse`** — **§3.6.2**; **плоский dict** перед SSE — **§3.6.3**.

### 3.6.1. Dify: от `Queue*` до HTTP (очередь в процессе и честный SSE)

Код (от корня **`dify-main/api/`**): **`core/app/apps/workflow_app_runner.py`** (`WorkflowBasedAppRunner._handle_event`, `_publish_event`), **`core/app/apps/base_app_queue_manager.py`** (`AppQueueManager`), **`core/app/apps/workflow/app_queue_manager.py`** (`WorkflowAppQueueManager`), **`core/app/apps/workflow/generate_task_pipeline.py`**, **`core/app/apps/workflow/generate_response_converter.py`** (`WorkflowAppGenerateResponseConverter`), **`core/app/apps/base_app_generator.py`** (`BaseAppGenerator.convert_to_event_stream`), **`libs/helper.py`** (`compact_generate_response`).

**Поток:**

1. **Движок → продукт:** как в **§3.6**: события **Graphon** мапятся в типы очереди **`Queue*`** (старт/успех workflow, чанки текста из **`NodeRunStreamChunkEvent`**, ноды, итерации, human input, ошибки и т.д.) и публикуются через **`queue_manager.publish(..., PublishFrom.APPLICATION_MANAGER)`**.

2. **Буфер исполнение↔HTTP:** **`AppQueueManager`** держит **`queue.Queue`** (без **`maxsize`**); при старте — Redis **`setex`(..., `1800`, …)** на ключ **`generate_task_belong:{task_id}`** (`account` / `end-user` + **`user_id`**) — привязка task↔user (~30 мин). **`listen()`**: цикл **`_q.get(timeout=1)`**; при **`queue.Empty`** итерация продолжается без yield; в **`finally`** каждой итерации — если **`elapsed >= APP_MAX_EXECUTION_TIME`** или **`_is_stopped()`** (Redis **`generate_task_stopped:{task_id}`**, **`setex(..., 600, 1)`** при **`set_stop_flag`** / **`set_stop_flag_no_user_check`**) — **`publish(QueueStopEvent(...), PublishFrom.TASK_PIPELINE)`** (условие может срабатывать на следующих оборотах цикла, пока **`stop_listen`** не положит **`None`**); **ping** — при **`elapsed_time // 10 > last_ping_time`** → **`QueuePingEvent`**, затем **`last_ping_time = elapsed_time // 10`** (~каждые 10 с **`start_time`**). **`stop_listen`** кладёт **`None`**, чистит belong-ключ. **`WorkflowAppQueueManager`** оборачивает **`WorkflowQueueMessage`**, **`stop_listen`** на финальных событиях.

3. **Очередь → объект стрима:** класс **`WorkflowAppGenerateTaskPipeline`** (`generate_task_pipeline.py`) внутри **`_process_stream_response`** итерирует **`queue_manager.listen()`** и переводит **`Queue*`** в типизированные **`StreamResponse`** (см. **§3.6.2**: явный **`match`**, **`break`**, **`_dispatch_event`**, опциональный TTS-обёрткой **`_wrapper_process_stream_response`**); наружу для streaming — генератор **`WorkflowAppStreamResponse`**, где после первого **`WorkflowStartStreamResponse`** на каждый кадр копируется **`workflow_run_id`**.

4. **Объект → строки для Flask:** **`WorkflowAppGenerateResponseConverter`** (**§3.6.3**) отдаёт для каждого кадра либо строку **`"ping"`**, либо **плоский `dict`** с полями **`event`** (enum продукта), **`workflow_run_id`** и телом подтипа (**`model_dump(mode="json")`**, отдельная ветка для ошибок и «simple»-режима для нод).

5. **SSE-фрейминг:** **`BaseAppGenerator.convert_to_event_stream`**: если на вход уже **`dict`**/`Mapping` (не генератор) — возвращает его **как есть** (не SSE-оболочка; другой путь ответа). Иначе внутренний генератор: для каждого элемента — если **`Mapping | dict`** → **`data: {orjson_dumps(message)}\n\n`**; иначе (строка, напр. **`"ping"`**) → **`event: {message}\n\n`** (имя события SSE без префикса **`data:`**). Далее **`compact_generate_response`** оборачивает генератор в **`Response`**, **`mimetype="text/event-stream"`**.

**Отличие от Flowise (**§3.3.1**):** в типичном монолите Dify исполнитель и держащий **`Response`** процесс сходятся в **одном Python-процессе** — буфер **`queue.Queue`**, без обязательного **Redis pub/sub** между воркером Bull и SSE (как при **`MODE=queue`** у Flowise). Вынесенные воркеры/очереди SaaS — отдельная тема деплоя, не смешивать с этой цепочкой файлов.

**Плагины:** в **`libs/helper.py`** есть **`length_prefixed_response`** (бинарный префикс к кадру, **`text/event-stream`**) для совместимости с plugin daemon — **не** считать тем же контрактом, что workflow **`data:`**-стрим выше.

**Для GC:** продуктовый enum **`event`** Dify **не** копировать в **`run-event`**: база остаётся **§3.7** (поле **`type`**). Имеет смысл укрепить аналог **`workflow_run_id`** — **`runId` на каждой строке NDJSON** (**§6** п.5, **§39.2** п.3).

### 3.6.2. Dify: `WorkflowAppGenerateTaskPipeline` — от `Queue*` к `StreamResponse`

**Файл:** **`core/app/apps/workflow/generate_task_pipeline.py`**. Базовый доступ к очереди и вспомогательные **`ping`/`error`** — вложенный **`BasedGenerateTaskPipeline`** (`core/app/task_pipeline/based_generate_task_pipeline.py`).

**`_process_stream_response`:** для каждого **`queue_message`** из **`listen()`** берётся **`event = queue_message.event`**, затем верхний уровень — **`match event`** (фиксированный порядок веток):

| Ветка `match` | Действие | Выход из цикла `for` над **`listen()`** |
|---------------|----------|----------------------------------------|
| **`QueueWorkflowStartedEvent`** | **`_resolve_graph_runtime_state`**, **`_handle_workflow_started_event`** (лог в БД для части **`invoke_from`**, **`WorkflowStartStreamResponse`**) | нет |
| **`QueueTextChunkEvent`** | **`_handle_text_chunk_event`** с **`queue_message`** (для TTS — **`tts_publisher.publish(queue_message)`** при включённом auto-play) | нет |
| **`QueueErrorEvent`** | **`_handle_error_event`** | **`break`** |
| **`QueueWorkflowFailedEvent`** | **`_handle_workflow_failed_and_stop_events`** | **`break`** |
| **`QueueWorkflowPausedEvent`** | **`_handle_workflow_paused_event`** | **`break`** |
| **`QueueStopEvent`** | то же, что и fail-path, со статусом **STOPPED** | **`break`** |
| **`case _`** | если **`_dispatch_event(...)`** вернул непустой список ответов — **`yield from`** | нет |

Остальные типы **`Queue*`** обрабатываются через **`_dispatch_event`**: сначала словарь **`_get_event_handlers()`** (`type(event)` → метод), иначе **`isinstance`** на **`QueueNodeFailedEvent`/`QueueNodeExceptionEvent`**, иначе на **`QueueWorkflowFailedEvent`/`QueueStopEvent`** (для прямых вызовов диспетчера; из **`match`** эти два уже отфильтрованы). Неизвестный тип — тихий пропуск (**`return`** без yield).

**Зарегистрированные в `_get_event_handlers` типы очереди:** **`QueuePingEvent`**, **`QueueErrorEvent`**, **`QueueTextChunkEvent`**, **`QueueWorkflowStartedEvent`**, **`QueueWorkflowSucceededEvent`**, **`QueueWorkflowPartialSuccessEvent`**, **`QueueWorkflowPausedEvent`**, **`QueueNodeRetryEvent`**, **`QueueNodeStartedEvent`**, **`QueueNodeSucceededEvent`**, **`QueueIterationStartEvent`**, **`QueueIterationNextEvent`**, **`QueueIterationCompletedEvent`**, **`QueueLoopStartEvent`**, **`QueueLoopNextEvent`**, **`QueueLoopCompletedEvent`**, **`QueueAgentLogEvent`**, **`QueueHumanInputFormFilledEvent`**, **`QueueHumanInputFormTimeoutEvent`**. (Часть из них на практике срабатывает через **`case _`**, т.к. в **`match`** нет отдельной ветки.)

**TTS:** при фиче **text_to_speech + autoPlay** обёртка **`_wrapper_process_stream_response`** между кадрами основного генератора вставляет **`MessageAudioStreamResponse`**, после основного потока — дозакачка аудио до **`TTS_AUTO_PLAY_TIMEOUT`** и **`MessageAudioEndStreamResponse`**; в конце **`tts_publisher.publish(None)`**.

**Строковый контракт `event` в JSON:** перечень значений — **`StreamEvent`** (**`StrEnum`**) в **`core/app/entities/task_entities.py`**: **`ping`**, **`error`**, **`message`**, **`message_end`**, **`tts_message`**, **`tts_message_end`**, **`message_file`**, **`message_replace`**, **`agent_thought`**, **`agent_message`**, **`workflow_started`**, **`workflow_paused`**, **`workflow_finished`**, **`node_started`**, **`node_finished`**, **`node_retry`**, **`iteration_started`**, **`iteration_next`**, **`iteration_completed`**, **`loop_started`**, **`loop_next`**, **`loop_completed`**, **`text_chunk`**, **`text_replace`**, **`agent_log`**, **`human_input_required`**, **`human_input_form_filled`**, **`human_input_form_timeout`**. В **`WorkflowAppGenerateResponseConverter.convert_stream_*`** поле **`event`** — **`sub_stream_response.event.value`**; кадр **`ping`** — отдельная строка **`"ping"`**, без **`workflow_run_id`** в том же виде, что у **`dict`** (см. **§3.6.1** п.5).

**Blocking:** **`stream=False`** — **`_to_blocking_response`** потребляет тот же генератор до **`ErrorStreamResponse`** (исключение), **`WorkflowPauseStreamResponse`** или **`WorkflowFinishStreamResponse`** и возвращает **`WorkflowAppBlockingResponse`**.

**Для GC:** ориентир — **жёсткое завершение** цикла по **`listen()`** через **`break`** при ошибке / fail / pause / stop (клиентская семантика «закрыть стрим») vs промежуточные события до **`stop_listen`/`None`**; для интеграции с Dify OpenAPI — держать рядом **`StreamEvent`** и фактическую форму dict (**§3.6.3**), не дублировать enum в GC **`run-event`**.

### 3.6.3. Dify: `WorkflowAppGenerateResponseConverter` — **full** / **simple** и форма dict

**Файл (от корня `dify-main/api/`):** **`core/app/apps/workflow/generate_response_converter.py`**. Общая развилка — базовый **`AppGenerateResponseConverter.convert`** (**`base_app_generate_response_converter.py`**): при **`InvokeFrom.DEBUGGER`** или **`InvokeFrom.SERVICE_API`** вызываются **`convert_*_full_*`**; иначе — **`convert_*_simple_*`** (**урезанный** поток для части клиентов).

**Каждый кадр** внутри **`convert_stream_*`:** ожидается **`WorkflowAppStreamResponse`** (**`task_entities`**) с полями **`workflow_run_id`** и вложенным **`stream_response`** (конкретный подкласс **`StreamResponse`**).

| Шаг | Поведение |
|-----|-----------|
| **`PingStreamResponse`** | В поток **`yield`** идёт строка **`"ping"`**, не **`dict`** (дальше **`BaseAppGenerator.convert_to_event_stream`** отдаёт **`event: ping\n\n`** — **§3.6.1** п.5). |
| Остальные | Собирается **`dict`**: **`event`** = **`sub_stream_response.event.value`** (**`StreamEvent`**), **`workflow_run_id`** = с внешнего **`WorkflowAppStreamResponse`**; далее **`update`** тела. |
| **`ErrorStreamResponse`** | В **`update`** попадает не **`model_dump`**, а **`_error_to_stream_response(err)`** — плоские поля вроде **`code`**, **`status`**, **`message`** по типу исключения (**`base_app_generate_response_converter.py`**); плюс уже выставленные **`event`** / **`workflow_run_id`**. |
| **`convert_stream_full_response`** | Для всех прочих подтипов: **`sub_stream_response.model_dump(mode="json")`** — JSON-совместимые типы, в т.ч. вложенные **`data`** у **`NodeStartStreamResponse`** / **`NodeFinishStreamResponse`** и т.д. |
| **`convert_stream_simple_response`** | Для **`NodeStartStreamResponse`** и **`NodeFinishStreamResponse`**: вместо полного дампа — **`to_ignore_detail_dict()`** (**`task_entities.py`**) — **`inputs`** (и у finish ещё **`process_data`**, **`outputs`**, **`error`**, **`execution_metadata`**) → **`null`**, у start **`extras`** → **`{}`**, у finish **`files`** → **`[]`**, остаётся каркас для UI. |
| Прочие типы в **simple** | Как в **full**: **`model_dump(mode="json")`**. |

**Где заданы подтипы:** **`core/app/entities/task_entities.py`** — базовый **`StreamResponse`** (**`event`**, **`task_id`**), далее **`Message*StreamResponse`**, **`Workflow*StreamResponse`**, **`Node*StreamResponse`**, **`TextChunkStreamResponse`**, **`HumanInput*Response`**, **`AgentLogStreamResponse`**, **`PingStreamResponse`**, audio (**`tts_message`** / **`tts_message_end`**) и т.д. Полный перечень имён классов — в том же файле; **`StreamEvent`** (**`StrEnum`**) — строки wire-поля **`event`** (**§3.6.2**).

**Для GC:** два разных HTTP-представления одного внутреннего кадра (**full** vs **simple**) — учитывать, если сравнивать сниффинг API Dify с логами отладчика; для собственного моста **хост** достаточно одного контракта (**NDJSON + `type`**, **§3.7**).

### 3.7. GraphCaster (факт кода): события раннера и соответствие референсам

Источники: `python/graph_caster/runner.py` (`GraphRunner.emit`), `python/graph_caster/process_exec.py` (`run_task_process` → `emit`). Машиночитаемый контракт: **`schemas/run-event.schema.json`** (v0.1); паритет с примером графа проверяется в **`python/tests/test_run_event_schema.py`**.

**Форма записи:** каждое событие — **плоский** объект `dict`: **`{"type": "<строка>", ...поля}`** (всё на верхнем уровне). Это ближе к одной строке **NDJSON**, чем к оболочке Comfy **`{type, data}`** — при мосте в WebSocket можно оборачивать в `data` на границе, если нужна единообразная схема с **§3.5**.

**Полный закрытый enum `type`, обязательные поля по веткам и паритет с кодом** — только **`schemas/run-event.schema.json`** и раздел **«NDJSON `run-event`: полный перечень `type`»** в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); здесь — краткая иллюстрация для сопоставления с конкурентами (неисчерпывающий список).

| `type` (GC) | Где возникает | Аналог у конкурентов (уровень смысла) |
|-------------|--------------|----------------------------------------|
| `run_started` / `run_finished` | Жизненный цикл корневого прогона (**`runId`**, статусы **`success`** / **`failed`** / **`cancelled`** / **`partial`**) | n8n **`executionId`** + фазы run; Dify workflow run meta |
| `run_root_ready` | Корневой run, создан каталог артефактов | Comfy `status` + среда; Dify старт run / meta |
| `node_enter` / `node_execute` / `node_exit` | Визит ноды (в т.ч. comment); выход (опц. **`usedPin`**) | Comfy `executing` / `executed`; Dify шаги ноды |
| `process_spawn` / `process_complete` / `process_failed` / `process_retry` / `process_output` | Подпроцесс **`task`** (ретраи, чанки stdout/stderr) | n8n/Flowise/Dify инкрементальные логи шага; детали — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) |
| `stream_backpressure` | Dev run-брокер (**SSE** / **WS**): дроп **`process_output`** у медленного клиента | Политика буфера исполнитель↔транспорт — **§39.2**; факты — там же в **Implemented** |
| `structure_warning` / `node_cache_*` / `node_pinned_skip` / `node_outputs_snapshot` | Статика merge/fork/barrier/pin/**`ai_route`**, кэш шага, pinData-style | См. **F4** / **F17** / **`gcPin`** в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) |
| `ai_route_invoke` / `ai_route_decided` / `ai_route_failed` | Нода **`ai_route`** (wire v1) | Отдельный шаг маршрутизации vs n8n IF/Switch — там же (**«ИИ-ветвление»**) |
| `nested_graph_enter` / `nested_graph_exit` | Вход/выход из `graph_ref` | Dify child graph; n8n sub-workflow |
| `edge_traverse` / `branch_skipped` / `branch_taken` | Выбор исходящего ребра (**F4**); пропуски **`condition_false`** / **`ai_route_not_selected`**. Подсветка ребра на канвасе при **`edge_traverse`** / **`branch_taken`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«Визуализация прогона на канвасе»**) | Dify skip; n8n IF |
| `run_success` / `run_end` / `error` | **`exit`**, мягкий стоп, инварианты | Comfy / Dify fail / success события |

Цепочка **`task`:** `process_complete` (в т.ч. `success=false`) → при исчерпании ретраев **`process_failed`**; сопоставление с политиками конкурентов — **§16** (**F19**).

**Статус фазы 8** (мост UI ↔ раннер, **`process_output`**, dev SSE **backpressure**): единственный реестр фактов — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (разделы «Десктоп (Tauri)…», «Инкрементальный вывод подпроцесса **task**», «Backpressure SSE»). Перечень «закрыто/открыто» по этой фазе в этом файле **не** дублируется.

### 3.7.1. Стабильный **`runId`** и мост UI (фаза 8)

Канон фактов — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (раздел **«Стабильный `runId`…»** и **«Десктоп (Tauri)…»**). Здесь без повторения.

### 3.8. Vibe Workflow: BFF, **`httpx`** и REST **run** + **status** (без NDJSON в open repo)

**Назначение раздела:** зафиксировать, как в открытом репо **Vibe-Workflow-main** стартует прогон и как клиент узнаёт состояние, чтобы не путать это с **NDJSON** GraphCaster (**§3.7**) и с **SSE/WebSocket** у Dify/n8n/Flowise (**§39**).

**Слой BFF:** **`server/app/utils/workflow_helper.py`** — **`MU_API_KEY`** из env (**отсутствие** → **`HTTPException` 400** «Setup MU_API_KEY…»), единый **`proxy_request_helper`**: **`httpx.AsyncClient`**, заголовки **`Content-Type: application/json`** и **`x-api-key`**, поддерживаемые методы **только** **GET** / **POST** / **DELETE**, таймаут **60 s** на запрос. Тело ответа: при непустом **`response.content`** — **`response.json()`**; при **`ValueError`** парсинга — объект **`{"detail": …}`** из **`response.text`** или строки **`"Unknown error from remote server"`**. Возврат клиенту BFF **только** при **`status_code == 200`** (десериализованный JSON или **`{}`** если тело пустое); иначе **`HTTPException`** с **`status_code`** апстрима и **`detail = resp_json.get("detail", "Something went wrong")`**. Сетевые сбои **`httpx.RequestError`** → **500** «Error contacting remote server: …». Полный зеркальный каталог путей — **§3.8.1**.

**Ключевые маршруты исполнения** (локальный FastAPI; **`routers/workflow_router.py`**, префикс **`/api/workflow`** в **`main.py`**):

- **`POST /api/workflow/{workflow_id}/run`** → **`POST https://api.muapi.ai/workflow/{workflow_id}/run`** (**`run_workflow_helper`**, тело запроса JSON пробрасывается как **`payload`**).
- **`GET /api/workflow/run/{run_id}/status`** → **`GET https://api.muapi.ai/workflow/run/{run_id}/status`** (**`get_run_status_helper`**) — опрос после старта; **схема JSON ответа MuAPI** в open repo **не** зафиксирована (не **`run-event`**).
- **`POST /api/workflow/{workflow_id}/node/{node_id}/run`** → **`POST https://api.muapi.ai/workflow/{workflow_id}/node/{node_id}/run`** (**`run_node_helper`**).

**Отличие от GC:** в дереве Vibe **нет** эмиссии **`schemas/run-event.schema.json`** из Python — «истинный» раннер и пошаговые события **вне** открытого кода. Для **хост**/embed при **удалённом** раннере без push-стрима к BFF осознанный паттерн — **REST start** + **poll** (или позже свой **SSE** поверх **§3.7**, если бэкенд GraphCaster отдаёт поток — **§39**). Политика секретов BFF — **§25.3**, **§25** п.6.

### 3.8.1. Каталог **`workflow_helper` → MuAPI`** (уровень B)

Все URL — **`https://api.muapi.ai`** (хост зашит в коде). Локальный путь = **`/api/workflow`** + маршрут из **`workflow_router.py`**.

| Хелпер (Python) | HTTP | Путь MuAPI |
|-----------------|------|------------|
| **`create_or_update_workflow`** | POST | **`/workflow/create`** |
| **`get_workflow_defs_helper`** | GET | **`/workflow/get-workflow-defs`** |
| **`get_workflow_def_helper`** | GET | **`/workflow/get-workflow-def/{workflow_id}`** |
| **`get_node_schemas_helper`** | GET | **`/workflow/{workflow_id}/node-schemas`** |
| **`get_api_node_schemas_helper`** | GET | **`/workflow/{workflow_id}/api-node-schemas`** |
| **`delete_workflow_def_by_id`** | DELETE | **`/workflow/delete-workflow-def/{workflow_id}`** |
| **`update_workflow_name_helper`** | POST | **`/workflow/update-name/{workflow_id}`** |
| **`run_workflow_helper`** | POST | **`/workflow/{workflow_id}/run`** |
| **`get_run_status_helper`** | GET | **`/workflow/run/{run_id}/status`** |
| **`run_node_helper`** | POST | **`/workflow/{workflow_id}/node/{node_id}/run`** |
| **`publish_workflow_helper`** | POST | **`/workflow/workflow/{workflow_id}/publish`** |
| **`template_workflow_helper`** | POST | **`/workflow/workflow/{workflow_id}/template`** |
| **`cloudfront_signed_url_helper`** | POST | **`/workflow/cloudfront-signed-url`** |
| **`generate_thumbnail_helper`** | POST | **`/workflow/{workflow_id}/thumbnail`** |
| **`get_file_upload_url_helper`** | GET | **`/app/get_file_upload_url?…`** (query из **`params`**) |
| **`get_workflow_last_run`** | GET | **`/workflow/get-workflow-last-run/{workflow_id}`** |
| **`architect_workflow_helper`** | POST | **`/workflow/architect`** |
| **`poll_architect_result_helper`** | GET | **`/workflow/poll-architect/{id}/result`** |

**Для GC / планирования:** контракт «тонкий BFF + ключ в **`x-api-key`**» совпадает с **§25.3**; таблица даёт **проверяемую** картину **без** спецификации полей тел **run** / **status** у MuAPI — при интеграции **хост** их нужно брать из документации провайдера или трассировки, не из **graph-caster**.

---

## 4. Каталог фич и маппинг на слои GC

Легенда статусов: **да** / **частично** / **нет** / **n/a** (не в фокусе продукта).

### F1 — Визуальный графовый редактор (канвас, ноды, рёбра)

Углубление — **§28**.

| Продукт | Статус | Как устроено (уровень B) |
|---------|--------|---------------------------|
| ComfyUI | да | Свой canvas в Web UI: граф нод и **сокетов**; превью медиа на нодах; workflow JSON / встраивание в PNG. |
| Dify | да | **React**-консоль **`web/`**: редактор workflow приложения; черновик в SPA, сохранение в API (**Graphon**). |
| Flowise | да | **`packages/ui`** (**React** + **React Flow**); **Agentflow** — отдельное полотно в **`packages/agentflow`**. |
| Langflow | да | SPA (**React**) в дереве фронтенда; каталог компонентов синхронизируется с **LFX** на бэкенде. |
| n8n | да | **`packages/frontend/editor-ui`** (**Vue 3**): canvas, интеграционные ноды, **sticky notes**, сложные выходы, merge веток. |
| Vibe Workflow | да | **`workflow-builder`** + **Next.js** клиент. |
| **GraphCaster** | **частично** | Слой **B** (**полотно, инспектор, предупреждения**, **@xyflow/react**, ноды **`GcFlowNode`** / **`GcCommentNode`** / **`GcGroupNode`**): закрытые пункты **F1** / **§28.2** (канвас, **MiniMap**, поиск, clipboard, **group**, **snap/align**, **LOD**, **off-viewport ghost**, **ленивое превью `graph_ref`**, **F13**, открытие/Save …) — **единый SSOT** [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«Canvas: большие графы»** и смежные разделы); здесь перечень не дублировать. **Остаток F1:** **§15** (типизация пинов); **§29** (встраивание дочернего графа в **A** вне file-first). |

### F2 — Схема данных графа и миграции версий

Углубление — **§30**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | да | Формат **workflow/prompt** JSON; совместимость с **версией API** и наборами custom nodes; мягкая эволюция через клиент. |
| Dify | да | Workflow в **PostgreSQL** + конфиг **Graphon**; **миграции** моделей/API при релизах монолита. |
| Flowise | да | **`flowData`** (строка JSON) в сущности **ChatFlow**; миграции **ORM** (`packages/server`). |
| Langflow | да | Экспорт flow JSON; **миграции бэкенда** при обновлении инстанса; **`lfx`** потребляет актуальную схему компонентов. |
| n8n | да | JSON **workflow** + версия пакета **`n8n-workflow`**; **DB migrations** / core при апгрейде; несовместимые изменения — в changelog. |
| Vibe Workflow | частично | Проще модель; меньше формальной базы миграций, чем у n8n/Dify. |
| **GraphCaster** | **частично** | Слой **A**: **`graph-document.schema.json`**, поле **`schemaVersion`**, **`models.py`**, **`validate.py`**, тесты на сериализацию; опциональный **off-line** upgrade файлов — **§30.2**; **F23** упрощает «дифф в git», усложняет массовые миграции как у БД. |

### F3 — Рантайм: топологический обход и зависимости

Углубление — **§31**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | да | **`comfy_execution.graph`**: вычисление **DAG** нод и порядка исполнения с учётом **сокетов**; **кэш подграфов** при неизменных входах (**§22**-подобно). |
| Dify | да | **`GraphEngine`** (**Graphon**): очередь/шаги узлов, **variable pool**, события на каждом узле; ветвление — вместе с **F4**/**F19**. |
| Flowise | да | Сервер строит исполняемую цепочку (**LangChain** и др.) из chatflow; порядок из графа компонентов. |
| Langflow | да | **LFX**: обход компонентов по рёбрам flow; валидация связей — **`validate_handles`** и др. (**§15**). |
| n8n | да | Пакет **`n8n-workflow`**: граф связей, **merge** веток, **runData** по нодам; порядок с учётом **main** и побочных шин. |
| Vibe Workflow | да (в продукте) | В открытом репо **Python не обходит граф**: BFF шлёт JSON в **MuAPI** (**§25.3**); merge/**runData**-уровень скрыт в облаке. |
| **GraphCaster** | **частично** | Слой **D**: обход **`start`**→**`exit`**, **F4** (**§32**), вложение **`graph_ref`** (**§29**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md). **`merge`** **`barrier`** + **`fork`**: последовательный режим по умолчанию; **внутриграфовый** OS-параллель веток (bounded **`ThreadPoolExecutor`**, см. **Merge** там же) — срез **§31.2** п.4 для одного класса топологий; полный паритет **n8n Merge** / все варианты веток — **§13** / **F6**. Циклы и полная рантайм-«связность» с симуляцией **F4** — по-прежнему см. competitive. |

### F4 — Условное ветвление и несколько исходов из ноды

Углубление — **§32**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | частично | В основном dataflow, не «if/else» бизнес-логики; есть ноды-утилиты. |
| Dify | да | Ноды ветвления в `core/workflow/nodes`, условия в конфиге графа. |
| Flowise | да | Condition / Agent в Agentflow; условные рёбра в сценариях. |
| Langflow | да | Условная логика в компонентах и роутинге flow. |
| n8n | да | IF, Switch, фильтры, merge; выражения в условиях. |
| Vibe Workflow | частично | Зависит от набора нод в workflow-builder; не уровень n8n. |
| **GraphCaster** | **частично** | **D+B**, **§32**: рантайм ветвления, DSL условий (**`$json`**, **`$node`**, шаблоны, JSON Logic) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F4**); UI — **`branchWarnings`**. **Без** полноценного **n8n Expression** (JS sandbox). In-graph **`out_error`** (**F19**). Нода **`llm_agent`** (делегированный агент, subprocess, NDJSON **`agent_*`**) — **закрыто** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); **остаток** **F11** (полный in-runner цикл уровня **Dify**/**n8n**) — таблица **F11** ниже и **§23**. |

### F5 — Вложенные графы / сабфлоу / вызов другого workflow

Углубление — **§29**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | частично | **Subgraph** / кастомные ноды: чаще **инлайн** или дублирование, не ссылка **`graphId`** в общей папке как у GC. |
| Dify | да | **Child graph** в **Graphon** (билдер **`workflow_entry`**, ошибки вида **`ChildGraphNotFoundError`**); мост переменных parent/child. |
| Flowise | да | **Execute Flow** и вложенные chatflow: разрешение по id на сервере, контекст prediction. |
| Langflow | частично | Композиция flow и переиспользуемые участки; нет полного паритета «workflow id в БД как n8n» в каждом деплое. |
| n8n | да | Нода **Execute Workflow** / **Execute Sub-workflow**: ссылка на workflow id в инстансе, передача **items**/контекста, учёт глубины вызовов. |
| Vibe Workflow | частично | Шаблоны; слабее модель ссылок между независимыми файлами. |
| **GraphCaster** | **частично** | Слой **D+C**: **`kind`** **`graph_ref`**, **`graphId`**, загрузка из **`workspace.py`**, синхронный вложенный прогон (по умолчанию in-process **`GraphRunner`**); **опционально** отдельный процесс CLI на заход (**`GC_GRAPH_REF_SUBPROCESS`**) — факты в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F5**, раздел **«Вложенный `graph_ref`: опциональная изоляция…»**, таблица NDJSON **`type`**); события nested; лимит глубины; **циклы между файлами по `graphId`** — **закрыто:** там же (**F5**, «Статический цикл…»); прочее — **§29.2** (хост, async child run без **§13**, политика сбоев). |

### F6 — Очередь и асинхронные прогоны

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | да | **`PromptQueue`** в `execution.py`, жизненный цикл в `server.py` / `main.py` (**§13**). |
| Dify | да | **`AppQueueManager`** (`core/app/apps/base_app_queue_manager.py`), **`WorkflowAppGenerateTaskPipeline`** / **`based_generate_task_pipeline`**, **`workflow_app_runner`** — стрим в очередь (**§13**); очередь → SSE (**§3.6.1**–**§3.6.2**). |
| Flowise | да | Запросы к **`/prediction`** и др.; конкуренция — на уровне Node/HTTP (очередь как у n8n не в DNA). |
| Langflow | да | FastAPI + asyncio; **`lfx`** — отдельный процесс на прогон; массовый throughput — за счёт горизонтального масштаба API. |
| n8n | да | **`executions.mode`**: `regular` vs **`queue`** (scaling); **`ScalingService`**, **`job-processor`**, воркеры в `packages/cli/src/scaling/` (**§13**). |
| Vibe Workflow | частично | Запросы к API генерации; не job scheduler уровня n8n. |
| **GraphCaster** | **частично** | Слой **D**: один синхронный прогон на процесс CLI; **внутри** — **F6**-срез [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**`RunEventSink`**, **`StepQueue`**). Очередь **нескольких** прогонов / **n8n** queue / **asyncio**-пул — **§13**, вне текущего MVP. |

### F7 — Запуск внешних процессов / CLI (как Cursor CLI у GC)

Углубление — **§27**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | n/a | Ноды вызывают Python внутри процесса, не общий «shell task». |
| Dify | частично | Ноды с выполнением кода / изолированным runner (зависит от издания); основной контур — HTTP и встроенные сервисы, не «произвольный shell на каждую ноду». |
| Flowise | частично | Кастомные функции и tool-цепочки на стороне **Node**; произвольный **`argv`** ограничен архитектурой компонентов. |
| Langflow | частично | Headless **`lfx run`** — отдельный процесс на JSON-граф; отдельные компоненты теоретически могут вызывать **`subprocess`**. |
| n8n | да | **`Execute Command`** и родственные ноды на хосте; в enterprise/доках — предупреждения о безопасности, опционально изоляция деплоя (**Docker** и т.д.). |
| Vibe Workflow | нет | Фокус на HTTP к MuAPI через BFF; не **Execute Command** на хосте. |
| **GraphCaster** | **частично** | Слой **D**: нода **`task`** → **`process_exec.py`** (**`command`/`argv`**, пресет **`gcCursorAgent`** / Cursor Agent CLI — **закрыто:** [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md), подраздел **«Пресет Cursor Agent CLI»**); **`shlex`**, **`cwd`**, **`env`**, таймаут, лимит stdout, **`successMode`**, ретраи, **`process_*`** — **§27** (эталоны и нерешённый объём **F7** без дубля контракта). |

### F8 — Credentials, секреты, переменные окружения в графе

Углубление хранилища и подмешивания при run — **§11**; сравнение **«что лежит в сериализованном графе»** vs vault — **§35**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | частично | Пути моделей, ключи API nodes; не единый vault как в n8n. |
| Dify | да | Провайдеры моделей, credentials в API; `ENVIRONMENT_VARIABLE_NODE_ID` / variable pool. |
| Flowise | да | Components credentials, variables в `packages/server`. |
| Langflow | да | Global variables, настройки в backend, env для LFX. |
| n8n | да | Credentials store, шифрование, выражения `{{$credentials}}`. |
| Vibe Workflow | частично | **`MU_API_KEY`** в `server/.env`, прокси **`x-api-key`** (**§25.3**); не vault как у n8n/Dify. |
| **GraphCaster** | **частично** | Слой **F**, **file-first v1:** **`task.data.envKeys`** (только имена), файл **`.graphcaster/workspace.secrets.env`**, подмешивание env и маскирование в **`node_execute`** / **`node_outputs`** — факты в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«Workspace-секреты и `envKeys`»**). Полноценный vault / шифрование / RBAC как у n8n-Dify — **§11**, **§35**, **§20** (**F14**), не дублировать здесь. |

### F9 — Триггеры: расписание, webhook, события

Углубление **F9** — **§24**; совместно с публичным контуром **F12** — **§12**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | нет | Ручной или API submit prompt. |
| Dify | да | **`TriggerWebhookNode`** (`trigger_webhook/node.py`), **`TriggerScheduleNode`** (`trigger_schedule/trigger_schedule_node.py`), **`TriggerEventNode`** (`trigger_plugin/trigger_event_node.py`); в составе **`api/core/workflow/nodes/trigger_*`**. |
| Flowise | частично | Запуск чатфлоу/agentflow через REST (**`/prediction`**, **`/internal-prediction`** — **§12**); cron в продукте не как у n8n — внешний планировщик или хостинг. |
| Langflow | частично | Старт flow через REST / **`lfx run`**; **MCP** (**§3.4**); периодика — типично **вне** инстанса. |
| n8n | да | Ноды **`Webhook`** (`nodes-base/Webhook/Webhook.node.ts`), **`ScheduleTrigger`** (`nodes-base/Schedule/ScheduleTrigger.node.ts`), триггеры сервисов; **`WebhookServer`** + очередь (**§12**). |
| Vibe Workflow | нет | Клиент инициирует. |
| **GraphCaster** | **нет (пока)** | **§24.2** + **§12:** хост вызывает CLI/API; без ноды «Cron» в MVP. |

### F10 — RAG / knowledge base как часть платформы

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | нет | Не LLM-платформа. |
| Dify | да | Монолит **RAG**: `core/rag/`, ноды **`knowledge_retrieval`**, **`knowledge_index`**, **`DatasetRetrieval`**; переменные пайплайна **`RAG_PIPELINE_VARIABLE_NODE_ID`** (**§14**). |
| Flowise | да | Каталоги **`packages/components/nodes/vectorstores`**, **`documentloaders`**; цепочка load → embed → store на canvas. |
| Langflow | да | Типы **`VectorStore`**, **`Retriever`** (`lfx/field_typing`); базовый класс **`LCVectorStoreComponent`** (`lfx/base/vectorstores`); компоненты в `lfx/src/lfx/components`. |
| n8n | частично | **`@n8n/nodes-langchain`**: вставка/загрузка в vector store, **`RetrieverVectorStore`**, **`ToolVectorStore`**, связь **`AiVectorStore`**; нет единого dataset-слоя как у Dify (**§14**). |
| Vibe Workflow | нет | Креативный пайплайн. |
| **GraphCaster** | **нет** | Слой **F**: вне MVP; стратегии — **§14** (нода-обёртка vs внешний сервис). |

### F11 — Агенты, tools, orchestration LLM

Углубление — **§23**; **MCP (A)** — экспорт графа как tools — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); обзор конкурентов и **(B)** — **§34**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | n/a | Другой домен (diffusion); не LLM-агенты на графе. |
| Dify | да | **`core/workflow/nodes/agent/`**: **`AgentNode`**, **`AgentNodeData`**, **`AgentRuntimeSupport`** + **`ToolManager`**; стратегии (**`PluginAgentStrategyResolver`** и др.); Graphon-события в **`api/graphon/node_events/agent.py`** / **`graph_events/agent.py`**; каталог tools — **`core/tools`**. |
| Flowise | да | Отдельный продуктовый контур **Agentflow** (`agentflowId` в **`Execution`**, **`buildAgentflow`**, SSE **`nextAgent`** / **`agentFlow`** в **`SSEStreamer`/`RedisEventPublisher`**); ноды tools + генераторы (**`agentflowv2-generator`**). |
| Langflow | да | Каталог **`lfx/components/models_and_agents`**, **`lfx/base/agents`**, **`langchain_utilities/*_agent`**, **ALTK** / **agentics**; исполнение внутри вершины графа + стрим (**§3.4**). |
| n8n | да | Пакет **`@n8n/nodes-langchain`**: типы рёбер **`NodeConnectionTypes.AiAgent`**; узлы agents / tools / memory; ядро цикла — **`utils/agent-execution/`** (`buildSteps`, `createEngineRequests`, `memoryManagement`, HITL metadata на tools). |
| Vibe Workflow | нет | Генерация медиа через API без общего agent-runtime на canvas. |
| **GraphCaster** | **частично** | Реализованные срезы **F11** (**`ai_route`**, **`llm_agent`**) — факты реализации и пути только в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (в т.ч. **F17** для поддерживаемых типов нод — подраздел «Межпрогонный кэш…») и **`python/README.md`**; в этом файле — сравнение продуктов и **остаток** **F11**. Полный in-runner агент уровня **Dify**/**n8n** (ReAct, память, встроенный tool-calling) — **нет**; **§23**. |

### F12 — Публичный API и встраиваемость

Углубление **F12** — **§25** (**§25.3** — BFF); **MCP (A)** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); **MCP** (контуры **(B)** / публичный HTTP) — **§34**; совместно с триггерами **F9** — **§12**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | да | HTTP **`/prompt`**, WebSocket прогресса (**§3.5**); без полноценного multi-tenant BaaS. |
| Dify | да | Console + **service API**: приложения, workflow, completion/stream; сессии и ключи на tenant; GraphEngine за HTTP-фасадом. |
| Flowise | да | Express **`packages/server/src/routes/`** (`predictions`, `chatflows`, `apikey`, …); **Swagger** в **`api-documentation`**; публичный predict / internal-predict; embed-виджет. |
| Langflow | да | FastAPI **`langflow/api`** (v1/v2), **SSE** build/stream (**§3.4**); **MCP**; headless **`lfx run` / `serve`**. |
| n8n | да | **Public REST** (workflows, executions — зависит от edition); **webhook**-слой отдельно от UI; **API keys** (enterprise). |
| Vibe Workflow | частично | BFF **`/api/workflow`**, **`/api/app`** → MuAPI (**§25.3**); не полноценный SaaS API-key для третьих лиц из коробки. |
| **GraphCaster** | **частично** | **Фаза 8 (десктоп):** мост UI↔раннер — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**не** публичный BaaS); **фаза 10 / хост:** тонкий HTTP по **§25.2**; обзор **§12**. |

### F13 — Наблюдаемость: история run, трейсы, LLMOps

Подробное сравнение уровней B — **§17**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | частично | WebSocket **`progress`** / статусы нод (**§3.5**); без LLM-трейсера в core. |
| Dify | да | **`ObservabilityLayer`** (OpenTelemetry spans) + **`PersistenceLayer`** / **`TraceQueueManager`** (`core/app/workflow/layers/`); продуктовые логи приложений, внешние LLM-обсерверы. |
| Flowise | частично | Сущность **`Execution`** (`database/entities/Execution.ts`), **`services/executions`**, API **`routes/executions`**; evaluation/feedback — отдельные модули сервера. |
| Langflow | да | **`lfx/services/tracing/service.py`**, **`telemetry/service.py`**, подключаемые callbacks (LangSmith / Langfuse и др.); стрим SSE (**§3.4**). |
| n8n | да | **`ExecutionEntity`**, **`ExecutionRepository`** (`@n8n/db`), **`ActiveExecutions`**; UI истории; enterprise audit. |
| Vibe Workflow | минимально | Health / ответы API; без централизованной истории прогонов. |
| **GraphCaster** | **частично** | **G+E:** **`run-event.schema.json`**, папки артефактов, **`ConsolePanel`**, стрим (**`gc-run-event`**); **файловый журнал** (**`events.ndjson`**, **`run-summary.json`**, **History**); **оверлей статусов нод на канвасе** (live и replay из журнала, **`nodeRunOverlay.ts`** / **`GraphCanvas`**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); нет OTel и облачной БД **`Execution`** — **§17.2**. |

### F14 — Мультипользовательность, RBAC, SSO

Сводка уровня B — **§20**; граница repo/хоста для GC — **§38**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | частично | Нет встроенного tenant-моделя; доступ определяется сетью/прокси деплоя. |
| Dify | да | **`TenantAccountRole`** в **`api/models/account.py`** (OWNER, ADMIN, EDITOR, …); workspace/tenant в API и `web/`; enterprise SSO — продуктовый слой. |
| Flowise | частично | **`packages/server/src/enterprise`**: **`rbac/Permissions.ts`**, **`PermissionCheck`**, **`sso/`** (Google, Azure, Auth0, GitHub), **`workspace.service`**, **`organization`**, аудит. |
| Langflow | частично | Пользователи и проекты в серверном бэкенде; enterprise-опции (детали в релизах). |
| n8n | да | **`Project`** / **`ProjectRelation`**, **`OwnershipService`** (`packages/cli/src/services/ownership.service.ts`); **`Role`** пользователя; enterprise SSO и разграничение workflow/credentials по проекту. |
| Vibe Workflow | нет | Нет RBAC в репозитории. |
| **GraphCaster** | **нет** | **§20.2**, **§38:** идентичность и ACL — **хост**; GC принимает уже отфильтрованный путь/`graphId` (**§10**). |

### F15 — Расширяемость нод (плагины, marketplace)

Детали уровня B — **§18**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | да | Python-модули в **`comfy/`** и каталог **`custom_nodes/`**; регистрация классов нод при старте. |
| Dify | да | **`register_nodes()`** в **`api/core/workflow/node_factory.py`**: обход **`graphon.nodes`** и **`core.workflow.nodes`** → реестр **`Node.get_node_type_classes_mapping()`**; плагины агента (**`PluginAgentStrategy*`**); версии нод (**`LATEST_VERSION`**). |
| Flowise | да | Пакет **`packages/components`**: классы нод + **`Interface.ts`**; сервер подключает компоненты при исполнении; маркетплейс шаблонов на API. |
| Langflow | да | Каталог компонентов LFX, загрузка через **`lfx/interface/components.py`** (индекс, телеметрия загрузки); кастомные пакеты через entry points / настройки. |
| n8n | да | **`packages/nodes-base`** (`INodeTypeDescription`); community packages npm; CLI **`@n8n/create-node`**; enterprise-проверки. |
| Vibe Workflow | частично | Новые ноды в **`packages/workflow-builder`** + маршруты **`server/`**. |
| **GraphCaster** | **частично** | Замкнутый набор **`nodeKinds.ts`** / схемы; **`runner.py`** — `unknown_node` для неизвестного **`kind`**; без marketplace — **§18.2**. |

### F16 — Десктоп / офлайн-first

Углубление — **§33**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | да | Desktop app, portable. |
| Dify | нет | Серверный продукт. |
| Flowise | нет | Обычно server+browser. |
| Langflow | да | Langflow Desktop. |
| n8n | нет | Self-host server. |
| Vibe Workflow | нет | Next + FastAPI. |
| **GraphCaster** | **да (частично)** | **Tauri 2** + тот же **Vite**-фронт (**`ui/src-tauri/`**, **`tauri.conf.json`**): установщик (**NSIS** / **WiX**), **`com.graphcaster.desktop`**; раннер Python — снаружи оболочки (**§33.2**). |

### F17 — Инкрементальное исполнение / кэш между прогонами

Углубление — **§22**; связь ревизии документа на диске, **`schemaVersion`** и сброса кэша — **§36**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | да | **`comfy_execution/caching.py`** (`BasicCache`, `CacheKeySetInputSignature`), **`graph.py`** — `output_cache`, локальные подкэши рёбер; пересчёт только изменившегося subgraph. |
| Dify | частично | Внутри прогона: **`PersistenceLayer`** — `_node_execution_cache` (метаданные нод между фазами событий), не эквивалент Comfy-кэша по выходам; кэш LLM/данных — политика отдельных нод и слоёв. |
| Flowise | частично | Кэш эмбеддингов / vector store в компонентах; нет общего графового dirty-tracking как в Comfy. |
| Langflow | частично | **`api/build.py`** — кэш собранного графа по **`flow_id`** (`set_cache` / `get_cache`); компоненты с **`component_with_cache`**; не гарантирует общий межпрогонный кэш выходов всех вершин. |
| n8n | частично | **`workflow-execute.ts`**: **`pinData`**, **`runPartialWorkflow2`** (частичный прогон с `dirtyNodeNames` + прошлый **`runData`**); полный запуск без partial — как новый. |
| Vibe Workflow | нет / минимально | Медиа-пайплайн без акцента на кэш графа. |
| **GraphCaster** | **частично** | **Факты в коде** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md): «Частичный прогон», «Межпрогонный кэш выходов **`task`**, **`mcp_tool`** и **`ai_route`**» (в т.ч. **ревизия вложенного **`graph_ref`** в ключе**, поле **`nk`** в материале ключа), «Закреплённый вывод (**`gcPin`**)», транзитивная очередь **dirty** (успешные рёбра). **Зазор к n8n Comfy-grade F17:** расширение step-cache на прочие типы исполняемых нод (помимо этих трёх), TTL и лимиты размера кэша — **§22.2**, **§36**. |

### F18 — Типизация пинов / совместимость соединений

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | да | **`comfy_execution/validation.py`**, типы сокетов в определении ноды (**§15**). |
| Dify | да | **`GraphValidator`** и правила в **`api/graphon/graph/validation.py`**; **`node_factory`** (типизация `NodeData`); **`workflow_service.validate_graph_structure`** (**§15**). |
| Flowise | да | **`INodeData`** / **`INodeProperties`** в **`packages/components/src/Interface.ts`**; ориентированный граф — **`constructGraphs`** в **`packages/server/src/utils/index.ts`** (вызовы из **`buildChatflow.ts`**, **`buildAgentflow.ts`**). |
| Langflow | да | **`lfx/graph/edge/base.py`** — `validate_handles` / `validate_edge`; **`graph/base.py`** — валидация вершин и потока (**§15**). |
| n8n | да | Несколько видов рёбер — **`NodeConnectionTypes`** в **`packages/workflow`** (`main`, `AiAgent`, `AiVectorStore`, …); редактор и ран-тайм знают допустимые комбо. |
| Vibe Workflow | частично | Зависит от набора нод в `workflow-builder`. |
| **GraphCaster** | **частично** | **A+B:** именованные ручки **`in_default`/`out_default`/`out_error`**; статический контракт по **`node.type`** в UI + **`validate_graph_structure`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F18**). **Не** в MVP: типы портов (primitive/json/…), мультишины как у **n8n** — **§15.2**. |

### F19 — Политика ошибок: ветка on_error / error workflow

Сводка по референсам — **§16**; оси выбора модели для GC (останов vs ветка vs второй граф) — **§37**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | частично | Прерывание prompt / `execution_error`; нет отдельной «error ветки» на графе. |
| Dify | да | **`ErrorHandler`** (`api/graphon/graph_engine/error_handler.py`): retry → стратегии **`FAIL_BRANCH`**, **`DEFAULT_VALUE`**, abort; события **`NodeRunFailedEvent`** / **`NodeRunRetryEvent`**. |
| Flowise | частично | Try/catch вокруг **`executeFlow`** / агента; отдельного глобального error-workflow как у n8n нет. |
| Langflow | частично | Исключения в LFX / API; нет единой ноды «Error Trigger» уровня n8n. |
| n8n | да | **`settings.errorWorkflow`** + **`executeErrorWorkflow`** (`packages/cli/src/execution-lifecycle/execute-error-workflow.ts`); либо workflow с **`ErrorTrigger`** (`packages/nodes-base/nodes/ErrorTrigger`); ретраи на ноде. |
| Vibe Workflow | частично | Ошибки запроса / FastAPI; без отдельного error-graph продукта. |
| **GraphCaster** | **частично** | **`error`** + **`process_*`** в NDJSON (**§3.7**); in-graph исход **`out_error`** (после сбоя **`task`** / **`graph_ref`**, не при отмене) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F19**). Отдельный **error-workflow** / **ErrorTrigger** как у **n8n** — нет (**§16.2**). |

### F20 — Undo/redo и история команд редактора

Углубление — **§21**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | частично | Зависит от сборки UI; стек правок не всегда полный или отделён от версий файла workflow. |
| Dify | да | SPA workflow editor: **command stack** / состояние черновика в `web/`, сохранение в API отдельно от каждого шага undo. |
| Flowise | частично | React Flow + серверное состояние; глубина undo **не** как у IDE, частично на стороне UI. |
| Langflow | да | Редактор flow: история действий на canvas (продуктовый фронт). |
| n8n | да | **`packages/frontend/editor-ui`**: локальная история правок на клиенте; **версии workflow** и актив в БД — ортогонально undo-сессии. При co-edit — **`YjsUndoManager`** (**§19**). |
| Vibe Workflow | частично | React state; без выделенного стека команд уровня n8n. |
| **GraphCaster** | **частично** | MVP: стек **снимков** `GraphDocumentJson` (не полноценный command stack как у **Dify**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); **§21** — viewport / внешний конфликт файла / **Yjs** при **F22** открыты. |

### F21 — Локализация интерфейса (i18n)

Углубление — **§26**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | частично | В основном EN; комьюнити переводы. |
| Dify | да | Много локалей: продуктовый фронт в **`web/`** (**`i18next`**, каталоги **`web/i18n/*`**), часть документации в **`docs/*`**. |
| Flowise | да | Выделенный слой **`i18n/`** в UI-части монорепо; строки подключаются в React-клиенте. |
| Langflow | да | Многоязыковой веб-клиент редактора: централизованные файлы/ключи переводов (типовой паттерн SPA + каталоги локалей). |
| n8n | да | Пакет **`packages/frontend/@n8n/i18n`**: ключи для **editor-ui**, отдельные NLP-пакеты/локали; переводы подключаются в билде клиента. |
| Vibe Workflow | частично | Next.js — строки в компонентах / по мере подключения библиотеки i18n. |
| **GraphCaster** | **да (частично)** | Слой **B**: **`i18next`** + **`react-i18next`**, **`ui/src/locales/en.json`**, **`ru.json`**, стартовая локаль от **`navigator.language`** (**`ui/src/i18n.ts`**); дорожная карта — **§26.2**. |

### F22 — Совместное редактирование / синхронизация (CRDT)

Углубление — **§19**.

| Продукт | Статус | Как устроено |
|---------|--------|--------------|
| ComfyUI | нет | Один клиент на сессию; нет shared session над одним workflow. |
| Dify | частично | Несколько пользователей в workspace / приложении; граф в БД, конкуренция правок решается на уровне продукта (блокировки, версии черновика), **не** обязательно CRDT на полотне. |
| Flowise | нет | Типично один активный редактор chatflow на деплой; нет публичного CRDT-слоя. |
| Langflow | частично | Шаринг flow через бэкенд (проекты); одновременное редактирование одного файла — ограничено продуктом. |
| n8n | частично | Пакет **`@n8n/crdt`**: абстракция CRDT на **Yjs** (`CRDTProvider`, **WebSocket** transport, **awareness**, **undo** в `packages/@n8n/crdt/src/`). |
| Vibe Workflow | нет | Один пользовательский граф в сессии. |
| **GraphCaster** | **нет** | **C:** локальный JSON (**§10**, **F23**); **F22** сознательно **вне** репозитория — хост (**хост**) или **§19.2**. |

### F23 — «Проектный» file-first workspace (графы как JSON на диске)

| Продукт | Статус | Как устроено (уровень B) |
|---------|--------|---------------------------|
| ComfyUI | да | Пользовательские каталоги, сохранение workflow JSON / встраивание в PNG; не корпоративная БД. |
| Dify | нет | Модель **`Workflow`** в БД (`api/models/workflow.py`); граф — часть приложения/тенанта. |
| Flowise | нет | Сущность **`ChatFlow`**: поле **`flowData`** (текст с React Flow JSON) в SQL через TypeORM (`database/entities/ChatFlow.ts`). |
| Langflow | частично | Основной продукт — БД + UI; экспорт flow JSON, **`lfx`** может грузить файл — ближе к GC по сценарию «файл на диске». |
| n8n | нет | **`WorkflowEntity`** / репозитории в `@n8n/db`, JSON графа в хранилище инстанса. |
| Vibe Workflow | частично | Клиент держит граф; без полноценной модели «папка проекта» как у GC. |
| **GraphCaster** | **да (целевая модель)** | Слой **C**: каталог **`graphs/`**, автоскан, **`graphId` → путь**, артефакты **`runs/`** — см. `workspace.py`, `DEVELOPMENT_PLAN.md`, **§10**. |

---

## 5. Сводная матрица (кратко)

Строки — фичи F1–F23; обозначения: ● полноценно, ◐ частично/специфично, ○ нет/n/a.

| Фича | ComfyUI | Dify | Flowise | Langflow | n8n | Vibe | GC |
|------|---------|------|---------|----------|-----|------|-----|
| F1 Редактор | ● | ● | ● | ● | ● | ● | ◐ |
| F2 Схема данных | ● | ● | ● | ● | ● | ◐ | ◐ |
| F3 Обход графа | ● | ● | ● | ● | ● | ● | ◐ |
| F4 Ветвление | ◐ | ● | ● | ● | ● | ◐ | ◐ |
| F5 Вложенные графы | ◐ | ● | ● | ◐ | ● | ◐ | ◐ |
| F6 Очередь/async | ● | ● | ● | ● | ● | ◐ | ◐ |
| F7 Внешний процесс | n/a | ◐ | ◐ | ◐ | ● | ○ | ◐ |
| F8 Credentials | ◐ | ● | ● | ● | ● | ◐ | ◐ |
| F9 Триггеры | ○ | ● | ◐ | ◐ | ● | ○ | ○ |
| F10 RAG | ○ | ● | ● | ● | ◐ | ○ | ○ |
| F11 Агенты | n/a | ● | ● | ● | ● | ○ | ◐ |
| F12 API | ● | ● | ● | ● | ● | ◐ | ◐ |
| F13 Observability | ◐ | ● | ◐ | ● | ● | ○ | ◐ |
| F14 RBAC/SSO | ◐ | ● | ◐ | ◐ | ● | ○ | ○ |
| F15 Расширение нод | ● | ● | ● | ● | ● | ◐ | ◐ |
| F16 Desktop | ● | ○ | ○ | ● | ○ | ○ | ◐ |
| F17 Кэш графа | ● | ◐ | ◐ | ◐ | ◐ | ○ | ◐ |
| F18 Типы пинов | ● | ● | ● | ● | ● | ◐ | ◐ |
| F19 Ошибки / on_error | ◐ | ● | ◐ | ◐ | ● | ◐ | ◐ |
| F20 Undo/redo | ◐ | ● | ◐ | ● | ● | ◐ | ◐ |
| F21 i18n | ◐ | ● | ● | ● | ● | ◐ | ◐ |
| F22 CRDT / co-edit | ○ | ◐ | ○ | ◐ | ◐ | ○ | ○ |
| F23 File-first `graphs/` | ● | ○ | ○ | ◐ | ○ | ◐ | ● |

---

## 6. План использования при разработке GraphCaster

1. **Ближайшие приоритеты из вашего плана** (workspace, условия, мост раннера, UX) сопоставлять с **F2–F5, F7, F9, F11, F13, F15, F17, F18, F20, F23**, ориентиры: **n8n** (выражения/ветки — идеи, не копировать формат), **Dify** (GraphEngine + variable pool — архитектура «граф как программа»; типизация — **§15**), **Langflow** (headless `lfx` — идея чистого исполнителя; `validate_handles` — **§15**). **Интеграция с git/CLI** у конкурентов слабее, чем у целевой модели GC (**§10**).
2. **Не брать в MVP** без явного решения: **полный** **F6** на стороне хоста (очередь **многих** прогонов, Redis/n8n queue mode, **межпрогоновый** worker pool) — **§13**; **внутри** одного прогона — sink + **StepQueue** + **`merge`** **`barrier`** + опциональный bounded параллель веток после **`fork`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**Merge (`join`)**; по умолчанию последовательно). **F10** (ingestion + vector DB + раннер) — **§14**; **F14** (tenant, RBAC, SSO) — **§20** / **§38**, не дублировать Dify/n8n в `graph-caster`. **F8** — **file-first** v1 (**`envKeys`**, workspace-файл) в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); полный vault / сравнение с n8n-Dify — **§11** / **§35**. **F9**/**F12** — **§12**; триггеры — **§24**; публичный REST, ключи, OpenAPI — **§25**. **F22** (реалтайм co-edit, Yjs) — **§19**; не смешивать с **фазой 5** run-lock (локальная блокировка UX).
3. **ComfyUI и Vibe Workflow** использовать как референс **только** для **F1** / **F17**-подобного UX тяжёлых пайплайнов; **для F16** сравнивать упаковку с **Comfy**/ **Langflow Desktop**, целевую модель GC — **§33**; домен diffusion не смешивать с CLI/автоматизацией GC.
4. **При добавлении фичи** дополнять этот файл одной строкой в таблицу F* и столбец «как у конкуренте X», чтобы не размазывать знания по чатам.

5. **Фаза 8 (мост):** у **Dify** в монолите буфер между GraphEngine и HTTP — **in-process** **`queue.Queue`** (**§3.6.1**), чтение в **`StreamResponse`** и **`break`** по финальным **`Queue*`** — **§3.6.2**; у **Flowise** в queue mode — **Redis** (**§3.3.1**). **У GC** стабильный **`runId`**, маршрутизация в UI, несколько сессий (очередь/cap/фокус) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (раздел «Стабильный `runId`…» и смежные); **`schemas/run-event.schema.json`**; **§3.7.1** здесь — только указатель, без дубля фактов. Внутренний маппинг «раннер → консоль» можно держать плоским, отдельный слой Queue* (**§3.6**) — только если появятся разные потребители одного прогона. Актуальный перечень `type` и пробелы — **§3.7**. Разделение **очереди исполнения** и **буфера к транспорту** (эталон Comfy — **§13.3**); при вынесении воркера — мост событий (эталон Flowise **Redis** — **§3.3.1**); явная политика при медленном клиенте — **§39.2** (dev **SSE**/**WebSocket** — факты в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) **«Backpressure SSE»**).
6. **Расширение логов `task` / CLI (**F7**):** базовый сценарий Cursor Agent CLI (**`gcCursorAgent`**, события **`process_*`**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); дальнейшее сравнение потокового вывода с **Comfy `progress`** и **Langflow** SSE — **§27**; не смешивать с **`node_execute`** (снимок полей `data`, не непрерывный stdout в одном событии).
7. **Политика ошибок (**F19**):** не смешивать **ретраи `task`** (**§16**) с **графовой** веткой «on_error»; второе — **§37** + **`PRODUCT_DESIGNE.md`** и схема документа.
8. **Наблюдаемость (**F13**):** **поток для UI** в десктопе (консоль, фильтры, поиск) — факты в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); обзор конкурентов и «тяжёлая» часть (**трейсинг**, индекс прогонов) — **§17**; **файлы артефактов** (**E**); транспорт (**NDJSON** vs **WS/SSE**) — **§39** / **§39.2**; не дублировать Dify **`TraceQueueManager`** без продукта-получателя.
9. **Новый тип ноды (**F15**):** менять одновременно **A+B+D** — см. **§18**; не добавлять `kind` только в UI без **`validate.py`** и ветки в **`runner.py`**.
10. **Совместное редактирование (**F22**):** не внедрять CRDT внутрь graph-caster без решения **хост**; см. **§19** (граница ответственности **C** vs хост).
11. **Доступ и tenant (**F14**):** не хранить роли в `graph-document`; claims / ACL — **§20**; разделение repo/слоя хоста — **§38**; хост перед вызовом **`graph_caster`**.
12. **Undo/redo (**F20**):** история правок в UI — **§21** и [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (сейчас **снимки**, не БД-версии); не путать с **YjsUndoManager** при **F22** (**§19**).
13. **Кэш / инкремент (**F17**):** не смешивать кэш **индекса workspace** (`clear_graph_index_cache` в **`workspace.py`**) с кэшем **выходов нод** — **§22** / **§36**; факт headless-кэша **`task`**, **`mcp_tool`** и **`ai_route`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); для **`envKeys`** ключ учитывает отпечаток **`workspace.secrets.env`** — там же (**F8** × **F17**); Comfy-модель требует стабильных сигнатур входов; при **F23** смена JSON на диске должна менять **ревизию**, иначе кэш даст ложные попадания.
14. **Агенты и tools (**F11**):** цикл model → tool → model живёт **внутри** референсных продуктов (**§23**); в GC без явного решения не тащить ReAct в **`runner.py`** — обёртка **`task`/HTTP**, креды (**§11**), трассы вызовов (**§17**).
15. **Триггеры (**F9**):** не путать **HTTP-вход** с **нодой Start** в документе; payload → маппинг в стартовый контекст — на стороне хоста (**§24**); очередь и конкуренция — **§13**.
16. **Публичный API (**F12**):** отделять **внутренний мост** (фаза 8) от **внешнего** контракта; не отдавать целиком `graph-document` без ACL — **§25**; BFF без утечки секретов в браузер — **§25.3**; аутентификация и квоты — **хост** (**§20**).
17. **Локализация (**F21**):** новые подписи UI, модалки, пункты меню — через **`t(...)`** и **`ui/src/locales/*.json`**; предупреждения канваса (**`structureWarnings`**, **`branchWarnings`**) — ключи + интерполяция или общий namespace **`warnings.*`** — **§26**; сообщения раннера в NDJSON (**`error`**, **`process_failed`**) не смешивать с продуктовыми переводами без **кода/стабильного id** (**§3.7**, **§16**).
18. **Внешний процесс / CLI (**F7**):** не класть **секреты** в **`command`** / **`argv`** (**§11**); для SaaS (**хост**) заранее продумать **allowlist** бинарей или политику **cwd**; таймауты и **лимит stdout** согласовать с консолью (**§17**) и артефактами (**E**) — **§27**; **`shlex`** уже различает Windows/POSIX в **`process_exec.py`**.
19. **Канвас и UX редактора (**F1**):** не вводить второй движок графа поверх **React Flow** без ТЗ; внешний вид и handles новых **`kind`** — согласовать с **§15** / **§18**; мини-карта, сетка, хоткеи, группы — **§28**; при **F22** не дублировать состояние полотна в CRDT вне **§19**.
20. **Вложенные графы (**F5**):** **`graph_ref`** только на существующий **`graphId`** (**C**, **§10**); **циклы по workspace** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F5**); **глубина вложенности** — раннер (**§29**); **`runId`** корневого прогона не «терять» во вложенных событиях (**§3.7**, **§17**); в хост — ACL «какой граф можно вызывать» (**§20**, **§38**).
21. **Схема документа и версии (**F2**):** любое изменение **`graph-document`** — **§30**: обновить **JSON Schema**, **`models.py`**, **`validate.py`**, при необходимости **Vitest** на `parseDocument`/`toReactFlow`; политика **`schemaVersion`** (когда инкрементировать) — один источник истины с раннером; не смешивать с версией **`run-event`** (**отдельная схема**, **§8**).
22. **Порядок исполнения (**F3**):** изменения в **`runner.py`**, которые влияют на **достижимость**, **порядок обхода** без смены **закона выбора ветки**, — **§31**; не путать с **очередью прогонов** (**§13**, **F6**) и с **кэшем выходов** (**§22**, **F17**).
23. **Ветвление (**F4**):** актуальное состояние GC — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F4**) + **§32**; при смене семантики — **`graph-document.schema.json`**, **`models.py`**, **`branchWarnings`**, при необходимости **`run-event`** (**§3.7**); не путать с **DAG merge**/fork (**§31.2**) и с **`FAIL_BRANCH`** (**§16**, **F19**).
24. **Десктоп (**F16**):** смена **Tauri**-конфига (**`tauri.conf.json`**), **capabilities**, **CSP**, установщика, обновлений, интеграции с **FS**/**диалогом выбора workspace** — **§33**; не смешивать с **F23** (модель папки проекта) и **фазой 8** (мост к раннеру) без явного ТЗ; **Python** в бандле vs системный — **§33.2**.
25. **MCP / внешние tool-протоколы (**F11** × **F12**):** MCP-сервер **(A)** stdio — факты в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); нода-**клиент** **(B)**, публичный/streamable MCP, смена схемы **tools** в событиях — **§34**; не смешивать с обычным **REST** (**§25**) и внутренним мостом NDJSON (**фаза 8**) без версии контракта; креды и ссылки на них в JSON — **§11** / **§35** / **§20**; публичная регистрация MCP и tenant-scoped провайдеры — **§38**.

---

## 7. Фазы GraphCaster (`DEVELOPMENT_PLAN.md`) × фичи и референсы

Использовать как **план сравнения**: перед началом фазы открыть строки F* и §3.1 у 1–2 продуктов.

| Фаза GC (кратко) | Слои GC | Ключевые F* | Референсы для архитектурных идей |
|------------------|---------|-------------|----------------------------------|
| 0–2 раннер, workspace, артефакты, `task`, `graph_ref` | A, C, D, E | F2–F5, F7, F13, **F23**; **F19** (ретраи `task` — **§16** / **§37**); опционально позже **F17** — **§22** | **§31** (**F3**): **Comfy** DAG/`comfy_execution`, **n8n** связность + merge, **Dify** GraphEngine; **§30** (**F2**); персистентность — **§10**; **`graph_ref`** — **§29**; **`task`** — **§27**; **`lfx`**/**GraphEngine** — концепция, не копировать целиком; **`process_*`** — **§16.1** |
| 3–4 UI canvas, инспектор, предупреждения | A, B | F1, **F2**, F4, F15, F18, F21, **F16** | **§28** (**F1**): **Flowise**/**Langflow** (React Flow), **n8n** (**Vue**-canvas, sticky notes); **Dify** консоль; **`Interface.ts`**, **`node_factory`** — **§18**; пины — **§15**; **`validate.py`** + **§30** при смене схемы; строки — **§26**; **§33** (**F16**): **Tauri** vs браузер, путь к **`graphs/`** |
| 5 undo/redo, run-lock | B | F20, F6 (локально) | **§21**; **n8n** editor-ui + отличие от версий в БД; **Dify** SPA-черновик; **§19** — только если co-edit (**F22**). Прогоны — **§13** |
| 6 условия, ИИ-ветвление | B, D, F | F4, F11; **F19** in-graph — факты в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**§16** / **§37** для расширений); **ИИ-ветвление** (**`ai_route`**, wire v1) — там же, подраздел **«ИИ-ветвление / нода `ai_route`»** | **§32** (**F4**): семантика **`edge.condition`** и контекст; **§31** (**F3**) — только порядок списка рёбер; **Dify** **`SkipPropagator`** / условные ноды, **`FAIL_BRANCH`** (**§16**), **Flowise** condition nodes, **n8n** IF/Switch; полный **F11** — **§23** |
| 7 консоль (фильтры, экспорт) | G | F13 | **Сделано (UI):** [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F13**, фаза 7). Эталоны и незакрытый объём: **§17**; **Dify** **`ObservabilityLayer`** + persistence/trace; **n8n** **`Execution`** в БД; **Langflow** **`TracingService`** |
| 8 мост UI ↔ Python (NDJSON/WebSocket) | B, D, G | F12, F13 | Внутренний мост ≠ **§25** / **§34** (MCP — другой контур); обзор **§12**; ось транспорта **§39** / **§39.2**; два уровня очередей (исполнение vs сокет) — **§13.3**; стабильный **`runId`** — **§17.2**, **§3.7** / **§3.7.1** (указатель), факты — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md). Референсы: **ComfyUI** §3.5 / **§3.5.1** / §13.3, **n8n** §3.2.1 (Push + relay) / **§3.2.2** / **§3.2.3** / **§3.2.4** / **§3.2.5** (redaction + сервис + стратегии + инвентаризация полей), **Flowise** §3.3.1 / **§3.3.3**, **Langflow** §3.4 / §3.4.1 / **§3.4.2**, **Dify** §3.6 → Queue* → HTTP **§3.6.1** / **§3.6.2** / **§3.6.3**, **Vibe** **§3.8** / **§3.8.1** (BFF → poll) |
| 9 Cursor CLI MVP | D, F | F7, **F8** | **Сделано:** [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) — **«Пресет Cursor Agent CLI»** и **«Workspace-секреты и `envKeys`»** (**F8** v1). Эталоны и риски (**n8n** **Execute Command**, полный vault **§11** / **§35**) — **§27** / **§11**; контракт **`gcCursorAgent`** — в **IMPLEMENTED_FEATURES**. |
| 10 встраивание в хост | B–E | F14, **F22**, **F8**, **F9**, **F12**, **F6**, **F10**?, **F17**?, **F11**? | **§20** (**F14**): tenant, роли, SSO — паттерны **Dify** `TenantAccountRole`, **Flowise** `enterprise/rbac` + `sso`, **n8n** `OwnershipService` / **Project**. **§19** (**F22**). **§23** (**F11**). **MCP (A)** stdio — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); **§34** (**MCP (B)** / публичный MCP) vs **§25** HTTP. **§24** (**F9**). **§25** (**F12**): версии API, ключи, CORS, OpenAPI; **§25.3** (BFF). Кэш — **§22** / **§36**. Креды — **§11** / **§35**; старт — **§12**; scaling — **§13**; RAG — **§14** |

**Fork/join** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (подраздел Merge в **F4**). **ИИ-ветвление** (**`ai_route`**) — там же («ИИ-ветвление / нода **`ai_route`**»). Эталоны merge/split — **n8n**, условный обход — **Dify**; отдельно от ретраев **`task`** в **`process_exec.py`**. **Расширения политики ошибок** (**F19**, **§16**, **§37**): in-graph **`out_error`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); новые стратегии — согласовать в схеме и **`run-event`** (**§3.7**).

---

## 8. Обновление документа

При апдейте субмодулей конкурентов достаточно перепроверить README и перечисленные entry points; при крупных релизах (особенно Dify Graphon, n8n workflow JSON, ComfyUI **`nodes.py`** / политика **`custom_nodes`**, Langflow LFX + **`api/v1/endpoints`** + **`api/v2/workflows`**) — пройтись по изменениям в указанных пакетах за один проход. При завершении фазы GC обновлять столбец **GC** в §5 и строки **§7**. При добавлении или изменении `emit(...)` в раннере — обновить **`run-event.schema.json`**, **§3.7** и тест **`test_run_event_schema.py`**. При введении ссылок на креды в документе графа — обновить **`graph-document.schema.json`**, **§11**, **§35** и строку **F8** в §4. При добавлении HTTP/webhook обёртки над раннером — **§12** и строки **F9** / **F12** в §4. При появлении очереди/воркеров/лимитов параллелизма или **отдельного буфера** исполнитель↔транспорт — **§13** / **§13.3** и строку **F6** в §4. При проектировании RAG, datasetов, vector store в графе — **§14** и строку **F10** в §4. При добавлении типов портов, правил соединения или расширении предупреждений редактора — **§15** и строку **F18** в §4 (синхронно **`graph-document.schema.json`** и при необходимости **`validate.py`**). При введении **`on_error`**, error-ветки или смене семантики **`process_failed` / `error`** — **§16**, **§37** и строку **F19** в §4. При изменении **UX консоли run** (фильтры, поиск, экспорт, эвристики в **`consoleLineMeta`**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md), `ui/src/components/ConsolePanel.tsx`, `ui/src/run/consoleLineMeta.ts`, Vitest; **§17** не дублировать описанием реализации. При добавлении **OpenTelemetry / внешнего трейсера**, нового **типа события только для observability** или **долговременного индекса прогонов** (аналог **`Execution`** Flowise/n8n) — **§17** и строку **F13** в §4. При добавлении **нового `kind` ноды**, **плагинного диспетчера** или **маркетплейса шаблонов нод** — **§18** и строку **F15** в §4. При появлении **реалтайм collaborative editing**, **документной синхронизации** (CRDT/OT) или **слоёв awareness** над графом — **§19** и строку **F22** в §4. При проектировании **ролей**, **SSO**, **мульти-тенанта** или **ACL на уровне графа/воркспейса** — **§20**, **§38** и строку **F14** в §4. При добавлении HTTP/моста, который принимает **непроверенный хостом** произвольный **`graphId`** / claims **tenant** в тело запроса к **`graph_caster`** — сверка с **§38** (не тащить ORM tenant в Python GC). При добавлении **стека undo/redo**, **команд редактора** или смене правил **слияния истории с автосохранением** — **§21** и строку **F20** в §4. При введении **кэша выходов нод**, **частичного прогона** (dirty set) или **склейки с прошлым `runData`** — **§22** и строку **F17** в §4. При добавлении **ноды агента**, **tool-calling**, **цикла рассуждение→вызов инструмента** или **потоковых логов шагов агента** — **§23** и строку **F11** в §4. При введении **webhook**, **расписания**, **событийного старта** или **политики повторов доставки** для внешнего вызова раннера — **§24** и строку **F9** в §4 (плюс **§12** для сквозного F9+F12). При публикации **внешнего HTTP-контракта** (run по `graphId`, streaming статуса, API keys, версионирование путей (`/v1/...`), OpenAPI, CORS для браузера) — **§25**; при выделении **BFF** без прямого доступа браузера к раннеру — **§25.3** / **§3.8** / **§3.8.1** (REST run + poll vs NDJSON); и строку **F12** в §4. При добавлении **новой локали**, **смене формата ключей** `translation` или **появлении пользовательских строк** в предупреждениях/консоли без ключей — **§26** и строку **F21** в §4. При изменении **политики внешнего процесса** в **`process_exec.py`** (таймаут, лимит stdout, **`cwd`**, слияние **`env`**, **`successMode`**, ретраи) или контракта событий **`process_*`** — **§27** и строку **F7** в §4. При смене **стека канваса**, **паттернов выбора и мультивыбора**, **комментариев/группировок** на полотне, **визуальной модели рёбер** (маршрутизация, подписи) или **производительности** на больших графах — **§28** и строку **F1** в §4. При смене **семантики `graph_ref`** (поля ноды, лимит глубины, циклы, вложенные артефакты, префикс в событиях) — **§29** и строку **F5** в §4. При смене **`schemaVersion`**, **обязательных полей** `graph-document`, **правил `validate.py`** или **стратегии чтения старых файлов** из **`graphs/`** — **§30** и строку **F2** в §4. При изменении **алгоритма обхода** (от **`start`** к **`exit`**), **достижимости нод** или **обработки вложенного `graph_ref`** в потоке исполнения — **§31** и строку **F3** в §4. При смене **`_evaluate_next_edge`**, **`eval_edge_condition`**, контекста ветвления (**`last_result`** и др.), полей **`condition`** в **A**, событий **`branch_*`**, **`edge_traverse`** или правил **`branchWarnings`** — **§32** и строку **F4** в §4. При добавлении **Tauri commands**, **изменении политики WebView/CSP**, **бандлинга установщика** (NSIS/WiX/macOS), **автообновления** или **нативного выбора каталога workspace** — **§33** и строку **F16** в §4. При введении **отдельного WebSocket или SSE** только как оболочки над тем же **`run-event`**, без второго «истинного» протокола — **§39** (**§39.2** — буфер; **§13.3** — эталон разделения очередей; **§3.2.1** — n8n Push + relay; **§3.2.2**–**§3.2.5** — n8n redaction перед полным телом, **`ExecutionRedactionService`**, стратегии item/полей, инвентаризация **`sensitiveOutputFields`**; **§3.3.1** — Redis между воркером и SSE; **§3.6.1** — Dify **`data:`/`event:`** поверх **`Queue*`**); при обязательном **`runId`** в потоке — **§3.7.1** и строку **F13** в §4. При введении **MCP-сервера** над прогоном графа, **ноды-вызова MCP-tool**, **транспорта stdio/SSE** для tools или **маппинга `graphId` → список tools** — **§34** и строки **F11** / **F12** в §4. При смене **дисциплины ссылок на секреты** в **`GraphDocument`** (имена env, opaque handles, запрет inline значений в коммит) — **§35** и строку **F8** в §4. При введении **персистентного кэша выходов нод** или **политики инвалидации** по смене файла/ревизии графа — **§22**, **§36** и **F17** в §4. При проектировании **отдельного `graphId` под error-run** (аналог **errorWorkflow** n8n) — **§16**, **§20**, **§38**, **§37**.

---

## 9. Чеклист перед началом фазы GraphCaster

Выполнить по порядку (можно копировать в задачу / PR):

1. **Фаза** — номер и название из `DEVELOPMENT_PLAN.md`; критерий готовности из того же файла.
2. **Слои** — какие из §2 затрагиваются (A–G).
3. **Фичи** — строки **F*** из §4, релевантные фазе; сверка с **§5** (матрица).
4. **Референсы** — 1–2 продукта из **§7** для этой фазы; просмотр **§3.1**; раннер/мост — **§3.2**–**§3.7** (**§3.7.1** — указатель на факты в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md)); Vibe BFF **run/status** без NDJSON — **§3.8** / **§3.8.1**; n8n Push — **§3.2.1** / redaction + fail-closed — **§3.2.2** / сервис — **§3.2.3** / стратегии — **§3.2.4** / инвентаризация **`sensitiveOutputFields`** в **`nodes-base`** — **§3.2.5**; Dify **`Queue*`** → **`StreamResponse`** → **`WorkflowAppGenerateResponseConverter`** → SSE — **§3.6.1** / **§3.6.2** / **§3.6.3**; Flowise **`IServerSideEventStreamer`** / SSE / Redis (**§3.3.1**–**§3.3.3**); LFX — **§3.4.1** (**`serve_app`**) / **§3.4.2** (**`endpoints.py`**, плотный run-stream + webhook SSE) / **§3.4.3** (**`/api/v2/workflows`**, **`stream`** → **501**); стрим статуса (WS/SSE/NDJSON) и backpressure моста — **§39** / **§39.2**; очередь исполнения vs транспорт (Comfy — **§13.3**, binary WS — **§3.5** / **§3.5.1**; Flowise queue — **§3.3.1**; Dify in-process — **§3.6.1** / **§3.6.2**; n8n relay — **§3.2.1**); workspace — **§10** / **F23**; креды — **§11** / **§35** / **F8**; старт / триггеры / публичный API — **§12**, **§24** / **F9**; внешний REST/OpenAPI/embed — **§25** / **§25.3** / **F12**; **MCP** — **§34**; scaling — **§13** / **F6**; RAG — **§14** / **F10**; пины и рёбра — **§15** / **F18**; политика ошибок — **§16** / **§37** / **F19**; логи / трейсы / история run — **§17** / **F13**; расширение типов нод — **§18** / **F15**; совместное редактирование — **§19** / **F22**; RBAC / SSO / tenant — **§20** / **§38** / **F14**; undo/redo редактора — **§21** / **F20**; кэш шагов / partial run — **§22** / **§36** / **F17**; агенты / tools / tool loop — **§23** / **F11**; локализация UI — **§26** / **F21**; внешний процесс / CLI (`task`) — **§27** / **F7**; канвас / визуальный редактор — **§28** / **F1**; вложенные графы / `graph_ref` — **§29** / **F5**; схема `GraphDocument` / миграции — **§30** / **F2**; обход графа / порядок исполнения — **§31** / **F3**; условные рёбра / ветвление — **§32** / **F4**; десктоп / **Tauri** — **§33** / **F16**.
5. **Контракт GC** — изменения в `schemas/`, формат событий раннера, при необходимости запись в `PRODUCT_DESIGNE.md`.
6. **Тесты** — `pytest` / Vitest / build по правилам репозитория.
7. **Документ** — после merge обновить **§5** (статус GC) и при сдвиге приоритетов — строку в **§7**.

**Дальнейшие точечные углубления:** Comfy — инвентаризация **`send_sync`/JSON `type`** по **конкретной** установке (diff форка vs upstream; методика — **§3.5.1**); **Flowise** — выравнивание **`RedisEventPublisher.streamMetadataEvent`** с **`SSEStreamer`** (или осознанная политика урезания) — поверх **§3.3.3**; Dify — OpenAPI / сопоставление маршрутов с веткой **`InvokeFrom`** (**§3.6.3**); n8n — при смене версии субмодуля повторить **`sensitiveOutputFields`** по **`packages/nodes-base`** и при необходимости по закрытым пакетам билда (**§3.2.5** — снимок open tree); Vibe — тела ответов **run/status** MuAPI (вне open repo); каталог прокси **BFF → MuAPI** — **§3.8.1**; **`runId`** в потоке GC — **`schemas/run-event.schema.json`** + [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); **§3.7.1** — указатель; публичная схема **Queue*** в OpenAPI Dify — только если интегрироваться с Dify, а не с собственным раннером GC.

---

## 10. Персистентность: где лежит граф (планирование GC vs серверные продукты)

| Продукт | Где хранится описание графа | Entry points (B) |
|---------|----------------------------|------------------|
| **ComfyUI** | Файлы у пользователя, API `/prompt` | `user` workflows directory; загрузка JSON |
| **Dify** | PostgreSQL | `api/models/workflow.py` — модель **`Workflow`**, граф в полях контента приложения |
| **Flowise** | PostgreSQL / SQLite (типовой деплой) | `packages/server/src/database/entities/ChatFlow.ts` — **`flowData`**: строка с JSON полотна |
| **Langflow** | БД инстанса + экспорт | REST/API бэкенда, файлы для `lfx run`/`serve` |
| **n8n** | БД | `WorkflowEntity`, загрузка в **`Workflow`** из `n8n-workflow` при исполнении |
| **Vibe Workflow** | Преимущественно клиент / сессия | Next.js state → FastAPI для вызовов |
| **GraphCaster** | **`graphs/*.json`** + уникальный **`graphId`** | `python/graph_caster/workspace.py`; артефакты отдельно под **`runs/`** |

**Вывод для GC:** текущие конкуренты (кроме Comfy и частично Langflow export) заточены под **один сервер — много пользователей/проектов** и **БД**. Модель GC (**§F23**) ближе к **репозиторию кода + локальный CLI**: проще дифф в git, проще передать путь в Cursor, сложнее без доработки получить «одна кнопка SaaS». При встраивании в **хост** не подменять file-first без решения продукта: можно пополнять индекс из облака, но канонический источник по плану — папка **`graphs/`**. Если два редактора пишут один и тот же файл — политика слияния и real-time — **§19** (**F22**), не дублировать в **`workspace.py`** без явного ТЗ.

**Риски копирования чужой архитектуры:** подключать ORM «как Flowise» под сами графы — ломает **F23** и дублирует `graph-document.schema.json`; если понадобится база, разумнее хранить **метаданные/ACL**, а тело графа оставить файлом или blob по `graphId`.

---

## 11. Креды, секреты и связь с графом (слой F, **F8**)

Сравнение **идентификаторов и имён в сохранённом JSON** (экспорт, git) против **значений в vault** — **§35**.

Общий паттерн у «серверных» конкурентов: **тело workflow в БД или JSON** хранит только **идентификаторы** или **имена** привязок к credential; **секретные поля** лежат в отдельной таблице/хранилище, шифруются, подмешиваются при исполнении. У GC с **file-first** графами (**F23**) прямое копирование таблицы `Credential` не обязательно: важнее **инвариант** — не коммитить секреты в `graphs/*.json`. Кто может читать vault целого tenant — **§20** (**F14**), не **F8** в узком смысле.

| Продукт | Хранилище секретов (уровень B) | Как привязано к графу | Подмешивание при run |
|---------|-------------------------------|------------------------|----------------------|
| **n8n** | **`CredentialsEntity`** в `@n8n/db` (`data` — зашифрованная строка, `type` — тип креда); сервисы в `packages/cli/src/credentials/` | В JSON workflow на нодах — ссылки на креды (id/имя); выражения **`{{$credentials.*}}`** | `CredentialsHelper` / pre-execution checks |
| **Dify** | Модели **`ProviderCredential`**, **`ProviderModelCredential`** в `api/models/provider.py` (`encrypted_config`); **`BuiltinToolProvider`** / **`ApiToolProvider`** — `encrypted_credentials` в `api/models/tools.py` | **`credential_id`** на провайдерах моделей и нодах приложения | Variable pool / GraphEngine при обходе |
| **Flowise** | Сущность **`Credential`** (`encryptedData`, `credentialName`, `workspaceId`) в `packages/server/src/database/entities/Credential.ts` | Компоненты цепочки ссылаются на сохранённый credential по имени типа + id/name | Расшифровка на сервере при `execute` |
| **Langflow** | **Global variables** в БД; тип **`credential`**; сервис `langflow/services/variable/service.py`; опционально заголовки — `extract_global_variables_from_headers` в API | Flow JSON + переменные окружения / БД инстанса | Резолв при сборке графа и MCP (`provider_service` и др.) |
| **ComfyUI** | Нет единого vault | Ключи и пути часто в extra_pnginfo / настройках нод / env | Локально процессом |
| **Vibe Workflow** | В основном **`.env`** сервера | Не отделено от деплоя | FastAPI config |
| **GraphCaster** | **`task.data.env`** (локально, вне git по политике) + опциональный **`.graphcaster/workspace.secrets.env`** (gitignore); в JSON — **`envKeys`** (имена), см. [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) | **`envKeys`** без значений в committed графе; значения из файла workspace и/или OS env | Раннер подмешивает env до **`Popen`**; маскирование пересечения **`envKeys`** ∩ **`data.env`** в **`node_execute`** и снимках **`node_outputs`** — там же; **хост**/центральный vault — **§11** п.2 |

**Рекомендации для планирования GC (без раздувания MVP):**

1. **Фаза 9 (CLI) — реализовано в GC:** соглашение «секреты из OS env / `.env` не в репозитории», пресет **`gcCursorAgent`** без ключей в **`GraphDocument`** — факты в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); **имена** env в **`task.data.envKeys`** + файл **`workspace.secrets.env`** (v1 **F8**) — там же (**«Workspace-секреты…»**). Центральный резолв **хост** — по мере ТЗ (**§11** п.2).
2. **Фаза 10 (хост):** если появится центральный vault — резолв **на границе** (HTTP header / one-shot env dict в вызов раннера), аналог подмешивания Dify/n8n, без обязательной таблицы внутри репо GC.
3. **Согласование с §10:** отдельная ORM-таблица кредов внутри graph-caster **не** нужна для канонических графов на диске; при гибриде (облачный индекс) хранить в БД максимум **id привязания + tenant**, не дублировать полотно `graph-document`.
4. **Observability:** для **`task`** с **`envKeys`** маскирование значений **`data.env`** по пересечению с **`envKeys`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F8 v1**). Дополнительные поля **`secret`** в схеме / маскирование для AI-пайплайнов — по мере расширения **F8** (не дублировать **§17**).

**Точечные углубления позже:** схема шифрования n8n `Credentials` (encryption key rotation); Dify OAuth token refresh в `api/models/oauth.py`; формат экспорта кред Flowise — только если делать миграцию «импорт из Flowise».

---

## 12. Внешний старт прогона: триггеры (**F9**) и публичный контур (**F12**)

У конкурентов **«кто вызывает run»** и **«как нода триггера встроена в граф»** часто сливаются: webhook — и первая нода workflow, и HTTP-слой. Для **GraphCaster** полезно **разделять**: (1) **раннер + документ графа** (слои **A/D**), (2) **транспорт вызова** (HTTP, очередь, CLI), (3) **планировщик по времени** (часто вне процесса редактора). **Классификация триггеров и безопасность входа — §24** (**F9**). **Аутентификация, версии HTTP-контракта, стрим статуса и отличие «админ-API» от run-API — §25** (**F12**).

### 12.1. Сводка по продуктам (уровень B)

| Продукт | **F9** — первичный запуск | **F12** — типовая публичная поверхность | Entry points (B) |
|---------|---------------------------|----------------------------------------|------------------|
| **n8n** | Ноды Webhook, Schedule (Cron), триггеры сервисов; отдельный **`Webhook`**-процесс в queue-mode | URL вида `/webhook/...` к **`WebhookServer`**; REST/public API управления | `packages/cli/src/commands/webhook.ts` → `WebhookServer`; исполнение через очередь |
| **Dify** | Ноды **`TriggerWebhookNode`**, **`TriggerScheduleNode`**, **`TriggerEventNode`** (`api/core/workflow/nodes/trigger_*`) | HTTP API приложений/workflow вокруг **GraphEngine** | Пакеты `trigger_webhook`, `trigger_schedule`, `trigger_plugin` |
| **Flowise** | Нет полноценного «cron в коробке»; запуск извне через **prediction** | REST **`/prediction`**, **`/internal-prediction`**, CRUD **`/chatflows`**, разрешение по **`/apikey/:apikey`** | `packages/server/src/routes/index.ts` (маунты роутов), `routes/predictions` |
| **Langflow** | Расписание обычно **снаружи**; старт через API или **`lfx run`** | REST в `langflow/api` (v1/v2), SSE/streaming, **MCP** | См. **§3.4**; headless **`lfx`** |
| **ComfyUI** | Нет триггер-ноды; пользователь или клиент шлёт prompt | HTTP **`/prompt`**, WebSocket прогресса | См. **§3.5** |
| **Vibe Workflow** | Клиент (Next) | FastAPI в репозитории `server/` | Точечные роуты под медиа-пайплайн |
| **GraphCaster** | **План:** не встраивать cron как n8n в MVP | **Сейчас:** `python -m graph_caster`; **фаза 8:** мост UI↔раннер; **фаза 10:** тонкий HTTP от **хост** или обёртка, вызывающая тот же CLI/библиотеку | Не плодить второй «BaaS»; один контракт: `graphId` + опции run + **§11** env |

### 12.2. Планирование для GC

1. **F9 без дубля n8n:** не обязательно добавлять ноду «Cron» в canvas. Достаточно, чтобы **хост** (Kubernetes CronJob, systemd timer, **хост** scheduler) вызывал **`graph_caster` с `graphId`** или путём к JSON — аналогично тому, как **Langflow** часто запускают извне.
2. **Webhook:** если понадобится, разумная модель — **одна** защищённая конечная точка на стороне **хост** (auth, rate limit, tenant), которая парсит payload и дергает раннер; не смешивать с редактированием графа в **§B**.
3. **Связь с §6 / фаза 8:** внешний caller должен получать **стабильный идентификатор прогона** (`runId` и т.д.), как **Comfy** `prompt_id`, иначе несколько параллельных webhook-вызовов перепутают логи (**G**).
4. **Связь с F6:** полноценная **очередь задач** (как основной режим n8n) — отдельное решение; см. **§13**. **§12** не требует очереди для файлового MVP.

**Точечные углубления позже:** маршрутизация webhook → execution id в n8n (`webhook-service` vs worker); точные OpenAPI-пути Dify для app run — только при интеграции с Dify, а не при автономном GC.

---

## 13. Очередь, параллелизм и режимы исполнения (**F6**)

**F6** у конкурентов — это не только «несколько пользователей», но и **отделение постановки задачи от выполнения**, лимиты concurrency и (у n8n) **горизонтальное масштабирование**. У **GC** важно не перенести инфраструктуру n8n целиком, а зафиксировать **уровни**, на которых может появиться параллелизм.

### 13.1. Сводка (уровень B)

| Продукт | Модель | Entry points (B) |
|---------|--------|------------------|
| **ComfyUI** | Очередь **`PromptQueue`** (класс в **`execution.py`**), привязка к серверу в **`server.py`**; последовательная обработка prompt’ов с отображением статуса | **`main.py`** координирует исполнение; один процесс, фокус на GPU-очереди, не распределённый кластер |
| **Dify** | В приложении — **`AppQueueManager`** + пайплайны в **`core/app/task_pipeline/`**, **`workflow_app_runner`**; события GraphEngine публикуются в очередь для SSE/стрима клиенту | Потокобезопасность на уровне **задачи приложения**, не обязательно Bull/Redis как у n8n |
| **Flowise** | Преимущественно **запрос = исполнение** на Node-сервере; тяжёлые цепочки — async handler или worker-хостинг вне core (зависит от деплоя) | **`routes/predictions`**, контроллеры исполнения |
| **Langflow** | Параллельные HTTP-запросы к API; **`lfx run`** — отдельный CLI-процесс на файл | `langflow/api`, **`lfx`** |
| **n8n** | **`GlobalConfig.executions.mode`**: **`regular`** (в основном процессе) vs **`queue`** + **`ScalingService`**, **`job-processor`**, **`worker-server`** под `packages/cli/src/scaling/`; webhook в queue-mode — отдельный процесс (**§12**) | **`workflow-execution.service`**, **`active-executions`**, остановка/восстановление execution |
| **Vibe Workflow** | Обычно один запрос — одна генерация | FastAPI |
| **GraphCaster** | **◐** — закрытый file-first срез **F6** (очередь шагов + sink к NDJSON): только факты в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (подраздел у сессии **NDJSON**). Планирование межпрогонового параллелизма, воркеров и моста — **§13.2**, **§13.3** | См. тот же файл (**пути к коду**); **`runId`** (**§6**) |

### 13.2. Планирование для GC

1. **MVP:** **межпрогоновый** параллелизм = **несколько независимых вызовов** `graph_caster` (как несколько **`lfx run`**). **Внутри одного прогона** — по умолчанию FIFO **шагов** + **`RunEventSink`** к stdout; опционально **bounded** параллель веток после **`fork`** (см. **Merge** в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md)) — не путать с очередью **многих** прогонов / Redis (**n8n queue**). **`runId`** на событиях обязателен (**E**, **G**).
2. **Фаза 5 (run-lock):** локальная **блокировка редактирования** при активном run — аналог изоляции «edit vs run» у Dify/n8n на уровне UX, без Redis.
3. **Позже (хост / SaaS):** если понадобится «как n8n queue» — очередь и воркеры остаются **в хосте**, GC остаётся **чистым исполнителем** (вход: путь/`graphId` + env), выход: NDJSON + артефакты. Не дублировать `ScalingService` внутри репозитория graph-caster.
4. **Внутриграфовый OS-параллелизм** веток (после **`fork`**): реализованный **срез** (лимит **`maxParallel`**, линейные ветки с **`task`**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**Merge**); полный паритет **n8n** / произвольные DAG-ветки — **§13** / **F6**. Далее в **§13** — **межпрогоновый** параллелизм и инфраструктура очередей.
5. **Мост исполнение ↔ транспорт (фаза 8):** рабочие потоки не должны синхронно звать WebSocket; очередь на event loop — нормальный паттерн (**§13.3**). Глубину буфера и **backpressure** при медленном клиенте закреплять в мосте / **хост**, не размывать контракт ядра NDJSON — **§39.2** (dev **SSE**/**WebSocket** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) **«Backpressure SSE»** + **Evidence**).

**Точечные углубления позже:** детали Bull/Redis в n8n для queue-mode; политика `maxConcurrency` Comfy **`PromptQueue`**; лимиты одновременных run в Dify cloud — только при продуктовом решении «хостить как Dify».

### 13.3. Углубление: ComfyUI — две очереди (**PromptQueue** vs **WebSocket**)

**Исполнение графа:** очередь **`PromptQueue`** (класс в **`execution.py`**, экземпляр **`PromptServer.prompt_queue`** в **`server.py`**) ставит prompt’ы в работу исполнителю и отражается в **`status`** / **`get_queue_info()`** — это **про GPU/CPU-run**, не про доставку JSON в браузер.

**Доставка в UI:** любой поток, включая потоки исполнителя, вызывает **`PromptServer.send_sync(event, data, sid)`**; сообщение попадает в **`asyncio.Queue` `self.messages`**, откуда **`publish_loop`** забирает и вызывает **`await self.send(...)`** (фактическая **`send_json`** / **`send_bytes`** по **`sid`** или всем сокетам). Так **исполнение не блокируется** на медленном WebSocket, но **память** может расти, пока клиент не успевает читать (**нет** верхней границы у очереди по умолчанию).

**Смысл для GC:** при проектировании **моста** (**§39**) полезно явно разделить **(1)** очередь/режим **запуска прогонов** (**F6**, **§13.1**) и **(2)** буфер **нормализованных событий** `run-event` до транспорта; для **(2)** заранее выбрать политику при переполнении — **§39.2**. **Dev `serve`:** реализованный срез **(2)** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«Backpressure SSE»** + **Evidence**, **`process_output`** в разделе **`task`**).

---

## 14. RAG, knowledge base и retrieval (**F10**)

**F10** у конкурентов почти всегда = **(1) ingestion** документов, **(2) хранение эмбеддингов** (vector DB или сервис), **(3) нода или цепочка retrieval** в workflow, плюс у **Dify** — отдельный **dataset/summary** слой в API. Это **не** обязательно дублировать внутри GC: важно выбрать, где живёт знание (**§10** vs внешний API).

### 14.1. Сводка (уровень B)

| Продукт | Ingestion / хранение | В workflow | Entry points (B) |
|---------|----------------------|------------|------------------|
| **Dify** | Datasets, сегментация, summary/vector index через сервисы RAG | Ноды **`knowledge_retrieval`** (`knowledge_retrieval_node.py` → **`DatasetRetrieval`**), **`knowledge_index`**; настройки весов/режимов в `entities.py` | **`core/rag/`** (retrieval methods), **`core/workflow/nodes/knowledge_*`** |
| **Flowise** | Loaders → embeddings → **vectorstores** | Сборка цепочки из **`documentloaders/*`**, **`vectorstores/*`** (Pinecone, PGVector, Qdrant, …) | **`packages/components/nodes/documentloaders`**, **`.../vectorstores`** |
| **Langflow** | Компоненты vector store (LangChain) | Типизированные входы **`Retriever`**, **`VectorStore`**; `LCVectorStoreComponent` | **`src/lfx/src/lfx/base/vectorstores`**, **`lfx/field_typing`**, каталог **`components`** |
| **n8n** | Внешние vector DB через langchain-ноды | **`vector_store/*`** (insert/load), **`RetrieverVectorStore`**, **`ToolVectorStore`**, интеграции OpenAI file search | **`packages/@n8n/nodes-langchain/nodes/vector_store`**, **`.../retrievers/RetrieverVectorStore`** |
| **ComfyUI** | нет | нет | — |
| **Vibe Workflow** | нет | нет | — |
| **GraphCaster** | **нет** | **План:** не строить второй Dify-dataset в MVP | См. **14.2** |

### 14.2. Планирование для GC

1. **Минимальный путь:** нода **`task`** (обёртка над `curl`/CLI) или отдельный шаг вне графа, вызывающий готовый retrieval API (**хост**, OpenSearch, внешний Dify) — без embedding-пайплайна в раннере.
2. **Средний путь:** отдельный **микросервис RAG** (единый с **хост**), GC передаёт `query` + `collection_id` + креды (**§11**); граф остаётся file-first (**F23**).
3. **Полный путь (дорого):** ноды уровня Flowise (loader, splitter, embed, store) — дублирует **`packages/components`** и сопровождение векторных бэкендов; имеет смысл только при явном продуктовом решении «GC = полная LLM-платформа».
4. **Связь с артефактами (**E**):** если retrieval пишет чанки/цитаты в run, зафиксировать формат в `artifacts`/событиях (**G**), не смешивать с «сырым» `node_execute` без политики PII.

**Точечные углубления позже:** pipeline ingestion Dify (`rag_pipeline` в консоли); различие Chatflow vs Agentflow RAG в Flowise; точная схема сегментов в `core/rag` — при задаче импорта или паритета с Dify.

---

## 15. Типизация пинов и совместимость соединений (**F18**)

**F18** связывает **редактор** (что можно соединить на canvas), **схему документа** (какие поля ребра/портов в JSON) и **рантайм** (что исполнитель готов читать). У конкурентов это либо **жёсткая типизация сокетов** (Comfy), либо **несколько семейств рёбер** (n8n), либо **Pydantic + отдельный граф-валидатор** (Dify Graphon). **Уже в GraphCaster (MVP):** статический контракт строковых handle по **`node.type`** до run — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); ниже — сравнение с продуктами и **что ещё не** в MVP.

### 15.1. Сводка (уровень B)

| Продукт | Модель портов / рёбер | Где проверяется | Entry points (B) |
|---------|------------------------|-----------------|------------------|
| **ComfyUI** | Типизированные сокеты в определении ноды; несовпадение типов — до/во время построения списка выполнения | При подготовке prompt / входов ноды | **`comfy_execution/validation.py`** |
| **Dify** | Конфиг ноды (Graphon **`NodeData`** per class); глобально — **`GraphValidator`** с набором правил | При сборке **`Graph`** в `graphon/graph/graph.py`; сохранение черновика — **`WorkflowService.validate_graph_structure`** | **`api/graphon/graph/validation.py`**, **`core/workflow/node_factory.py`** |
| **Flowise** | Категории нод и **`inputs`/`outputs`** в **`INodeProperties`**; связи React Flow → ожидаемые типы ручек на компонентах | Частично в UI; при исполнении — **`constructGraphs`** + компонентные классы | **`packages/components/src/Interface.ts`**, **`packages/server/src/utils/index.ts`** (`constructGraphs`) |
| **Langflow** | Поля компонента + **edge** с именованными handles; проверка совместимости источник/цель | При сборке графа LFX | **`src/lfx/src/lfx/graph/edge/base.py`** (`validate_handles`, `validate_edge`), **`graph/graph/base.py`** |
| **n8n** | Матрица соединений по **`NodeConnectionType`**: основной поток **`main`**, отдельные шины для AI (**`AiAgent`**, **`AiVectorStore`**, …) | Редактор + `workflow` пакет при анализе графа | **`packages/workflow/src/interfaces`** (`NodeConnectionTypes`, `IConnections`), editor-ui |
| **Vibe Workflow** | Зависит от builder | — | `workflow-builder` |
| **GraphCaster** | **MVP F18:** фиксированный набор handle id по **`node.type`** (**`in_default`/`out_default`/`out_error`**); проверка рёбер в UI и в **`validate_graph_structure`** | UI: **`handleContract.ts`**, **`handleCompatibility.ts`**, **`structureWarnings.ts`**, **`branchWarnings.ts`**; Python: **`handle_contract.py`**, **`validate.py`** | Факты и пути — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F18**). **Дальше:** типы данных на портах (как **Comfy**), мультишины (**n8n**) — **§15.2**. |

### 15.2. Планирование для GC

1. **Сделано (MVP F18):** таблица допустимых исходящих/входящих **`sourceHandle`/`targetHandle`** для каждого известного **`node.type`**, паритет TypeScript/Python, предупреждения в редакторе и **`GraphStructureError`** при **`validate_graph_structure`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F18**).
2. **Открыто — типы портов в документе:** ввести **типы портов** в `graph-document` (например **`primitive` / `json` / `blob_ref`**, опционально `stream`), перечисление для каждого **`kind`** ноды, согласовать с **React Flow** и **`validate.py`**; **не копировать Comfy 1:1** (IMAGE/LATENT, …) без домена медиа. Новый **`kind`** ноды задаёт набор портов — **§18** (**F15**).
3. **n8n как идея мультишин:** если появятся **LLM-цепочки** рядом с **обычным** `task`, можно разнести роли рёбер (аналог `main` vs `ai_*`) без смешения в одном handle; иначе достаточно типизированных имён портов на одном ребре.
4. **Связь с F19:** ошибка **исполнения** шага — **`process_*`** / **`out_error`**; инварианты **совместимости ручек** — до run (**F18**); расширенная политика «несовместимое ребро при сохранении» — по продукту, **§16** / **F19**.

**Точечные углубления позже:** полный список `NodeConnectionTypes` n8n и правил editor-ui; детали `GraphValidationIssue` в Dify Graphon; матрица совместимости Comfy `VALIDATE_MAP` — только при импорте workflow из Comfy.

---

## 16. Политика ошибок: стоп, ретраи, error workflow (**F19**)

**F19** у конкурентов распадается на три независимые темы: **(1)** повторные попытки одной операции, **(2)** продолжение графа при сбое (**fail branch** / значение по умолчанию), **(3)** отдельный **workflow** или нода-триггер, куда уходит контекст ошибки (**n8n** / частично события **Dify**). У **GC** есть **(1)** для **`task`** и **(2)** как in-graph **`out_error`** — факты в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F19**); **(3)** не реализован. **Как выбрать между «только события» и «ветка в графе»** — **§37**.

### 16.1. Сводка (уровень B)

| Продукт | Ретраи | Поведение при ошибке без отдельного workflow | Отдельный error workflow / триггер | Entry points (B) |
|---------|--------|----------------------------------------------|--------------------------------------|------------------|
| **ComfyUI** | нет как политика графа | Прерывание исполнения prompt | нет | `execution.py`, сообщения об ошибке в очереди |
| **Dify** | да (нода + **`NodeRunRetryEvent`**) | **`ErrorStrategyEnum`**: abort, **`FAIL_BRANCH`**, **`DEFAULT_VALUE`** | не как отдельный JSON-workflow; стратегия на ноде | **`api/graphon/graph_engine/error_handler.py`**, **`graphon.graph_events`** |
| **Flowise** | зависит от компонента | Исключение пробивает **`executeFlow`** | нет аналога **ErrorTrigger** | `buildChatflow.ts` / контроллеры prediction |
| **Langflow** | зависит от компонента | Ошибка в LFX / HTTP 4xx/5xx | нет универсальной ноды | `lfx` executor, API слой |
| **n8n** | настройки ноды | Стандартно — останов текущего execution | **`IWorkflowSettings.errorWorkflow`** или workflow с **`ErrorTrigger`** | **`execute-error-workflow.ts`**, **`ErrorTrigger.node.ts`**, **`WorkflowExecutionService.executeErrorWorkflow`** |
| **Vibe Workflow** | минимально | Ошибка API / валидации | нет | `server/` FastAPI |
| **GraphCaster** | **`task`:** `retries` + **`process_retry`** / **`process_failed`** | после исчерпания ретраев и при неуспехе **`graph_ref`** — переход по ребру **`sourceHandle` `out_error`**, если есть; иначе стоп (**[`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md)** **F19**) | отдельный error-workflow — **план/вне MVP** — **16.2** | **`runner.py`**, **`process_exec.py`**, **§3.7** |

### 16.2. Планирование для GC

1. **Не дублировать n8n error-workflow в MVP:** отдельный граф только на ошибку тянет **персистентность workflow id**, права (**§11**), защиту от рекурсии (у n8n проверка `mode === 'error'` и `errorWorkflow === workflowId` в **`executeErrorWorkflow`**). Для file-first **F23** проще: хост (**хост**, cron) подписывается на **`process_failed`** / финальный **`error`** по **`runId`** (**§12**, **§13**).
2. **In-graph fail branch (Dify-стиль `FAIL_BRANCH` по смыслу):** реализовано как исход **`out_error`** на **`task`** и **`graph_ref`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F19**); расширения (**DEFAULT_VALUE**, другие стратегии **Dify**) — по продукту, не дублировать с обычным **`edge.condition`** (**§32**) без явного контракта.
3. **Ретраи `task` уже есть:** не смешивать с графовой веткой; счётчик попыток и **`process_retry`** — уровень **Dify** `retry_count` / **`NodeRunRetryEvent`**, не **Error Trigger**.
4. **§15 vs F19:** ошибка **совместимости пинов** должна быть **до run** (validate + предупреждения); ошибка **подкоманды** — **`process_*`**; инварианты графа — **`error`** с кодом сообщения.
5. **События:** при расширении полей **`error`** / **`process_failed`** (stack, классификатор) — обновить **`run-event.schema.json`**, **§3.7**, **`test_run_event_schema.py`** (**§8**).
6. **Матрица «что внедрять»:** **§37** — не смешивать **`FAIL_BRANCH`**-подобную семантику с обычным **`edge.condition`** (**§32**) без отдельного поля/типа ребра.

**Точечные углубления позже:** полный перечень **`ErrorStrategyEnum`** и default-value в Dify `NodeData`; политика n8n **continueOnFail** на нодах (если отличается от error-workflow); маппинг стрим-событий ошибки Langflow под конкретную версию API.

---

## 17. Наблюдаемость: стрим логов, история execution, трейсинг (**F13**)

**Реализованный слой:** консоль (**F13**, фаза 7); **оверлей исполнения на канвасе** (статусы нод по **`run-event`**, live, replay и **settled** после выхода воркера, per **`rootGraphId`**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F13**); **файловый журнал прогона** (**`events.ndjson`**, **`run-summary.json`**, UI **History**, брокер/Tauri) — там же; **dev run-брокер** (`serve`, **SSE** / **WebSocket**) и bounded backpressure — там же (**«Backpressure SSE»** + **Evidence**), без дубля в этом разделе. Ниже — **сравнение с конкурентами** и темы **F13**, которые в **`graph-caster`** остаются **вне** этого среза (**OTel**, ORM-**`Execution`**, **prod**-транспорт **§39** / relay **§39.2** п.7 и п.6 — политика хоста).

**F13** у конкурентов почти всегда многослойна: **(1)** поток событий «что сейчас выполняется» для UI, **(2)** сохранённый **execution** (аудит, отладка, биллинг), **(3)** опционально **распределённый трейсинг** (OpenTelemetry) и **LLM-специфичные** экспорты (Langfuse, LangSmith, Phoenix). У **GC** сильны **(1)** в виде плоских NDJSON-событий; **(2)** закрыт **file-first** срезом (NDJSON + сводка в каталоге рана, без БД); полный паритет SaaS-**`Execution`** — нет; **(3)** не внедрялся.

### 17.1. Сводка (уровень B)

| Продукт | Поток в UI / клиент | Персистенция прогона | Трейсинг / LLMOps (B) | Entry points (B) |
|---------|---------------------|----------------------|------------------------|------------------|
| **ComfyUI** | WebSocket **`progress`**, `executing` / `executed` (**§3.5**) | Ограниченно (сессия, пользовательские логи) | нет в core | `main.py`, `execution.py` |
| **Dify** | SSE/очередь приложения из событий GraphEngine (**§3.6**) | **`WorkflowExecution`**, слой **`persistence`** | **`ObservabilityLayer`** — OpenTelemetry **`Tracer`** + spans; **`TraceQueueManager`** / **`TraceTask`** (`core/ops/`) | **`api/core/app/workflow/layers/observability.py`**, **`persistence.py`** |
| **Flowise** | Ответ prediction / стрим зависит от цепочки | **`Execution`** в БД, фильтры в **`services/executions`** | в основном прикладные метрики; не OTel-first | **`packages/server/src/database/entities/Execution.ts`**, **`routes/executions`** |
| **Langflow** | SSE, asyncio queue (**§3.4**) | БД инстанса + логи API | **`TracingService`**, **`TelemetryService`**, LangChain callbacks | **`src/lfx/src/lfx/services/tracing`**, **`.../telemetry`** |
| **n8n** | Editor / API по **`executionId`** | **`ExecutionRepository`**, полный **`IRunExecutionData`** | продуктовые / enterprise логи; не фокус строки | **`packages/cli/src/active-executions.ts`**, **`@n8n/db` Execution** |
| **Vibe Workflow** | Ответ HTTP | Минимально | нет | `server/` |
| **GraphCaster** | Консоль по событиям (**§3.7**), в т.ч. инкрементальный вывод **`task`** (**`process_output`** в NDJSON); **оверлей статусов нод на канвасе** (live / replay / **settled** после процесса, **`nodeRunOverlay.ts`**, **`runSessionStore.ts`**, **`GraphCanvas`**, i18n **`app.run.overlay.*`**, **`app.run.clearSettledVisual*`**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F13**) | **File-first:** **`events.ndjson`** + **`run-summary.json`** при **`--artifacts-base`**; список/чтение через Tauri и **`POST /persisted-runs/*`**; UI **History** + replay с тем же оверлеем; предупреждение при несовпадении **`rootGraphId`** лога и открытого графа — там же | **нет** | **`run_event_sink.py`**, **`artifacts.py`**, **`runner.py`**, **`process_exec.py`**, **`run_broker/`**, **`run_bridge.rs`**, **`RunHistoryModal`**, **`schemas/run-event.schema.json`**, **`ConsolePanel`**, **`parseRunEventLine.ts`**, **`runEventSideEffects.ts`**, **`runSessionStore.ts`** |

### 17.2. Планирование для GC

1. **Не смешивать фазы:** фаза **7** — фильтры, поиск, экспорт из консоли, привязка к ноде (**сделано** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md)); **оверлей статусов нод на канвасе** по потоку **`run-event`** (live / replay / **settled** после выхода воркера — см. строку **«Итог прогона на холсте…»** в **«Визуализация прогона на канвасе»** того же файла) — **сделано**, там же (**F13**); фаза **8** — надёжная доставка событий (**WebSocket** / буфер) и мост UI↔Python; внешний OTel — только при явном требовании **хост** или enterprise.
2. **`runId` и корреляция:** как у **Comfy** `prompt_id` и **n8n** `executionId` — один идентификатор на все строки прогона (**§3.7**, **§13**); иначе консоль и артефакты расходятся при параллельных запусках.
3. **Артефакты vs «база execution»:** file-first **F23** допускает **индекс** прогонов в SQLite/облаке у хоста без переноса тела графа; не копировать **`Execution`** Flowise как обязательную ORM внутри graph-caster.
4. **LLM-токены и стоимость:** если появятся ноды с LLM, иметь в виду **Dify**/Langfuse-подобные агрегаты; до этого достаточно **`node_execute`** без лишних PII (**§11**).
5. **Связь с F16/F7:** десктоп может писать локальный **ротационный лог** файлов NDJSON; облако — отдельная политика хранения — контекст упаковки и FS — **§33**.

**Точечные углубления позже:** схема **`TraceTask`** и очередь **`ops_trace_manager`** в Dify; какие поля в **`Execution`** Flowise сериализуются для Agentflow vs Chatflow; политика retention execution в n8n по режимам БД.

---

## 18. Расширяемость нод: реестр, версии, маркетплейс (**F15**)

**F15** определяет, как продукт добавляет **новый тип шага** без форка всего движка. Типовой паттерн: **(1)** регистрация типа в **рантайме**, **(2)** описание полей/pinов для редактора, **(3)** опционально **загрузка стороннего кода** (npm wheel, plugin bundle). У **GC** сейчас **(2)+(3) минимальны**: фиксированный список **`kind`** и диспетчер в **`runner.py`**.

### 18.1. Сводка (уровень B)

| Продукт | Как объявляется тип | Версионирование | Сторонние расширения | Entry points (B) |
|---------|---------------------|-----------------|----------------------|------------------|
| **ComfyUI** | Python-класс ноды + `NODE_CLASS_MAPPINGS` | вручную в репо ноды | каталог **`custom_nodes/`** | `comfy/`, `nodes.py` / загрузка custom |
| **Dify** | Импорт пакетов → **`Node`** self-register; маппинг **`NodeType` → версия → class** | **`node_version`** / **`LATEST_VERSION`** в **`node_factory`** | плагины API (**`extensions/`**, стратегии агента) | **`api/core/workflow/node_factory.py`** (`register_nodes`, `resolve_workflow_node_class`) |
| **Flowise** | TS-класс компонента + **`INodeProperties`** | версия в коде компонента | npm **`flowise-components`**, маркетплейс на сервере | **`packages/components/src`**, **`Interface.ts`** |
| **Langflow** | Python **`Component`**, каталог + lazy load | версии компонентов в метаданных | entry points, кастомные пакеты | **`src/lfx/.../interface/components.py`**, **`custom/component` base** |
| **n8n** | **`INodeType`** / JSON description | `version` в описании ноды | **`npm install n8n-nodes-*`**, **`@n8n/create-node`** | **`packages/nodes-base/nodes`**, `packages/core` execution |
| **Vibe Workflow** | Реестр в **workflow-builder** | по релизу монорепо | форк пакета builder / server | **`packages/workflow-builder`** |
| **GraphCaster** | Константы **`nodeKinds.ts`** + JSON Schema `kind` | **MVP:** одна версия документа | **нет** (только PR в репо) | **`ui/src/graph/nodeKinds.ts`**, **`nodePalette.ts`**, **`schemas/graph-document.schema.json`**, **`runner.py`**, **`validate.py`** |

### 18.2. Планирование для GC

1. **Минимальный путь (как сейчас):** каждая новая нода = изменение **схемы** + **`models.py`** + **`runner.py`** + UI (**`GcFlowNode`** / палитра / инспектор). Референс по дисциплине «три места» — **Flowise** (component + server + canvas), не **Dify** plugin host.
2. **Средний путь:** вынести таблицу **`kind`** → **метаданные** (YAML или JSON рядом со схемой), генерировать предупреждения и подсказки инспектора; раннер остаётся явным кодом Python (без `importlib` из пользовательской папки).
3. **Тяжёлый путь (как Comfy/n8n):** загружаемые плагины — сразу **модель доверия** (**§11**, песочница, подписи). Для **хост** разумнее отдельный **реестр доверенных** нод, а не произвольный DLL из интернета.
4. **Связь с F18:** новый **`kind`** почти всегда требует новых **портов** или правил рёбер — обновлять **§15** и **§8** синхронно.
5. **Связь с F10/F7:** RAG- или LLM-нода — **§14** / **F15**; вызов внешнего API или CLI через **`task`** (в т.ч. пресет Cursor Agent — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md)).

**Точечные углубления позже:** полный список **`BuiltinNodeTypes`** / enum Graphon в Dify; политика подписи community nodes в n8n enterprise; сравнение Agentflow vs Chatflow регистрации в Flowise.

---

## 19. Совместное редактирование: CRDT, сессии, граница с workspace (**F22**)

**F22** — это не только «два курсора на canvas», а **модель согласования состояния графа** между клиентами и хранилищем: **операциональные преобразования (OT)**, **CRDT** (часто на базе **Yjs**), либо **грубая сериализация** (last-write-wins, версии документа, блокировка). У **GC** целевой канон — **файл JSON** (**§10**, **F23**); real-time слой **не** обязан жить в Python-раннере.

### 19.1. Сводка (уровень B)

| Продукт | Модель одновременного редактирования | Транспорт / состояние | Заметные entry points (B) |
|---------|--------------------------------------|------------------------|---------------------------|
| **ComfyUI** | Нет shared session | Локальный UI ↔ свой backend | **—** |
| **Dify** | Мультиюзер workspace; граф в БД | API сохранения черновика, права на приложение | **`api/models/workflow.py`**, сервисы workflow в `web/` + API (не выделенный пакет CRDT в open core) |
| **Flowise** | Обычно один редактор | `ChatFlow.flowData` через ORM | **`ChatFlow.ts`**, UI state |
| **Langflow** | Шаринг/проекты на сервере | REST + БД; одновременное редактирование одного flow — продуктовые ограничения | Backend flow API, **`lfx`** для файлового сценария |
| **n8n** | Enterprise / real-time направление | Пакет **`@n8n/crdt`**: провайдер **Yjs** (`providers/yjs.ts`), **WebSocket** / **worker** transports (`transports/`), **awareness** (`awareness/yjs-awareness.ts`), **undo** (`undo/yjs-undo-manager.ts`), sync abstraction (`sync/`) | **`packages/@n8n/crdt/src/`** |
| **Vibe Workflow** | Нет | Клиентское состояние | **—** |
| **GraphCaster** | Не в core | Локальный **`graphs/*.json`**; конкурирующие записи — уровень ОС/хоста | **`workspace.py`**; UI без CRDT (**§19.2**) |

### 19.2. Планирование для GC

1. **MVP / фазы 0–8:** достаточно **одного клиента** на файл и **run-lock** при активном прогоне (**§7**, фаза 5) — это снижает конфликт «редактирую во время run», но **не** даёт **F22**.
2. **Фаза 10 + хост:** выбрать явно — **(a)** optimistic UI + периодический save + разрешение конфликта при `PUT` (версия/ETag), **(b)** CRDT-документ (как **`@n8n/crdt`**) с синхронизацией через хост, **(c)** ветвление в git (два файла графа). Вариант **(b)** не обязан тянуть **зависимость** Yjs **внутрь** `graph-caster`: слой может быть только во фронтенде **хост**.
3. **Раннер остаётся детерминированным:** вход — **снимок** `GraphDocument` (путь или JSON); **D** не подписывается на incremental CRDT-операции.
4. **Связь с F14:** кто может менять граф — **RBAC** хоста (**§20**); CRDT не заменяет права доступа.
5. **Связь с F20:** при **F22** undo может идти через **`YjsUndoManager`** (**§21.1**); локальный undo GC (**фаза 5**) — отдельный стек команд (**§21.2**), пока не сольётся с документной моделью хоста.

**Точечные углубления позже:** как editor-ui n8n подключает **`@n8n/crdt`** в production-сборке; политика Dify при одновременном PATCH одного workflow; возможность **Automerge** / других CRDT как альтернатива Yjs для JSON-дерева.

---

## 20. Мульти-тенант, RBAC и SSO (**F14**)

**F14** у «серверных» конкурентов связывает **идентичность пользователя**, **границу tenant** (workspace / project / organization) и **разрешения** на сущности (workflow, credential, dataset). У **GC** нет user-store: доверие к пути **`graphs/`** задаётся ОС; в **хост** нужно **воспроизвести только границу доверия**, а не полный ORM **Dify**. **§38** фиксирует, **что остаётся в `graph-caster`**, а что относится только к хосту, без повторения таблицы конкурентов ниже.

### 20.1. Сводка (уровень B)

| Продукт | Единица изоляции | Роли / permissions | SSO (типовой след в коде) | Entry points (B) |
|---------|------------------|--------------------|---------------------------|------------------|
| **Dify** | Tenant / workspace | **`TenantAccountRole`** (**OWNER**, **ADMIN**, **EDITOR**, **NORMAL**, **DATASET_OPERATOR**, …) | Enterprise в продукте | **`api/models/account.py`**, контроллеры app/workflow |
| **Flowise** | Organization, **workspace** (`workspaceId` на сущностях) | **`enterprise/rbac/Permissions`**, **`PermissionCheck`** | **`enterprise/sso/`** — Google, Azure, Auth0, GitHub | **`packages/server/src/enterprise/`** |
| **Langflow** | Проект / пользователь сервера | Роли в backend (зависит от редакции) | Enterprise-модули | Langflow API auth |
| **n8n** | **Project**, связь workflow ↔ project | **`Role`** пользователя, **project-level** доступ к workflow/credentials | Enterprise SSO | **`OwnershipService`**, **`ProjectRepository`**, `@n8n/db` entities |
| **ComfyUI** | нет в core | нет | нет | — |
| **Vibe Workflow** | нет | нет | нет | — |
| **GraphCaster** | **нет в репо** | **нет** | **нет** | Вызывающий процесс (**CLI**, **хост**) обязан не отдавать чужой **`graphId`** (**§20.2**) |

### 20.2. Планирование для GC

1. **Разделение:** **GC** остаётся «исполнителем и редактором» при валидном входе; **хост** (или другой хост) решает **кто** может открыть какой **`graphs/...`** или какой blob по **`graphId`**.
2. **Аналог n8n:** проверка «можно ли выполнить error workflow / subworkflow» через **`getWorkflowProjectCached`** — у GC нет БД, но **аналог** — JWT/session с claim **`allowedGraphIds`** или префиксом пути в chroot.
3. **Креды (**§11**):** tenant изолированные vault — только в хосте; в JSON графа по-прежнему **имена** переменных, не значения.
4. **Публичный API (**§12**):** любой webhook для запуска раннера обязан проходить **ту же** RBAC-цепочку, что и UI, иначе обход ACL.
5. **Не копировать Flowise enterprise целиком:** достаточно **матрицы действий** (read graph, run graph, edit graph, admin secrets) на стороне продукта; детализация **PermissionCheck** Flowise — ориентир, не цель паритета.

**Точечные углубления позже:** маппинг **Dify** dataset operator vs workflow editor; политика **n8n** credential sharing между проектами; OIDC flow в Flowise **`SSOBase`**.

---

## 21. Undo/redo и история редактора (**F20**)

**F20** касается только **редактирования документа графа** (слой **B**), не **исполнения** (**D**) и не **артефактов прогона** (**E**). Типовые реализации: **(1)** стек команд с `apply`/`revert` над нормализованной моделью, **(2)** снимки состояния (дороже по памяти), **(3)** при CRDT — встроенный undo-провайдер (**`YjsUndoManager`**, **§19**).

### 21.1. Сводка (уровень B)

| Продукт | Модель undo | Сохранение на диск / БД | Связь с co-edit (**F22**) |
|---------|-------------|-------------------------|---------------------------|
| **Dify** | Операции редактора workflow в SPA; отдельные **save** к API | Черновик в БД по действию пользователя | Не обязательно CRDT; блокировки продукта |
| **Flowise** | В основном состояние React Flow в сессии | **`flowData`** при сохранении chatflow | Нет общего CRDT в open core |
| **Langflow** | История шагов в UI редактора | Сохранение flow через API / экспорт | Зависит от режима шаринга |
| **n8n** | Локальный стек в **editor-ui**; плюс **версии** workflow в `@n8n/db` | Персистенция по explicit save / auto-save политике | Co-edit: **`@n8n/crdt`** + **`YjsUndoManager`** |
| **ComfyUI** | Зависит от ветки UI | Файл / очередь prompt не откатываются undo автоматически | нет |
| **Vibe Workflow** | Простой React state | По действию пользователя | нет |
| **GraphCaster** | **частично (MVP):** снимки **`GraphDocument`**, см. [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) — не отдельные **apply**/**revert** на шаг как у **Dify**; **viewport** в стеке — нет | **`workspace`/`graphs/*.json`** (**§10**); сброс стека при смене файла — как в реестре фич | **хост** + **F22** может заменить или слить стеки (**§19**) |

### 21.2. GraphCaster — статус и остаток плана

**Факт реализации и инварианты (снимки, drag-end commit, run-lock):** [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (раздел **F20** / **§21**).

**Открыто / позже:** конфликт autosave, если JSON изменён **вне** редактора; история **viewport** отдельно от документа; явные **команды** с патчами вместо полных снимков (память на больших `data`); **Yjs** / **F22** — **§19**.

**Точечные углубления позже:** лимиты глубины стека в **n8n** editor-ui; сравнение **Immer** patches vs явные команды в Dify `web/`; интеграция undo с **collaborative** сессией Langflow.

---

## 22. Кэш выходов и инкрементальный прогон (**F17**)

**F17** относится к слою **D** (и частично **E**, если кэш пишется на диск под run). Цель — не пересчитывать дорогие ноды при неизменных входах и структуре. Риски: **устаревшие данные** при неполной инвалидации, **утечки** между tenant/run, **недетерминизм** (время, `random`, внешние API без идемпотентности). При **file-first** (**F23**) кэш обязан **знать ревизию** канонического JSON — **§36**.

**Срез в GC:** partial; **`gcPin`** в документе + раннер (**`node_pinned_skip`**, **`node_outputs_snapshot`**) и UI для **`task`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) («Закреплённый вывод…»); ручной контекст **`--context-json`**; **headless** и **десктоп** межпрогонный кэш **`task`**, **`mcp_tool`** и **`ai_route`** (**`--step-cache`**, **`--step-cache-dirty`**, ревизия документа, события **`node_cache_*`**, транзитив **dirty** по успешным рёбрам; **вложенный `graph_ref`** — подраздел **«Вложенный `graph_ref`»** там же) — блок «Межпрогонный кэш…». Ниже — сравнение конкурентов и **остаток** до паритета с полным Comfy/n8n (**не** дублировать таблицу реализации здесь).

### 22.1. Сводка (уровень B)

| Продукт | Гранулярность | Ключ / условие попадания | Между прогонами |
|---------|---------------|---------------------------|-----------------|
| **ComfyUI** | на выход ноды | **`CacheKeySetInputSignature`** / **`CacheKeySetID`** + `is_changed_cache`; **`BasicCache`** | да, в рамках сессии/провайдера (`cache_provider`) |
| **Dify** | метаданные исполнения ноды в **одном** run | `_node_execution_cache` в **`PersistenceLayer`** | нет как у Comfy; иные ноды могут иметь свой кэш ответов |
| **Flowise** | чаще данные chain / vector | настройки компонента | ограничено |
| **Langflow** | граф сборки | **`flow_id`** в **`chat_service`** кэше (**`api/build.py`**) | пересборка flow; кэш компонент — по контракту компонента |
| **n8n** | нода + partial | **`pinData`**, **`runData`** + **`dirtyNodeNames`** в **`runPartialWorkflow2`** | да, при явном partial и сохранённых данных |
| **Vibe Workflow** | — | — | нет |
| **GraphCaster** | **частично:** **`task`**, **`mcp_tool`**, **`llm_agent`** и **`ai_route`** + диск + **`gcPin`** + **десктоп:** тоггл **Step cache**, очередь **dirty** (транзитивно по успешным рёбрам → **`--step-cache-dirty`**, как **`dirtyNodeNames`** у n8n) + **bubble** при правках во вложенном **`graph_ref`** (стек навигации, **`_parent_graph_ref_node_id`** в раннере) — см. [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); **полный** F17 — **§22.2** | Ключ: ревизия JSON + отпечаток предков + **`data`** ноды + вид ноды (**`nk`**) — см. [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) | **partial**; **`gcPin`** + межпрогонный кэш **`task`** / **`mcp_tool`** / **`llm_agent`** / **`ai_route`** под **`artifacts_base`** — **да** (CLI и Tauri); кэш прочих типов нод / TTL — **нет** (**§22.2**) |

### 22.2. Планирование для GC (остаток **F17**)

Факты реализации (headless-кэш, десктоп, **транзитив `dirty` на корневом графе**, **`context["tenant_id"]`** в ключе при необходимости) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md), «Межпрогонный кэш…». Ниже — только то, что остаётся до «полного» F17 в смысле Comfy/n8n.

1. **Инвариант:** кэширование новых типов нод имеет смысл после стабилизации контракта их **`data`** и событий (**§3.7**); иначе ключи постоянно ломаются.
2. **Два режима (выбрать один в продукте):** (a) **чистый файл-first** — каждый run полный, без скрытого состояния; (b) **явный кэш** — отдельный дисковый или in-memory слой с TTL и лимитом размера (**как Comfy `CacheProvider`**). Сейчас — (b) локально под **`runs/<graphId>/step-cache/`** без TTL в продуктовом смысле.
3. **`§22.2` — что ещё не закрыто относительно «полного» n8n/Comfy:** pin для всех типов исполняемых нод (не только **`task`**); step-cache для нод **кроме** **`task`**, **`mcp_tool`**, **`ai_route`** и **`llm_agent`**; отдельный продуктовый тоггл «зафиксировано / живое» не только через **`gcPin.enabled`**. **Уже закрыто (факты и перечни — только в реестре):** подраздел **«Межпрогонный кэш выходов…»** и блок **«Сводка для… §22.2»** в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) — **не** дублировать здесь.
4. **Безопасность:** при **хост** в общем случае ключ кэша должен включать tenant / user scope (**§20**); опционально уже **`context["tenant_id"]`** — см. реестр фич.
5. **Не путать:** **`clear_graph_index_cache`** в **`workspace.py`** — только список графов на диске, не **F17**.
6. **Ревизия документа** в ключе (канонический снимок + **`schemaVersion`**) уже участвует в headless-кэше — **§36** остаётся нормой при дальнейшем расширении F17.

**Точечные углубления позже:** политика `is_changed_cache` в Comfy для кастомных нод; детали `runPartialWorkflow2` (границы `dirtyNodeNames`); кэш сообщений **Dify** на уровне app services.

---

## 23. Агенты, tools и оркестрация LLM (**F11**)

**F11** — это не только **ветвление по условию** (**F4**), а **замкнутый цикл** «модель предложила действие → выполнен tool / subworkflow → снова модель», плюс память, лимиты итераций и безопасность вызовов. Затрагивает слои **D** (рантайм цикла), **F** (tools, credentials, HTTP), **G** (логирование шагов агента), иногда **A** (схема `data` ноды агента). Транспорт **MCP** (внешний tool-сервер vs экспорт графа как tool) — **§34**.

### 23.1. Сводка (уровень B)

| Продукт | Где живёт цикл | Tools | Память / состояние | Наблюдаемость |
|---------|----------------|-------|-------------------|---------------|
| **Dify** | **`AgentNode._run`** → **`strategy.invoke`** + **`AgentRuntimeSupport`** | **`ToolManager`**, builtin / plugin tools, **`ToolInvokeMessage`** | Параметры в **`AgentNodeData`**, variable pool | Поток событий Graphon + **`AgentMessageTransformer`** / **`AgentLogEvent`** (**§17**) |
| **Flowise** | Исполнение **Agentflow** на сервере (отдельно от классического chatflow) | Ноды tools в canvas; связь в **`flowData`** | Сессия, **`IAgentflowExecutedData`**, Redis/SSE события | **`streamAgentFlow*`** / **`nextAgent`** (**SSE**) |
| **Langflow** | Вершина графа: компоненты агента в **`lfx`** | Подключённые как handles/toolkits LangChain | Memory component, state в рантайме вершины | **`TracingService`**, стрим API (**§17**, **§3.4**) |
| **n8n** | Узлы **Agent** + **`agent-execution`**: сбор шагов, запросы к LLM | Отдельные ноды tools, **`ToolWorkflow`**, MCP tool; метаданные HITL | Memory-ноды (`MemoryBufferWindow`, …) | Execution data + логи **`nodes-langchain`** |
| **GraphCaster** | **`ai_route`** (один раунд к провайдеру) и **`llm_agent`** (цикл во внешнем процессе, NDJSON **`agent_*`**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); полный in-runner цикл — **§23.2** | Через **`task`** / **`mcp_tool`** / внешний subprocess **`llm_agent`**; схема tool — в артефактах run | Минимум: без долговременной памяти ядра GC | События **`agent_*`** + оверлей — реестр выше; «tool_start/tool_end» в ядре при необходимости — **§3.7** |

### 23.2. Планирование для GC

1. **ИИ на графе — не путать слои:** **Статическое** ветвление (**`ai_route`**) и **делегирование цикла** (**`llm_agent`**, subprocess + контракт stdin/stdout) — **закрыто** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md). Полноценный **F11** *внутри* `runner.py` (несколько раундов tool-calling, память как у **Dify**/**n8n**) — по-прежнему **не** цель этого слоя; см. ниже.
2. **Минимальный путь (принят):** нода **`llm_agent`** делегирует цикл внешнему процессу — граф GC остаётся **DAG без скрытого внутреннего стека** (**§16**); детали контракта — только в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md).
3. **Креды и доступ:** API keys только **§11** / env хоста, не в `graph-document`; для tenant — **§20**.
4. **Лимиты:** max шагов агента, таймаут, abort по сигналу — иначе повторяются ошибки **n8n**/`WorkflowExecute` при «залипании» цикла (см. enterprise policy позже).
5. **Конкурентность:** несколько параллельных tool-вызовов (как у OpenAI parallel tools) требуют явной модели в событиях (**порядок**, `tool_call_id`) — ориентир **`createEngineRequests`** n8n.

**Точечные углубления позже:** сравнение **Dify** `AgentStrategyParameter` с картой параметров **Flowise** agent node; **Langflow** ALTK vs простой ReAct; политика **HITL** в **n8n** `Tool.metadata`.

---

## 24. Триггеры старта графа: типы, доставка, безопасность (**F9**)

**F9** отвечает на вопрос **«кто и при каком событии создаёт новый run»**, не на вопрос **«как устроен публичный REST целиком»** (**F12**, **§12**). Типовые классы: **pull** (cron, опрос), **push** (HTTP webhook, очередь), **plugin/event** (события SaaS), **ручной** (UI / CLI). У серверных продуктов триггер часто **первая нода графа**; у GC с **`Start`-семантикой** в документе разумнее держать **внешний адаптер**, который вызывает раннер с **payload → входными данными** без обязательной «ноды webhook» в JSON.

### 24.1. Сводка по классам (уровень B)

| Класс | **n8n** | **Dify** | **Flowise** | **Langflow** | **GC (план)** |
|-------|---------|----------|-------------|--------------|----------------|
| HTTP webhook | **`Webhook.node.ts`**, регистрация пути на **`WebhookServer`** | **`TriggerWebhookNode`**, HTTP-слой app API | Косвенно через **prediction** / embed; не как отдельная триггер-нода в open core | REST/MCP приём; специализированного «webhook node» мало | **Частично в GC:** подписанный **`POST /webhooks/run`** в dev-**`serve`** (HMAC **`X-GC-Webhook-Signature`**, опц. **`X-GC-Idempotency-Key`**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F9 / push**); полный prod-контур и tenant — **хост** (**§12**) |
| Расписание | **`ScheduleTrigger.node.ts`**, **`SchedulerInterface`** | **`TriggerScheduleNode`** | Внешний cron → HTTP | Внешний cron → `lfx run` / API | **CronJob / systemd** → тот же контракт, что CLI (**§24.2**) |
| Событие / плагин | Триггеры интеграций (Google, …) | **`TriggerEventNode`** (`trigger_plugin`) | Ограниченно | Зависит от деплоя | Очередь сообщений / webhook провайдера → **хост** |
| Ручной старт | «Execute workflow» | Run app из UI | Predict из UI | Run из UI | Кнопка в **GC UI** / `python -m graph_caster` |

**Сквозные темы:** **идемпотентность** (повторная доставка webhook), **подпись** (`HMAC` / OAuth), **дедуп** по заголовку или телу, **таймаут** постановки vs **§13** (очередь), **изоляция tenant** (**§20**).

### 24.2. Планирование для GC

1. **Инвариант документа (**A**):** не обязательно моделировать триггер как **`kind`** на канвасе; достаточно контракта «стартовые входы run» (имена полей, схема), которые заполняет **хост** из HTTP body или metadata.
2. **Webhook:** проверка подписи, лимит размера body, **rate limit**, allowlist по IP — на стороне **хост**; раннер получает уже **проверенный** объект входа (как variable pool у Dify на старте, но без копирования GraphEngine).
3. **Cron:** один вызов = один **root run**; при перекрытии долгого run и следующего tick — политика «пропустить / поставить в очередь / отменить предыдущий» в **§13** или в продукте **хост**, не в `runner.py`.
4. **Наблюдаемость (**G**): внешний caller должен получать **`runId`** до или сразу после старта (**§12.2** п.3), иначе дубли webhook не отличить в логах.
5. **Не дублировать n8n:** полноценный **WebhookServer** + регистрация сотен путей из JSON графа — вне scope file-first MVP; ориентир **Langflow**/внешний планировщик для расписания.

**Точечные углубления позже:** жизненный цикл registration webhook в n8n (activation → static path); сравнение **Dify** `TriggerScheduleNode` с worker-планировщиком приложения; idempotency keys в **Flowise** prediction при ретраях клиента.

---

## 25. Публичный API, аутентификация и встраиваемость (**F12**)

**F12** задаёт **контракт для внешнего клиента**: как **аутентифицироваться**, как **запустить run**, как **получить статус/результат**, есть ли **OpenAPI** и **embed**. Это шире, чем **триггер** (**F9**, **§24**): API может обслуживать и **ручной** запуск из UI стороннего приложения. **Совмещённый обзор F9+F12** остаётся в **§12**.

### 25.1. Сводка (уровень B)

| Продукт | Типичная аутентификация | Старт run / inference | Статус и поток | Админ / CRUD графа | Документация |
|---------|-------------------------|----------------------|----------------|-------------------|--------------|
| **n8n** | Сессия UI; **API key** (enterprise); **basic** для инстанса | Execute workflow, **webhook** как отдельный вход | **Execution** в БД, poll; worker в queue mode | REST управления workflow (зависит от плана) | Документация деплоя / enterprise |
| **Dify** | **JWT** / session console; **service API** ключи приложений | Completion, workflow run, streaming ответов | SSE/chunk в продуктовом API | Apps, datasets, workflow в console API | Облачная / self-host OpenAPI-фрагменты |
| **Flowise** | **`/apikey/:apikey`**; Bearer для внутренних роутов | **`POST .../prediction`**, **`internal-prediction`** | **SSE** (см. **`SSEStreamer`**, очередь Redis) | **`/chatflows`**, agentflows, tools | **Swagger** `api-documentation` |
| **Langflow** | **API key** в заголовках; переменные из headers (**§11**) | **`/build`**, чат/run endpoints, **`lfx`** CLI | **SSE** stream (**§3.4**) | Flow CRUD в API; **MCP** для агентов | Доки + схемы FastAPI |
| **ComfyUI** | Часто без auth (локально) | **`POST /prompt`** | **WebSocket** **`progress`** | Нет как у SaaS | Community wiki |
| **Vibe Workflow** | **`MU_API_KEY`** только в **`server/.env`** (прокси в MuAPI); типовой репозиторий — BFF для **Next.js** на **`localhost:3000`**, не выделенный API key на арендатора | **`POST /api/workflow/{workflow_id}/run`**, **`GET /api/workflow/run/{run_id}/status`**, **`POST .../node/{node_id}/run`** + CRUD defs через тот же префикс | Ответы MuAPI; poll по **`run_id`** | Прокси: create/list/delete/update workflow def, publish, template | Нет сгенерированной OpenAPI в репо; контракт совпадает с **`api.muapi.ai/workflow/...`** (**§25.3**) |
| **GraphCaster** | **План:** только у **хост** (JWT, API key, mTLS) | **`POST /v1/runs`** (условно): `graphId`, входы, опции | Редирект на **NDJSON** stream или poll **`runId`** (**§3.7**) | **Не** отдавать полный JSON графа без **§20**; локально — файлы | Минимальная OpenAPI у хоста; ядро — библиотека |

**Dify + MCP (к **F12** и **§34**):** публичный приёмник MCP для приложения — **`/mcp/server/<server_code>/mcp`**; администрирование внешних MCP tool providers — **console** **`/workspaces/current/tool-provider/mcp`**. Это **не** тот же контур, что «обычный» service API completion/workflow без отдельной интеграции.

**Встраиваемость:** у **Flowise** — chatflow **embed** на сторонний сайт; у **Dify** — встраиваемые приложения / виджеты; у **Langflow** — в т.ч. **MCP** поверх flow (**§34**); у **Vibe** — страница Next.js + BFF (**§25.3**); у **GC** разумный аналог HTTP — **iframe или скрипт**, которые бьют в **хост**; **MCP (A)** локально — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); публичный MCP / **(B)** — **§34**.

### 25.2. Планирование для GC

1. **Два контура:** (a) **локальный мост** фазы 8 (доверенный UI, тот же хост), (b) **публичный** API только после **§20** — не смешивать в одном listen-порту без TLS и ACL.
2. **Минимальный run-контракт:** `graphId` (или одноразовый upload с TTL), **`inputs`**, **`runId`** в ответе 202; ошибки в формате, согласованном с **`run-event`** для полей `error` (**§3.7**).
3. **Секреты:** тело запроса не содержит значений кредов — только ссылки/имена; резолв — **§11**.
4. **Версионирование:** префикс **`/v1`** у хост; изменения, ломающие клиентов, → новая major-версия; ядро `graph_caster` остаётся **semver библиотеки**, не HTTP.
5. **Наблюдаемость для внешнего клиента:** опциональный **`GET /v1/runs/:id/events`** (SSE или NDJSON), маскирование PII (**§17**, **§11**); согласовать с **§39** (тот же **`run-event`** за разными MIME).
6. **BFF как у Vibe (**§25.3**):** если UI в браузере, а «истинный» раннер — за пределами **`graph_caster`**, серверный слой держит креды (**§11** / **§38**), клиент не получает **`MU_API_KEY`**-аналог в bundle.

**Точечные углубления позже:** точные пути **Flowise** `upsert` chatflow vs predict; политика **Langflow** rate limit на публичных роутах; сравнение **n8n** public API v1 с `execute-workflow` worker payload.

### 25.3. Vibe Workflow: эталон **BFF** к облачному раннеру (MuAPI)

Репозиторий **Vibe-Workflow-main** полезен **не как паритет n8n**, а как **скелет продукта**: тонкий **FastAPI** прячет **`MU_API_KEY`** и проксирует JSON на **`api.muapi.ai`** (**`proxy_request_helper`**: **GET/POST/DELETE**, таймаут 60s). Редактор и состояние графа живут в **Next.js** + **workflow-builder**; исполнение и очереди — **вне** открытого репозитория.

**Планирование GC / хост:** при **embed** или «лёгком» UI без прямого **`python -m graph_caster`** в том же процессе — тот же разрез: **браузер → доверенный BFF → раннер** (локальный subprocess или удалённый сервис); публичные ключи и ACL — **§20** / **§38**, не в **`graph-document`**. Контракт **POST run** / **GET status** в открытом коде — **§3.8**; сводка транспортов — **§39.1**.

---

## 26. Локализация интерфейса и сообщений (**F21**)

**F21** у крупных продуктов почти всегда многослойна: **(1)** строки **редактора** (меню, модалки, подписи нод), **(2)** **системные** сообщения исполнения (частично переводятся в UI поверх стабильных кодов), **(3)** **документация** и маркетинг — отдельно от приложения. У **GraphCaster** сейчас сильна только **(1)** в объёме **`ui/`**; **(2)** для NDJSON событий разумно держать **английские** или **нейтральные** машинные тексты до появления **каталога кодов** ошибок.

### 26.1. Сводка (уровень B)

| Продукт | Стек / расположение | Охват | Примечание |
|---------|---------------------|-------|------------|
| **n8n** | **`@n8n/i18n`**, загрузка в **editor-ui** | UI редактора, ноды, часть сообщений об execution | Комьюнити-локали; ключи стабильны между минорными релизами |
| **Dify** | **`i18next`** в **`web/`**, каталоги **`web/i18n/*`** | Консоль, ноды workflow, много ISO-языков | Доки **`docs/*`** частично переведены отдельно |
| **Flowise** | Каталог **`i18n/`** + клиент UI | Подписи чатфлоу, общие UI-строки | Меньше языков, чем у Dify/n8n |
| **Langflow** | SPA редактора: модули переводов в дереве фронтенда | Основной веб-клиент | Тесно связано с версией UI-бандла |
| **ComfyUI** | Практически нет единого i18n-слоя | EN + точечные переводы | Не конкурент по F21 |
| **Vibe Workflow** | Next.js, строки в компонентах или подключаемый i18n | Частично | Зависит от продукта |
| **GraphCaster** | **`ui/src/i18n.ts`**, **`en.json`**, **`ru.json`**, **`react-i18next`** | Слой **B**: TopBar, панели, палитра, часть UX | Автовыбор **ru** по префиксу `navigator.language`; **CLI** и тексты в **`validate.py`** — преимущественно EN |

**Расхождение UI ↔ раннер:** у **n8n/Dify** финальное сообщение пользователю часто собирается на сервере или по коду ошибки; у **GC** при появлении локализованной консоли имеет смысл ввести в **`run-event`** (если понадобится) поле вроде **`error.code`** (строка-ключ) рядом с **`message`**, а перевод выполнять в **`ConsolePanel`** через **`t('runner.' + code)`** — иначе дублировать переводы в Python (**§3.7**, **§8**).

### 26.2. Планирование для GC

1. **Инвентаризация сырого текста:** пройтись по **`ui/src/components/**`**, **`graph/*Warnings.ts`**, **`nodePalette`** — вынести в **`locales`**; для параметрических сообщений использовать **`interpolation`** **`i18next`**.
2. **Предупреждения структуры графа:** либо ключ **`warnings.<id>`** + `{{nodeLabel}}` в JSON, либо короткий стабильный **код** в объекте предупреждения и маппинг в UI (**аналог** нормализации ошибок в enterprise-консолях).
3. **Новые локали:** добавить **`locales/<lng>.json`**, зарегистрировать в **`i18n.init.resources`**; политика **fallback** — **`en`**; RTL только при отдельном ТЗ (**хост** / enterprise).
4. **Раннер и `graph_caster` CLI:** не обязывать локализовать машинный вывод в MVP; если нужен **RU** в терминале — отдельный флаг **`--locale`** или env, не ломающий парсеры CI.
5. **Встраивание в хост:** язык пользователя из **JWT/session** может переопределять **`lng`** в **`i18next`** при старте shell; file-first граф (**F23**) по-прежнему без языковых полей в JSON-документе.

**Точечные углубления позже:** политика **n8n** версий ключей перевода; сравнение объёма **`web/i18n`** Dify по доменам (console vs workflow vs datasets); вынос **Langflow** каталога локалей под конкретный тег релиза.

---

## 27. Внешний процесс, shell и CLI (**F7**)

**F7** у конкурентов распределяется между **(1)** отдельным **процессом на весь граф** (headless CLI), **(2)** **встроенным** вызовом из шага графа (**Execute Command**, code node), **(3)** плагинами, живущими **в одном** процессе с раннером (**Comfy**). У **GraphCaster** центральный путь — **(2)** через ноду **`task`** и **`subprocess`** в **`process_exec.py`**; headless **«как `lfx run`»** уже есть уровнем **`python -m graph_caster`** для всего документа (**§10**), но это не то же самое, что **произвольный shell на каждую вершину**.

### 27.1. Сводка (уровень B)

| Продукт | Модель F7 | Изоляция / риски | Entry points (B) |
|---------|-----------|------------------|------------------|
| **n8n** | Нода **Execute Command** (и аналоги) стартует процесс на машине воркфлоу | RCE на хосте при скомпрометированном графе; в документации — hardening, Docker | **`@n8n/nodes-base`** execute-ноды, `WorkflowExecute` |
| **Dify** | Преимущественно **HTTP** и встроенные сервисы; **выполнение кода** — отдельные ноды/песочницы (политика зависит от деплоя) | Изоляция за счёт инфраструктуры продукта, не универсальный `bash` в графе | **`core/workflow/nodes`** (code / tool контуры) |
| **Flowise** | Кастомная логика на **Node.js** в цепочке prediction | Ограничение — доверие к серверу Flowise и загруженным чатфлоу | **`packages/server`**, компоненты |
| **Langflow** | **`lfx run <file>`** — отдельный процесс Python на граф; компоненты могут дергать ОС точечно | Граница доверия — кто может загрузить flow на сервер | **`lfx`** CLI, **`langflow/api`** |
| **ComfyUI** | Расширения как **Python** в процессе **`main`** | Нет общей модели «shell task» | `execution.py`, custom nodes |
| **Vibe Workflow** | нет | — | HTTP к внешним API |
| **GraphCaster** | **`task`**: **`subprocess.Popen`** + pipe (**stdout**/**stderr**); **`command`/`argv`** или пресет **`gcCursorAgent`** (Cursor Agent CLI — см. [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md)); **`shlex.split`** (POSIX vs Windows), **`cwd`**, **`env`**, **`envKeys`** + workspace-файл секретов (**F8 v1**, там же), таймаут, усечённый вывод, **`successMode`**, ретраи (**§16**) | Доверие к автору графа и к хосту; секреты — **§11** и **«Workspace-секреты…»** в **IMPLEMENTED_FEATURES** | **`process_exec.py`**, **`cursor_agent_argv.py`**, **`secrets_loader.py`**, ветка **`task`** в **`runner.py`**, **`graph-document.schema.json`** |

**Связь с наблюдаемостью:** сейчас вывод процесса попадает в события **`process_*`** с ограничением размера (**`_STDOUT_CAP`** в **`process_exec.py`**); полноценный **стрим stdout** в консоль (**G**) — тема **фазы 7–8** и **§17**, не дублировать без расширения **`run-event`**.

### 27.2. Планирование для GC

1. **Фаза 9 (Cursor CLI MVP) — сделано:** пресет **`data.gcCursorAgent`**, резолвер **`GC_CURSOR_AGENT`**, сборка **`argv`** под **`agent -p`**, **`successMode`** на ноде **`task`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md), **`python/README.md`**. **Дальше (хост / SaaS):** allowlist бинарей, жёсткая политика **cwd** — п.2–3 ниже.
2. **хост / мульти-тенант:** политика **allowlist** исполняемых файлов или **chroot**/контейнер на воркер — вне **`graph-caster`**, но контракт **`task`** должен позволять хосту **отклонять** команду до **`subprocess`** (**§20**).
3. **Паритет с n8n по UX, не по безопасности по умолчанию:** не включать «выполни что угодно» на публичном инстансе без явного флага инстанса; локальный режим может оставаться доверенным (**F23**).
4. **Расширение событий:** если появится потоковая передача stderr/stdout — новые типы или чанки в **`run-event.schema.json`** + **§3.7** + **§39** + **§8**; не ломать потребителей NDJSON без версии протокола (**фаза 8**).
5. **Кросс-платформенность:** сохранять различие **`shlex.split(..., posix=...)`**; пути в **`cwd`** — нормализовать через **`pathlib`** (уже в **`_resolve_cwd`**).

**Точечные углубления позже:** точная матрица опций **n8n** Execute Command (continue on fail, pipe); политика **Dify** sandbox для code-node по редакциям; сравнение лимитов буфера stdout у **Langflow** subprocess hooks — при задаче паритета логов.

---

## 28. Визуальный редактор: канвас, ноды, полотно (**F1**)

**F1** у конкурентов почти всегда **не** сводится к библиотеке «ноды+рёбра»: важны **хром ноды** (иконки, статусы, ошибки валидации), **модель ручек** (мульти-выход, типы шин — см. **§15**), **декорации полотна** (комментарии, группы), **навигация** (миникарта; поиск на полотне), **жесты** (мультивыбор, выравнивание) и **связь с сервером** (автосохранение vs локальный черновик). **MiniMap** / **Controls**, **поиск на полотне**, **меню ПКМ «Добавить ноду»**, **мультивыбор**, **буфер подграфа**, **групповое удаление**, защита **`start`**, а также **канвас UX** (большие графы, **off-viewport ghost**, рамки **`group`**, **snap-to-grid**, **align/distribute** — детали и пути кода только в **«Canvas: большие графы»** [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md)) — факты реализации **только** там; здесь в **§28** — сравнение конкурентов и планирование **остатка** без перечисления уже закрытых фич. У **GraphCaster** осознанный выбор — **@xyflow/react** и единый путь **`ui/src/graph/*`** ↔ **`graph-document`** (**A**).

### 28.1. Сводка (уровень B)

| Продукт | Стек канваса | Особенности UX | Связь с данными графа |
|---------|----------------|-----------------|------------------------|
| **ComfyUI** | Свой рендер (canvas/DOM), не React Flow | Превью изображений на нодах, доменные **сокеты**; сохранение workflow в JSON | Определения нод в Python; prompt строится из полотна |
| **Dify** | **React** SPA **`web/`** | Режимы приложения / workflow; ноды **Graphon**; ошибки графа с уровня API | Черновик в клиенте → **`WorkflowService`**, валидация структуры |
| **Flowise** | **React Flow** в **`packages/ui`** | Chatflow и **Agentflow** — разные полотна; компоненты из **`Interface.ts`** | **`flowData`** (строка JSON) в БД сервера |
| **Langflow** | **React** SPA | Handles у полей компонентов, палитра блоков; оформление темы зависит от сборки | Flow в БД + экспорт для **`lfx run`** |
| **n8n** | **Vue 3** **`editor-ui`** | **Sticky notes**, богатые ноды интеграций, **merge** веток, inline editors | **`Workflow`** JSON в БД, версия пакета **`n8n-workflow`** |
| **Vibe Workflow** | **workflow-builder** + **Next** | Упрощённый пайплайн относительно n8n/Dify | Граф из клиента к FastAPI |
| **GraphCaster** | **@xyflow/react** | Редактор слоя **B** и сценарии **P1/P2**: реализованный UX канваса и производительность полотна — SSOT [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«Canvas: большие графы»**, **MiniMap**, **Поиск**, смежные разделы). **Остаток:** **§15**; встраивание child JSON в **A** — **§29**. | **`GraphDocument`** + **`validate.py`**; без БД (**F23**) |

**Общий риск:** разъезд **«что видит UI»** vs **«что принимает раннер»** — гасить через **§15**, **§18** и тесты **`fromReactFlow`** / **`toReactFlow`**; при сохранении/run явный канон документа после **`sanitizeGraphConnectivity`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**P2**).

### 28.2. Планирование для GC

1. **Фазы 3–4:** довести **паритет по подсказкам** (ветвление и прочее) с минимальным когнитивным шумом; не дублировать **n8n** полноту интеграций — фокус на **`task`** и **`graph_ref`**. **Рёбра с отсутствующими концами** при сериализации — **закрыто** (**P2** `sanitizeGraphConnectivity`); **открытие / инспектор / Save / workspace** (ошибки JSON, имени файла, записи, конфликт **`graphId`**, UX модалки сохранения, **копирование деталей в буфер**, **busy**-состояние модалок, **без закрытия диалога во время копирования** (**`safeClose`** + ref), **сброс busy без гонки** при смене пропсов, пока идёт **`writeTextToClipboard`**) — **закрыто** (P1): **единственный** перечень фактов реализации и уточнений — раздел **«Открытие графа, инспектор и Save: ошибки»** в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**без** повторения здесь). Остаётся жёсткость пинов **§15** / **§18** без полного копирования конкурентов; прочие детали P2 в **§28** не дублируются.

2. **Undo/redo (**F20**):** MVP — **стек снимков** полного **`GraphDocumentJson`** (**§21**, [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md)); переход к явным **командам** с **`apply`/`revert`** — позже (память, паритет с **Dify**). Автосохранение в **`graphs/`** в стек **не** входит и **батчится** отдельно от истории правок.
3. **Run-lock (**фаза 5**):** **закрыто** — блокировка опасных правок при активном прогоне, см. [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F20**); сравнение с **Dify**/n8n — **§21**.
4. **Мини-карта / навигация / производительность полотна (п.4):** **Закрыто** — полный перечень фактов и путей к коду только в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«MiniMap и панель управления полотном»**, **«Поиск и переход к ноде на canvas»**, **«Canvas: большие графы»** включая **visible-only**, **LOD**, **off-viewport ghost**, оверлей, sync рёбер, **ленивое превью `graph_ref`**, **F13**). В **§28** детали **не** повторять. **Встраивание** полного дочернего графа в документ родителя (**A**) — вне scope — **§29** (file-first).
5. **Мультивыбор / clipboard / групповое удаление:** **закрыто** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md), раздел **«Мультивыбор, буфер обмена и групповое удаление»** (детали реализации только там).
6. **ПКМ / добавление ноды на полотне:** **закрыто** — чипы категорий (**Все / Поток / Запуск и ИИ / Вложенные / Заметки**) и текстовый фильтр — только [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md), раздел **«Меню «Добавить ноду» на полотне»**; в **§28** детали не дублируются.
7. **Комментарии и группы (рамки `group`):** **закрыто** — тип **`group`** в документе, **Group selection** / **Ungroup**, отдельный хром от **`comment`**; единственный перечень фактов — подпараграф **«Рамки `group`…»** в разделе **«Canvas: большие графы»** [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**§28.2** п.7 перенесён туда).
8. **Co-edit (**F22**):** не синхронизировать сырой internal-state **React Flow** по сети — только **документ** (**§19**).

**Точечные углубления позже:** сравнение **z-index** и hit-testing **n8n** vs RF при 500+ нодах; паритет с **Dify** GraphEngine по **богатству** визуальных состояний ноды (ожидание / детализация barrier-**merge** и т.д.) — см. открытые пункты **F13** в **§17** и [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**оверлей v1** и **settled** после процесса уже есть — тот же раздел **«Визуализация прогона на канвасе»**).

---

## 29. Вложенные графы и вызов по ссылке (**F5**)

**F5** различает **(1)** ссылку на **другой сохранённый workflow** по **id** (n8n **Execute Workflow**, Flowise **Execute Flow**, GC **`graph_ref` + `graphId`**), **(2)** **встроенный** дочерний граф в том же JSON (**Dify Graphon** child, часть шаблонов), **(3)** «распакованный» сабграф без отдельной сущности (**Comfy**). Для **GraphCaster** ключевая идея — **file-first**: дочерний граф — отдельный файл в **`graphs/`**, а не обязательно строка в БД.

### 29.1. Сводка (уровень B)

| Продукт | Идентификация дочернего графа | Граница вход/выход | Циклы / глубина |
|---------|-------------------------------|-------------------|-----------------|
| **n8n** | **workflow id** в ноде execute; данные подгружаются из БД инстанса | **items**, **paired item**, выражения между родителем и дочерним | Ограничения движка и настройки; защита от бесконечной рекурсии на уровне продукта |
| **Dify** | **Child graph id** в модели **Graphon** | **Variable pool**, события GraphEngine между родителем и ребёнком | **`ChildGraphNotFoundError`** при отсутствии; политика версий черновика |
| **Flowise** | **chatflow id** при **Execute Flow** | Контекст остаётся на сервере prediction | Зависит от реализации API |
| **Langflow** | в основном **один файл flow** или композиция внутри экспорта | Порты компонентов | Рекурсивные циклы ограничены структурой LFX |
| **ComfyUI** | **Subgraph** как конструкция полотна | Сокеты, не отдельный «проектный» id файла | Как у обычного acyclic prompt (с оговорками custom nodes) |
| **Vibe Workflow** | шаблоны, слабая модель внешней ссылки | HTTP-между шагами | Ограниченно |
| **GraphCaster** | **`graphId`** → путь через **`workspace.py`** | Наследуется **`start`/`exit`** дочернего **A**-документа; рёбра родителя к **`graph_ref`** | Явный **лимит глубины** в раннере; **циклы** между файлами по workspace (**`graphId` → `targetGraphId`**) — **закрыто:** [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F5**); **изоляция subprocess** на заход в **`graph_ref`** (опция **`GC_GRAPH_REF_SUBPROCESS`**) — там же (**«Вложенный `graph_ref`: опциональная изоляция…»**); **§29.2** — ленивая загрузка, хост, async и пр. |

**Артефакты (**E**):** вложенный прогон может иметь вложенные каталоги под корневым **`runId`**; политика вложенных **`runs/`** должна оставаться **предсказуемой** для UI и **git clean** (**§10**, **F23**).

**Наблюдаемость (**G**):** события nested (**enter/exit** или эквивалент) не должны ломать фильтр консоли по **`runId`**; при необходимости — поле **пути вложенности** (**`nestPath`**, **`graphRefStack`**) в **`run-event`** согласовать с **§3.7** и **§8**.

### 29.2. Планирование для GC

1. **Контракт `graph_ref`:** держать в **A** только **`graphId`** и параметры, однозначно описанные в **`graph-document.schema.json`**; не протаскивать полный JSON дочернего графа внутрь родителя.
2. **Валидация циклов `graph_ref` по workspace:** **закрыто** — детали реализации и пути в коде только в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (раздел **«Статический цикл `graph_ref` по workspace»**). При «ленивой» загрузке без индекса — по-прежнему рантайм (**`max_nesting_depth`** и т.д.).
3. **Сбои:** ошибка «файл не найден» / неизвестный **`graphId`** — **`error`** с кодом, не молчаливый skip; согласовать с **§16** (**F19**).
4. **хост:** список **разрешённых дочерних `graphId`** по tenant (**§20**); не полагаться на file FS в мульти-тенантном деплое без политики **C**.
5. **Асинхронный дочерний run:** не вводить без **§13** (**F6**) и явного продуктового сценария; MVP остаётся **синхронным вложенным** обходом с точки зрения родителя (родитель ждёт завершения дочернего графа).
6. **Изоляция OS-процесса для вложенного `graph_ref` (опция):** **`GC_GRAPH_REF_SUBPROCESS=1`** — отдельный **`python -m graph_caster run`** на заход; тот же **`runId`** и NDJSON в sink; детали и код — только в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«Вложенный `graph_ref`: опциональная изоляция OS-процесса»**); это **не** замена п.5 и **не** очередь прогонов **F6**.

**Точечные углубления позже:** точные поля передачи контекста **n8n** `executeWorkflow` vs **GC** «данные по рёбрам»; маппинг **Dify** `workflow_entry` child resolution на **один** JSON файл; влияние **§22** (**F17**) на повторный вход в тот же дочерний граф.

---

## 30. Схема `GraphDocument` и эволюция формата (**F2**)

**F2** у «серверных» продуктов почти всегда связывает **(1)** схему хранения в **БД** (миграции ORM/SQL), **(2)** **версию движка** workflow (**n8n-workflow**, Graphon), **(3)** политику **обновления при открытии** черновика в UI. У **GraphCaster** доминирует **(4)** **file-first** (**F23**): канон — JSON на диске + **JSON Schema**; массовых миграций «как у PostgreSQL» нет, зато важны **явный `schemaVersion`**, **обратная совместимость** чтения и **детерминированный** экспорт из редактора.

### 30.1. Сводка (уровень B)

| Продукт | Где живёт «истина» схемы | Версионирование | Миграции |
|---------|--------------------------|-----------------|----------|
| **n8n** | БД + JSON **workflow** | Пакет **`n8n-workflow`**, поля совместимости в JSON | **DB migrations** при апгрейде инстанса; иногда автокоррекции workflow |
| **Dify** | **PostgreSQL** (workflow apps, Graphon) | Версии API и моделей **SQLAlchemy**/Alembic | Миграции **api** при деплое; клиент тянет актуальную форму |
| **Flowise** | **SQLite**/PG + **`flowData`** | Сущность **ChatFlow**, версии зависимостей сервера | **TypeORM** (или аналог) **migrations** в **`packages/server`** |
| **Langflow** | БД инстанса + экспортируемый JSON | Релизы **Langflow** / **LFX** | Backend **migrations** + правила загрузки старых flow |
| **ComfyUI** | Файлы у пользователя | Версия API / набор нод | Мягко: старые workflow могут требовать пересохранения |
| **Vibe Workflow** | Клиент + API | Проще | Точечно |
| **GraphCaster** | **`graphs/*.json`** + **`graph-document.schema.json`** | Поле **`schemaVersion`** (и при необходимости подверсии); семвер **пакета** `graph_caster` отдельно | **Вручную/CLI:** нормализация и bump версии документа; **`validate.py`** отсекает неподдерживаемое; тесты **`test_models_from_dict`**, **`parseDocument`** |

**Разделение контрактов:** **`run-event.schema.json`** (**G**, поток прогона) эволюционирует **независимо** от **`graph-document`** — не сливать версии в одно число (**§3.7**, **§8**).

### 30.2. Планирование для GC

1. **Правило bump:** повышать **`schemaVersion`** при **ломающих** изменениях (удаление поля, смена типа, обязательность); **дополнительные опциональные** поля — по политике «минор без bump» только если **раннер и UI** без изменений не ломаются.
2. **Чтение старых файлов:** либо **явные шаги миграции** (функции `migrate_v1_to_v2` в Python + тесты), либо **fail fast** в **`validate`** с сообщением «обновите файл инструментом X» — избегать молчаливых потерь данных.
3. **Редактор:** при открытии — парсировать через общий **`parseDocument`** / **`models`**; при сохранении — **нормализовать** к текущей схеме и **`schemaVersion`**, чтобы **git diff** был предсказуем (**F23**).
4. **CI:** регрессионные JSON фикстуры **нескольких** `schemaVersion` в **`python/tests/`** или `examples/`, чтобы раннер не «забывал» старый формат до объявленного EOL. **Плюс** автоматический прогон в **GitHub Actions** (или аналоге) в **вашем** репозитории — см. [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) («CI и проверки»).
5. **Встраивание:** если графы приходят с API хост-приложения, а не только с диска, версия документа должна проходить тот же **`validate`** — один контракт (**§25**, **§20**).

**Точечные углубления позже:** сравнение политик **n8n** `WORKFLOW_NODES_VERSION` (или аналог) с явным **`schemaVersion`** в GC; опыт **Langflow** downgrade flow JSON — только при импорте чужих файлов.

---

## 31. Обход графа, зависимости и достижимость (**F3**)

**F3** описывает **как из статического графа получить последовательность (или частичный порядок) шагов рантайма**: **DAG** vs допуск циклов, **merge** нескольких веток (**n8n**), **динамический выбор** следующей ноды (**F4**), **подграфы** (**Comfy**) и **variable pool** (**Dify**). Это **не** то же самое, что **очередь отложенных прогонов** (**§13**, **F6**) и **не** кэш результатов (**§22**, **F17**), хотя **Comfy** тесно связывает порядок с кэшем подграфов.

### 31.1. Сводка (уровень B)

| Продукт | Модель графа исполнения | Динамика маршрута | Контекст между шагами |
|---------|-------------------------|-------------------|------------------------|
| **ComfyUI** | **DAG** по зависимостям сокетов; список нод для prompt | Фиксируется до run (плюс кэш **подграфов**) | Промежуточные выходы нод в памяти исполнителя |
| **Dify** | **GraphEngine** поверх **Graphon** | Условия, **fail branch**, retry на уровне ноды (**§16**) | **Variable pool**, события узла |
| **Flowise** | Граф компонентов → вызовы **LangChain** | Условия/агенты в цепочке | Состояние цепочки на сервере |
| **Langflow** | **LFX** обходит компоненты по рёбрам | Роутинг в компонентах | Контекст исполнителя **lfx** |
| **n8n** | **`IConnections`**, **merge** веток, несколько входов на ноду | **IF/Switch**, фильтры; полный **runData** | **items**, выражения **`{{$json…}}`** |
| **Vibe Workflow** | Линейный/ветвящийся pipeline | Упрощённо относительно n8n | HTTP-состояние |
| **GraphCaster** | Ожидается **один входной** **`start`** и путь к **`exit`**; **порядок** исходящих рёбер из **A** задаёт перебор при ветвлении (**F4**). **Статический** список нод вне обхода от **`start`** (все рёбра считаются проходимыми) — см. [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F3**). **`fork`** / **`merge`** (**passthrough** / **`barrier`**) — там же, подраздел **Merge (`join`)** в **F4** (по умолчанию последовательно; опционально bounded OS-параллель веток при **`maxParallel` > 1 — контракт только в IF). | Вложение: синхронный **`graph_ref`** (**§29**) | Данные по связям документа; события **`node_execute`** и др. (**§3.7**) |

**Граница с F4:** **F3** — *какие* ноды считаются достижимыми и в *каком порядке* перечислены рёбра в документе; **F4** — *какое* исходящее ребро выбирается при шаге (**§32**, **`_evaluate_next_edge`** в **`runner.py`**). У **n8n** часть логики живёт в типах нод (**IF/Switch**), у **GC** — на рёбрах + контекст.

### 31.2. Планирование для GC

1. **Недостижимые ноды (статика, без симуляции условий **F4**):** **закрыто в репозитории** — UI **`unreachable_nodes`**, **`find_unreachable_non_frame_nodes`** в **`validate.py`** (алиас **`find_unreachable_non_comment_nodes`**); детали и ограничения — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (раздел **«Статическая достижимость из start»**). **Остаётся:** продуктовый инвариант «граф связен **с учётом выбранных веток F4**» (не over-approximation); **раннер / CLI** намеренно **не** отклоняют документ только из‑за этого предупреждения.
2. **Детерминизм порядка рёбер:** порядок в массиве рёбер в **A** или явное поле **`order`** для исходов одной ноды — документировать; совпадать с тем, как **React Flow** сериализует связи (**§28**); на рантайм-семантику ветки влияет **§32** (**F4**).
3. **Циклы в одном документе:** по умолчанию **запрет** на уровне **валидации** (как у типичного **DAG** пайплайна); если продукт когда-либо разрешит циклы — отдельная фича и **не** смешивать с текущим **F3** без **§13**/нового исполнителя.
4. **Fork/join (несколько предков):** контракт **`fork`** / **`merge`** и реализованный срез **bounded OS-параллеля** — **закрыты** в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**Merge (`join`)**). **Открыто:** полный паритет **n8n Merge** (произвольные ветки), очередь **многих** прогонов — **§13** / **F6**. До отдельного ТЗ не расширять семантику неявно (**PRODUCT_DESIGNE.md**).
5. **Вложенные графы:** при входе в **`graph_ref`** обход дочернего графа **полностью** до возврата к родителю (**синхронный стек**) — **§29**; события не теряют корневой **`runId`** (**§17**).

**Точечные углубления позже:** сравнение **Comfy** `get_input_info`/ordering с порядком рёбер GC; политика **n8n** «нода ждёт все входы merge» vs **`barrier`** в **`merge`** GC — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (подраздел Merge).

---

## 32. Условные рёбра и выбор ветки (**F4**)

**F4** — это **динамический выбор следующего шага** при нескольких исходящих связях из одной ноды. Для **GC** это **не** то же самое, что **топологический порядок** (**§31**, **F3**), **не** цикл model→tool (**§23**, **F11**). Выбор по **`edge.condition`** (**§32**) отделён от исхода **`out_error`** при сбое (**§16**, **F19**, [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md)); в **Dify** визуально всё может соседствовать в **GraphEngine**.

### 32.1. Сводка (уровень B)

| Продукт | Где живёт условие | Как выбирается ветка | Контекст / выражения |
|---------|-------------------|----------------------|----------------------|
| **ComfyUI** | Редко «if/else» бизнеса; в основном граф данных | Линейный **DAG** по сокетам | Выходы нод в памяти исполнителя |
| **Dify** | Ноды ветвления в **`core/workflow/nodes`**, плюс **`SkipPropagator`** / **`EdgeProcessor`** в **Graphon** (**§3.2**) | Условия в конфиге узла + движок пропуска | **Variable pool** |
| **Flowise** | Condition / Agent в **Agentflow**, ветвления в цепочке | Роутинг в серверной сборке графа | Состояние **LangChain** и др. |
| **Langflow** | Поля и классы компонентов | Роутинг в **LFX** между компонентами | Контекст исполнителя |
| **n8n** | Ноды **IF**, **Switch**, фильтры, выражения в параметрах | Явные типы нод + **merge** веток (**F3**) | **`{{$json…}}`**, **items** |
| **Vibe Workflow** | Набор нод **workflow-builder** | Упрощённо относительно **n8n** | Клиент / ответ API |
| **GraphCaster** | Поле **`condition`** на **`Edge`** в **A** | **`_evaluate_next_edge`** + **`eval_edge_condition`** (`runner.py`, `edge_conditions.py`): первое ребро без условия **или** первое с истинным условием; иначе **`run_end`** **`no_outgoing_or_no_matching_condition`** | Legacy + JSON Logic-подмножество + **шаблоны** **`{{path}}`** (корни **`$json`**, **`$node`**, **`node_outputs`**) — см. **F4**; детали — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md), не дублировать здесь |

**UI:** **`findBranchAmbiguities`** (**`branchWarnings.ts`**) ловит **два безусловных** исхода с одной ноды и **дубликаты** строки условия — это **статические** подсказки; они **не** заменяют согласование с **`runner.py`**.

### 32.2. Состояние реализации и открытые темы

**Закрыто в репозитории (факты, пути к коду):** раздел **«Условные рёбра / F4»** (грамматика **`$json`** / **`$node`** / шаблонов) и подраздел **«Merge (`join`)»** (в т.ч. **bounded OS-параллель** после **`fork`** до **`merge`** **`barrier`**) в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) — здесь не дублировать.

**Открыто / позже:**

1. **Полный n8n Expression runtime** (произвольные функции, произвольный JS, sandbox) — **вне** текущей грамматики (**JSON Logic** + mustache + **`$json`** + ограниченный **`$node`** — только чтение **`node_outputs`**, без Expression); см. строку **GraphCaster** в таблице **F4** выше и **F4** в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md).
2. **Ошибки (расширения):** отдельный **error-workflow** (**§16**), стратегии уровня **Dify** (**DEFAULT_VALUE** и т.д.) — вне текущего **`out_error`**; не смешивать условный успех **`edge.condition`** (**§32**) с выбором **`out_error`** (**[`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md)** **F19**).
3. **Межпрогоновый** параллелизм и полный паритет **n8n** после fan-out (очередь прогонов, queue mode, произвольные топологии веток вне ограниченного класса в **Merge**) — **§13** / **F6**; **узкий** срез «приём **`POST /runs`** → **FIFO** pending до освобождения слота» у dev-брокера — **закрыт** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«Dev WebSocket…»**); детали **внутриграфового** среза (**`RunEventSink`**, **`StepQueue`**, **`fork`/`merge`**) — только там же.
4. **ИИ-ветвление без полноценного F11:** нода **`ai_route`** (HTTP к провайдеру, **`choiceIndex`**, события **`ai_route_*`**, в инспекторе — безопасная ссылка на **`data.endpointUrl`**, см. **`safeExternalHttpUrl`**) — **закрыто** — только раздел **«ИИ-ветвление / нода `ai_route`»** в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); здесь не дублировать. **Остаётся открытым:** смешение «промпт в **`condition`**» и LLM без отдельной ноды; полный агентский цикл — **§23**.
5. **Документирование продукта:** безусловное ребро «глотает» последующие при том же исходном узле — уточнять при смене **`schemaVersion`** в **`PRODUCT_DESIGNE.md`** при необходимости.
6. **Расширение контекста:** опционально **`env`**/имена для предикатов (без **`eval()`**) — согласовать с **F23**.

**Точечные углубления позже:** сравнение **Switch** **n8n** (режимы, **fallback**) с двумя условными рёбрами **GC**; как **Dify** сериализует условие в **Graphon** JSON — при импорте чужих workflow.

---

## 33. Десктопная оболочка: Tauri и локальный UX (**F16**)

**F16** у **GraphCaster** — это **способ доставить тот же веб-редактор** (**§28**, **F1**) в **нативном окне** с доступом к файловой системе хоста, а не второй движок графа. У **Dify / Flowise / n8n / Vibe** продукта «десктоп в коробке» нет или он не является центральной моделью; у **ComfyUI** и **Langflow** десктоп — референс **упаковки** тяжёлого локального сценария (GPU, офлайн-часть пайплайна), что **пересекается по UX**, но не по домену.

### 33.1. Сводка (уровень B)

| Продукт | Стек оболочки | Локальные возможности | Связь с исполнением графа |
|---------|---------------|------------------------|----------------------------|
| **ComfyUI** | Desktop / portable-сборки | Файлы workflow, модели на диске, GPU | Python **`main`**, prompt из UI |
| **Langflow** | Langflow Desktop (продуктовый инсталлятор) | Локальный инстанс + **`lfx`** | Сервер/CLI рядом с UI |
| **Dify** | — | — | Браузер → API |
| **Flowise** | — | — | Браузер → Node server |
| **n8n** | — | — | Браузер → Node server / queue |
| **Vibe Workflow** | — | — | Next.js |
| **GraphCaster** | **Tauri 2** (`Rust` + **WebView2** на Windows), **`tauri.conf.json`**: **`productName`** GraphCaster, **`com.graphcaster.desktop`**, **`beforeDevCommand`/`beforeBuildCommand`** к **npm**, **`frontendDist`**: **`../dist`**, bundle **NSIS/WiX**, **WebView2** bootstrapper в описании bundle | Тот же **`ui`** что и в браузере; путь к проекту / **`graphs/`** — через хост (**File System Access** в web vs нативный диалог — тема **C**, **§10**) | **`python -m graph_caster`** и **`task`** — **вне** минимального **`main.rs`**; мост **фаза 8** (**§12**, **§17**) |

**Граница слоёв:** **F16** в основном **B** + ОС; **F23** — где лежат JSON; **F7** — как запускается CLI/Python; **§33** не заменяет **§27** и **§8**.

### 33.2. Планирование для GC

1. **Один фронт:** не форкать **`App.tsx`** под десктоп без необходимости; различия — **`import.meta.env` / Tauri API** (открыть папку, путь по умолчанию) за тонкой обёрткой **`workspaceFs`**, **`saveToDisk`**.
2. **Python:** явная политика — **системный** интерпретатор и **`PATH`** vs **sidecar**/встроенный runtime; для **хост** и CI проще системный; для «один установщик» — отдельный билд-пайплайн (не смешивать с MVP веб-версии).
3. **Безопасность:** **`csp`: null** в сегодняшнем конфиге — пересмотреть при подключении **внешнего** контента в WebView; **capabilities** Tauri — минимально необходимые (**FS**, **shell** только если согласовано с **§27**).
4. **Обновления:** **Langflow**/крупные desktop-продукты тянут канал автообновления; для GC — решение **отдельно** (таuri-updater vs ручной инсталлятор).
5. **Инсталлятор:** локализации **NSIS** (**English/Russian** в конфиге) — синхронизировать с **F21** и ожиданиями пользователя Windows.
6. **Наблюдаемость:** локальный сняток NDJSON на диск (**§17.2**) — удобнее в десктопе; путь и ротация — согласовать с **`runs/`** (**E**).

**Точечные углубления позже:** сравнение energy footprint **Tauri** vs **Electron** у Langflow (если актуально для PR); политика **pnpm**/monorepo при раздельных билдах **web** vs **desktop**.

---

## 34. MCP: граф как tool-сервер и вызов внешних tools (**F11** × **F12**)

**Model Context Protocol (MCP)** в контексте воркфлоу — это **два зеркальных направления**: **(A)** продукт **экспонирует** сценарий (flow, run) как **набор tools** для внешнего LLM/IDE-клиента; **(B)** граф **вызывает** удалённый **MCP tool server** как шаг исполнения (аналог HTTP-инструмента в **§23**). Это **не** замена **REST** (**§25**) и **не** то же самое, что внутренний **NDJSON-мост** UI↔раннер (**фаза 8**, **§12**): другой клиент, другие границы auth и другой жизненный цикл сессии.

**Направление (A) в GraphCaster (факт кода):** stdio MCP-сервер **`python -m graph_caster mcp`**, tools **`graphcaster_*`**, тот же **`GraphRunner`** — **не дублировать контракт здесь**; единственный реестр фичи — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (раздел **«MCP stdio server»**), детали запуска — **`python/README.md`**. Ниже в §34 — сравнение **конкурентов** и **открытый** объём (**(B)**, HTTP/streamable MCP, tenant, нода-клиент).

### 34.1. Сводка (уровень B)

| Продукт | Экспорт «наружу» (A) | Вызов MCP из графа (B) | Креды / транспорт |
|---------|----------------------|-------------------------|-------------------|
| **Langflow** | **FastAPI:** **`langflow/api/v2/mcp`** (роутер MCP), **`langflow/api/v1/mcp_projects`** (`init_mcp_servers`); при старте — **`MCPComposerService`** (`lfx/services/mcp_composer/service.py`), **`add_projects_to_mcp_servers`** в настройках; конфиг пользователя **`_mcp_servers.json`** (upload/replace в v2); публичные streamable URL вида **`/api/v1/mcp/project/.../streamable`** (см. unit-тесты). Shutdown — **`langflow/utils/mcp_cleanup`**. **Auth:** шифрование **`folder.auth_settings`** (Alembic **`encrypt_existing_mcp_auth_settings`**), миграции секретов — `scripts/migrate_secret_key.py`. | Компоненты с полем **`FieldTypes.MCP`** (`lfx/inputs`), утилиты **`lfx/base/mcp/util`**: **`MCPSessionManager`**, **`MCPStdioClient`**, **`MCPSseClient`**, **`MCPStreamableHttpClient`**, SSL-опции; composio — `create_input_schema_from_json_schema`. Agentic MCP — `langflow/api/utils/mcp/agentic_mcp`. | Глобальные переменные / заголовки (**§11**); **MCP** в **`SENSITIVE_FIELD_TYPES`** (телеметрия). |
| **n8n** | HTTP-сегмент **`N8N_ENDPOINT_MCP`** (дефолт `mcp`, **`packages/@n8n/config`**, **`endpoints.config`**), **`endpointMcp`** в **`abstract-server`**; workflow — **`settings.availableInMCP`**, фильтр **`availableInMCP`** в **`workflow.repository`** | Ноды **`@n8n/n8n-nodes-langchain.mcpClient`** / **`.mcpClientTool`** (**`MCP_CLIENT_NODE_TYPE`**, **`MCP_CLIENT_TOOL_NODE_TYPE`** — **`packages/workflow/src/constants.ts`**; в **`@n8n/workflow-sdk`** — tool в валидаторах) | **`mcp_client_auth_method`** (telemetry: **bearerAuth** / **none**); **`N8N_MCP_MAX_REGISTERED_CLIENTS`**; **§11** / **§35** vs **CredentialsEntity** |
| **Dify** | **(A)** `api/controllers/mcp/mcp.py` — **`MCPAppApi`**, **`/mcp/server/<server_code>/mcp`**, **`handle_mcp_request`** (`api/core/mcp/server/streamable_http`); сущности **`AppMCPServer`**, статус **`AppMCPServerStatus`**. | **(B)** консоль **`ToolProviderMCPApi`** в **`api/controllers/console/workspace/tool_providers.py`** (маршруты **`/workspaces/current/tool-provider/mcp`**, OAuth callback **`/mcp/oauth/callback`**), **`MCPToolManageService`**, модель **`MCPToolProvider`** / таблица **`tool_mcp_providers`** (`tenant_id`, шифрованные URL/заголовки); **`MCPClient`**, клиенты **`api/core/mcp/client/*`**, SSRF — **`create_ssrf_proxy_mcp_http_client`** (`api/core/mcp/utils`); инструмент — **`MCPTool`** (`api/core/tools/mcp_tool/tool`; фильтрация в агенте — **`_filter_mcp_type_tool`** в **`api/core/workflow/nodes/agent/runtime_support.py`**). | Tenant-scoped secrets (**§20**); **§11** / **§35** / **F8**. |
| **Flowise** | REST/SSE predict (**§12**); **отдельного MCP HTTP-сервера «весь граф как tools»** в core нет (в отличие от **Langflow**). | Ноды категории **`Tools (MCP)`** — **`packages/components/nodes/tools/MCP/*`**: общий **`MCPToolkit`** / **`validateMCPServerConfig`** в **`core.ts`**, в т.ч. **`CustomMCP`**, провайдерные (Teradata, Slack, Github, …); в **Agentflow** — **`Agent.ts`** / **`Tool.ts`** (категории **Tools** и **Tools (MCP)**); сервер — **`CachePool.activeMCPCache`**; CLI **`CUSTOM_MCP_SECURITY_CHECK`**, **`CUSTOM_MCP_PROTOCOL`** (`packages/server/src/commands/base.ts`); assistants подмешивают **`getAllNodesForCategory('Tools (MCP)')`**. | **`/apikey`**, credentials (**§11**, **§35**). |
| **ComfyUI** | Локальный `/prompt` | нет | — |
| **Vibe Workflow** | BFF **`/api/workflow`** без локального MCP (**§25.3**) | нет | **`MU_API_KEY`** → заголовок к MuAPI (**§11**) |
| **GraphCaster** | **да (MVP stdio):** **`graph_caster mcp`** — см. [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«MCP stdio server»**). Нет паритета с публичным streamable URL (**Langflow** / **Dify**) до **§25** / **§20** / **§38** | **частично (MVP):** нода **`mcp_tool`** (**stdio** + **streamable_http**) — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«MCP client node»**). **Открыто:** OAuth, пул сессий, шаблоны в **`arguments`** — **§34.2** | Локально: **§11** / **§35** / **`python/README.md`** |

**Связь с obs. (**G**):** вызовы MCP должны давать **коррелируемые** события с **`runId`** (**§17.2**), иначе консоль IDE и лог хоста разъедутся.

### 34.2. Планирование для GC

1. **Режим A (GC как MCP server):** **MVP (stdio) реализован** — см. [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md). **Открыто:** streamable HTTP / публичный endpoint как у **Langflow** / **Dify**, проверка **`GC_MCP_TOKEN`**, tenant-scoped регистрация (**§38**), расширение списка tools / схемы входов per-graph без произвольного FS (**§20** / **§38**).
2. **Порядок зрелости (остаточный):** стабильный **HTTP run** (**§25**) и **`task`** (**§27**) остаются базой для **хост**; углубление **(A)** (публичный MCP) — после контрактов **§20** / **§38**.
3. **Режим B (нода-клиент):** **MVP закрыт** — **`mcp_tool`**, см. [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«MCP client node»**). **Открыто:** OAuth, переиспользование **`ClientSession`**, шаблоны аргументов из **`node_outputs`**, отдельная нода **`tools/list`**.
4. **Не смешивать с F11-ядром:** полноценный **ReAct** внутри `runner.py` остаётся **§23**; MCP — **транспорт**, не замена условных рёбер (**§32**).
5. **Конкурентность:** один MCP session vs несколько параллельных tool calls — политика как у **§13** на уровне хоста (очередь воркера); в текущем stdio MVP — см. ограничения в **`python/README.md`** (**`workerStillRunning`**, таймаут + cooperative cancel).

**Точечные углубления позже:** нюансы **Langflow** MCP при смене мажорной версии API (v1/v2); OAuth и транспорт **n8n** MCP server (прод-релиз); сравнение с **OpenAPI tools** в Dify plugin SDK — при выборе «HTTP vs MCP» для **хост**.

---

## 35. Ссылки на секреты в сериализованном графе vs vault (**F8**, к **§11**)

**§11** описывает подсистему хранения и подмешивания секретов при исполнении. **§35** нужен для **F23** (file-first): при коммите **`graphs/*.json`** и обмене файлами важно, **какие поля допустимы в документе**, чтобы не утекали значения токенов и чтобы экспорт был сопоставим с **n8n** / **Dify** (id и имена, не ciphertext).

### 35.1. Сводка (уровень B)

| Продукт | В сохранённом графе (файл / экспорт / сериализация в БД) | Развёрнутые секреты остаются вне «тела графа» |
|---------|----------------------------------------------------------|-----------------------------------------------|
| **n8n** | На нодах — ссылки на **`credentials`** (id/имя); выражения **`{{$credentials.*}}`** резолвятся только при run | Шифрованное **`data`** в **`CredentialsEntity`**, не в JSON workflow |
| **Dify** | **`credential_id`**, ссылки на провайдеров; ключи variable pool | **`encrypted_config`** и OAuth в отдельных моделях API |
| **Flowise** | Компоненты ссылаются на сохранённый credential по типу + id/name | **`encryptedData`** в сущности **`Credential`** |
| **Langflow** | Имена **global variables** / ключи; корректный экспорт flow без literal-секретов | Значения типа **credential** в БД инстанса |
| **ComfyUI** | Часто параметры нод с ключами/путями (слабее единая дисциплина) | Локально пользователь/env |
| **Vibe Workflow** | Конфиг шагов без центрального vault | **`.env`** сервера вне репозитория |
| **GraphCaster** | **`envKeys`** (имена) в **`GraphDocument`**; значения — в **`.graphcaster/workspace.secrets.env`** (вне git) и/или OS env; явный **`task.env`** — по политике репозитория вне committed секретов — детали [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«Workspace-секреты…»**). Opaque **handles** / **`validate.py`** для произвольных «секретных» полей — при расширении схемы | Не коммитить пары ключ/значение API в **`task.env`** в канонических репозиториях |

### 35.2. Планирование для GC

1. **JSON Schema:** расширения **`graph-document`** под «секрет» — только строгие форматы (например имя env); произвольные строки с префиксом `sk-` в графе запрещать на уровне валидации, если нет явного продукта-исключения.
2. **`task`:** для локальной отладки значения **`env`** допустимы вне git; политика экспорта «strip values» или отдельный **dev** профиль — согласовать с **§10** и CI pre-commit.
3. **HTTP / MCP (**§25**, **§34**): URL без embedded **basic auth**; ссылка на credential — **id на стороне хост**, не «логин:пароль» в поле ноды.
4. **Observability:** маскирование в **`node_execute`** и при отправке графа в LLM — не дублировать **§17**; **§35** про **статический** документ.

**Точечные углубления позже:** политика **n8n** «export workflow with/without credentials»; формат выгрузки **Dify** app — при интеграции импорта.

---

## 36. Инвалидация кэша шагов и ревизия документа (**F17** × **F2** × **F23**)

**§22** описывает *что* кэшируют конкуренты и общий план GC. **§36** нужен, чтобы не смешивать три разных «версии»: **(1)** содержимое **`GraphDocument`** на диске, **(2)** **`schemaVersion`** (**F2**, **§30**), **(3)** кэш **выходов нод** (**F17**). Слой **C** (**индекс `graphId`**, `clear_graph_index_cache`) — про список и пути файлов, а не про попадание в кэш исполнения (**§22.2** п.5).

### 36.1. Сводка (уровень B)

| Продукт | Что считается «новой версией» для кэша шага | Что сбрасывается при правке workflow без смены id |
|---------|---------------------------------------------|---------------------------------------------------|
| **ComfyUI** | Сигнатура входов ноды + флаги **`is_changed_cache`** + идентификаторы **`CacheKeySetInputSignature`** / **`CacheKeySetID`** | Подграф, зависящий от изменённой ноды; провайдер кэша может жить дольше сессии |
| **Dify** | Внутри одного run **persistence** ноды; глобальный «кэш Comfy» для всего app — иной слой | Новый run → новый контекст; не путать с file-first GC |
| **Flowise** | Зависит от компонента и сериализации **`flowData`** | Частичный сброс при пересборке chain |
| **Langflow** | **`flow_id`** и результаты сборки (**`api/build`**) + кэш отдельных компонентов по контракту | Пересборка при изменении JSON flow в БД |
| **n8n** | **`dirtyNodeNames`**, **`pinData`**, **`runData`** в **`runPartialWorkflow2`** | Явно: только «грязные» ноды и нисходящие; **pin** фиксирует выход |
| **Vibe Workflow** | — | — |
| **GraphCaster** | **Факт в коде:** **`graph_document_revision`** текущего документа в **`compute_step_cache_key`**; отпечаток предков (**`upstream_step_cache_fingerprint`**) — канонический срез **`node_outputs`** предков **и** пары **(id ноды graph_ref, ревизия загруженного дочернего JSON)** для прямых предков типа **`graph_ref`** (инвариант workspace: один **`graphId`** — один файл). Детали — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«Межпрогонный кэш…»**, **«Ревизия вложенного graph_ref…»**). **Открыто:** TTL, кэш не-**`task`**, тоггл на полотне — **§22.2** | При **autosave** из UI тот же путь файла должен менять канон узлов/рёбер (**`graph_document_revision`** не учитывает **`meta`** вне этой модели), иначе кэш из прошлого сеанса опасен |

### 36.2. Планирование для GC

1. **До первого кэша:** зафиксировать в **`PRODUCT_DESIGNE.md`**, откуда берётся **ревизия** (хэш всего файла vs только достижимого подграфа от **`start`**): полный файл проще и надёжнее для **F23**.
2. **Вложенные графы (**§29**):** смена содержимого дочернего JSON (канон узлов/рёбер) должна инвалидировать step-cache у **`task`** ниже **`graph_ref`** у родителя — **закрыто** в headless-раннере: [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md), подраздел **«Ревизия вложенного graph_ref в ключе step-cache»**.
3. **хост multi-tenant (**§20**, **§38**):** префикс ключа **`tenant_id`** / **`workspace_id`**; один и тот же **`graphId`** у разных арендаторов — разные кэши.
4. **UI vs CLI:** если редактор держит несохранённые правки, кэш по пути на диске **не** должен использоваться для «текущего черновика» без явного режима «run по буферу».
5. **События:** при появлении **`cache_hit` / `cache_miss`** — **§3.7** и **§8**; до этого достаточно **`node_execute`** без скрытых оптимизаций.

**Точечные углубления позже:** сравнение **`CacheKeySetInputSignature`** Comfy с хэшем **`node_outputs`** GC; политика TTL для disk-cache; миграция **`graph_rev`** при **`schemaVersion` bump** (**§30**).

---

## 37. Оси выбора модели восстановления после сбоя (**F19**, к **§16**)

**§16** сравнивает продукты по ретраям, останову и **error workflow**. **§37** задаёт **оси решения** для GraphCaster: что остаётся на **событиях** (**G**, **§3.7**), что требует **нового ребра/поля** в **A**, что выносится в **хост** (**хост**, **§20**).

### 37.1. Сводка (уровень B)

| Ось | **Dify** | **n8n** | **Flowise** / **Langflow** | Заметка для GC |
|-----|---------|---------|---------------------------|----------------|
| Ошибка как **полный стоп** vs **передача управления** | **abort** vs **FAIL_BRANCH** / **DEFAULT_VALUE** | по умолчанию стоп; **continueOnFail**; отдельный поток error | в основном исключение пробивает run / HTTP 5xx | **GC:** передача по **`out_error`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); не смешивать успех-условие **`edge.condition`** (**§32**) с fault-исходом |
| Второй «граф» только под ошибку | нет (стратегия на ноде) | **errorWorkflow** + **ErrorTrigger** | нет | **§16.2**: для **F23** чаще проще webhook по **`runId`**, чем второй JSON |
| Пейлоад ошибки для следующих шагов | variable pool, события Graphon | **items** / execution error context | ограниченно | расширять **`process_failed`** / **`error`** осмысленно (**§8**) |
| Повтор после частично выполненного графа | политика retry ноды | manual / partial execution | зависит от компонента | связка **§36** (что считать «тем же» прогоном) + идемпотентность внешних вызовов |

### 37.2. Планирование для GC

1. **Базовый уровень:** завершение с **`error`** / **`process_failed`** и стабильным **`runId`**; алерты и ретрай **вне** `runner.py` (**хост**, **§12**) — без нового **`kind`**.
2. **Ветка в том же файле (Dify-стиль):** сделано: **`sourceHandle` `out_error`** для **`task`** / **`graph_ref`** — [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**F19**); дальше — расширения контракта (**DEFAULT_VALUE**, типизация пинов) без смешения с **`edge.condition`** (**§32**).
3. **Отдельный граф (n8n-стиль):** только с **§20** / **§38** (какой **`graphId`** вызывать) и защитой от цикла error→self (**§16.2**).
4. **Ретраи `task`:** не дублировать «второй нодой» то, что уже даёт **`process_retry`** (**§27**).
5. **Консоль/трассы:** любая ветка ошибки должна давать фильтруемый код/тип в NDJSON (**§17**), иначе **F19** не отлаживается.

**Точечные углубления позже:** матрица тест-кейсов **continueOnFail** (n8n) vs **FAIL_BRANCH** (Dify); компенсации (saga) — вне текущего scope GC.

---

## 38. Граница ответственности: `graph-caster` и хост (**F14**, к **§20**)

**§20** сравнивает продукты по tenant, ролям и SSO. **§38** задаёт **контракт для хост** (или другого хоста): что остаётся в репозитории **`graph-caster`**, а что **не** переносится в Python GC при облачном деплое.

### 38.1. Сводка (уровень B)

| Тема | Внутри `graph-caster` | Только хост (хост / ОС) |
|------|-------------------------|-------------------------|
| Путь workspace и **`graphId`** | Разрешение пути, индекс, **`validate.py`**, раннер по переданным путям (**§10**) | Кто может задать корень проекта; ACL «какой **`graphId`** доступен субъекту» |
| Вызов **run** | **`runner.py`**, CLI, NDJSON-события | API key, JWT, rate limit, квоты |
| Секреты в **`task.env`** | Локальные литералы при отладке; в документе — **имена** переменных (**§11**, **§35**) | Vault по **`tenant_id`**; подстановка значений до вызова **`graph_caster`** |
| Callee **`graph_ref`** | Загрузка файла при переданном разрешённом пути или содержимом | Матрица «граф A может вызвать граф B» (**§29**) |
| MCP / публичный HTTP (**§34**) | Тонкая обёртка над тем же прогоном, маскирование ошибок в событиях | Реестр OAuth-клиентов, публичный URL, WAF; tenant-scoped список провайдеров (аналог **`tool_mcp_providers`**) |
| Аудит «**кто** запустил» | Опционально локальный файл рядом с **`runs/`** | Центральный SIEM, корреляция с сессией пользователя |

### 38.2. Планирование для GC

1. Не использовать **`graph-document`** как источник истины для RBAC и **`tenant_id`** (**§6** п.11); хост отфильтровывает до вызова.
2. Любой HTTP-слой над раннером, который доверяет сырому **`graphId`** или tenant-claim **без** проверки в ORM/IAM хоста, трактовать как нарушение **§38** до появления явного контракта «хост уже проверил».
3. Кэш шагов (**§36**): префикс изоляции задаёт хост; GC либо получает уже chroot-нутый workspace, либо env с недвусмысленным префиксом путей.
4. **§34:** схема tools и выполнение шага — в GC; **регистрация** внешнего MCP server в мульти-тенанте — в хост.

**Точечные углубления позже:** сопоставление с IAM конкретного провайдера; «только read-only FS + chroot» vs логическая изоляция по **`graphId`**.

---

## 39. Транспорт потока статуса: WebSocket, SSE и NDJSON (**G**, **фаза 8**, **F13** × **F12**)

**§3.2.1**–**§3.2.5** (n8n **Push**, **redaction** в хуках, **`ExecutionRedactionService`**, стратегии **item**/полей, инвентаризация **`sensitiveOutputFields`**), **§3.3.1**, **§3.4**–**§3.7** разбирают конкурентов по отдельности (**Dify** HTTP-оболочка поверх **`Queue*`** — **§3.6.1**–**§3.6.3**). **§3.8** / **§3.8.1** — **Vibe**: в open repo нет потока **`run-event`**; старт и статус — **REST** через BFF (**poll**), не NDJSON. **§39** фиксирует **ось выбора** для GraphCaster: ядро остаётся **`run-event` + NDJSON** (**§3.7**); **WebSocket** и **SSE** — возможные **оболочки** моста (**фаза 8**), а не второй источник истины. У **ComfyUI** отдельно стоят очередь **исполнения** и очередь **доставки в сокет** — **§13.3**. У **Langflow LFX serve** успешный стрим отдаёт JSON-блоки с суффиксом **двойного перевода строки** (в коде `+ "\n\n"`), **без** префикса **`data:`**, при том же **`Content-Type`** — **§3.4.1**; тот же формат run-stream и **`consume_and_yield`** в **`api/v1/endpoints.py`** при **`stream=True`**, но с пробросом **`event_manager`** в граф — **§3.4.2** (отдельно там же **webhook** SSE с **`event:`/`data:`** и heartbeat). **`POST /api/v2/workflows`** с **`stream=true`** в Developer API даёт **501**, не SSE — **§3.4.3**. У **Flowise** очередь исполнения (**Bull**) и HTTP-SSE разведены через **Redis** в queue mode — **§3.3.1** (сопоставимо с **§13** × **§39**). У **n8n** editor-ui держит отдельный **Push**-канал (**§3.2.1**; полное тело ноды — после **§3.2.2**–**§3.2.4**); при **queue mode** исполнение может быть на worker, события ретранслируются на main.

### 39.1. Сводка (уровень B)

| Продукт | Транспорт | Текстовые события | Бинарные / медиа | Заметка |
|---------|-----------|-------------------|------------------|---------|
| **ComfyUI** | WebSocket **`GET /ws`** | JSON **`{type, data}`**; ядро — таблица **§3.5**; установка — **+** произвольные **`type`** из **`custom_nodes`** (**§3.5.1**) | **`protocol.BinaryEventTypes`** 1…4, **`encode_bytes`** (**§3.5**): UInt32 BE + payload | **`prompt_id`**, **`client_id`**, очередь **`status`**; превью на wire чаще тип **`1`**, не **`2`** |
| **Langflow** | **`text/event-stream`**: **LFX** **`POST …/stream`** (**§3.4.1**); backend **`POST …/run`** / session при **`stream=True`** (**§3.4.2**); **`GET /webhook-events`** — другой фрейминг SSE (**§3.4.2**); **`POST /api/v2/workflows`** + **`stream`** — **501**, не транспорт (**§3.4.3**) | Run-stream: JSON **`{"event","data"}`** + `"\n\n"`, **bytes**; webhook: **`event:`/`data:`** | Превью/файлы обычно вне минимального run-stream | **§3.4.2**: плотный стрим только с **`event_manager`** в **`run_graph_internal`**; **ack** после **`yield`**; **EventSource** на «голых» bytes может потребовать адаптера |
| **Flowise** | **`text/event-stream`**, **`SSEStreamer`**, опционально **Redis** pub/sub (**§3.3.1**) | JSON в **`data:`**, поле **`event`** внутри тела; контракт методов — **`IServerSideEventStreamer`** (**§3.3.2**); сервер — ещё **`streamErrorEvent`** / **`streamMetadataEvent`** / **`streamTTSAbortEvent`** (**§3.3.3**) | TTS — чанки **`tts_data`**; **`tts_abort`** на in-process закрывает **Response** | **MODE.QUEUE** — воркер публикует, API подписан на **`chatId`**; **§12** |
| **Dify** | **`text/event-stream`**: **`data:`** + JSON / **`event:`** ping (**§3.6.1**) | **`Queue*`** → pipeline → **`StreamResponse`** → плоский dict (**full** / **simple** — **§3.6.3**) → **`convert_to_event_stream`**; маппинг движка — **§3.6** | Мультимодальные ответы на уровне app API; **`length_prefixed_response`** — отдельно для plugin daemon | **`workflow_run_id`** на кадрах; **`InvokeFrom`** меняет полноту тела (**§3.6.3**); не копировать enum **`event`** как GC **`type`** (**§3.7**) |
| **n8n** | **WebSocket** или **SSE** **`/{restEndpoint}/push?pushRef=…`** (**§3.2.1**) | Каждый кадр — JSON **`{ type, data }`**; перечень **`ExecutionPushMessage`** — таблица в **§3.2.1** (корневой **`PushMessage`** шире); **`nodeExecuteAfter`** без полного output; полный **`ITaskData`** — после **§3.2.2** | **`nodeExecuteAfterData`** может уйти **binary** WS (тот же JSON в теле) | **`executionId`** в **`data`**; **pub/sub relay** если worker / multi-main; лимит **~5 MiB** на крупный data-push; **`flattedRunData`** и полное тело — **`ExecutionRedactionServiceProxy`** (**§3.2.2**–**§3.2.4**); объявления **`sensitiveOutputFields`** в open **`nodes-base`** — **§3.2.5** |
| **Vibe Workflow** | **REST** BFF (**§3.8**, **§3.8.1**, **§25.3**): **`POST /api/workflow/{id}/run`**, **`GET /api/workflow/run/{run_id}/status`** → прокси **httpx** на **MuAPI** | JSON ответов апстрима, не **`run-event`** | Медиа/результаты — по контракту MuAPI, не бинарные кадры моста в open repo | **`run_id`** для **poll**; пошаговый стрим в открытом Python **не** зафиксирован |
| **GraphCaster** | **NDJSON** (stdout / файл) | Плоский **`type`** на корне объекта (**§3.7**) | Нет бинарных кадров в **`run-event`**; артефакты в **`runs/`** (**E**) | Dev **`serve`**: **SSE** + **WebSocket** **`/runs/{id}/ws`** с **`viewerToken`** (аналог **`pushRef`**) и дуплексом **`cancel_run`** — **`doc/RUN_EVENT_TRANSPORT.md`**, [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md); та же **bounded** очередь подписчика + **`stream_backpressure`**, что у SSE (**«Backpressure SSE»** + **Evidence**). **Prod** relay (**Redis** / очередь) — **§39.2** п.7 (хост **хост**) |

### 39.2. Планирование для GC

1. **Схема:** любой новый тип события — только через **`run-event.schema.json`** + **§8**; транспорт не определяет поля.
2. **Адаптер:** одна строка NDJSON ↔ один кадр SSE (`data: …\n\n`) или одно JSON-сообщение в WS; не плодить параллельные enum типов в мосте. **В репозитории graph-caster (dev):** **`graph_caster.run_transport`**, **`doc/RUN_EVENT_TRANSPORT.md`** — единый реестр фактов в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«Dev WebSocket и `run_transport`»**). Не полагаться на «**`text/event-stream`** = уже валидный **EventSource**» без проверки тела (**§3.4.1** — контрпример).
3. **Параллельные run:** каждый кадр содержит **`runId`** (**§6** п.5, **§17.2**).
4. **Публичный контур:** **§25** / **§38** на границе; открытый WS без ACL — антипаттерн.
5. **Превью как у Comfy:** бинарные WebSocket-кадры — только при отдельном продуктовом ТЗ (медиа-ноды); иначе пути в **`runs/`** + события со ссылкой.
6. **Backpressure (остаток для хоста / prod):** эталон проблемы — неограниченная очередь к сокету (**§13.3**, Comfy **`PromptServer.messages`**). Реализация **dev** `serve` (SSE): bounded очереди, дроп **`process_output`**, **`stream_backpressure`**, пул доставки — единый реестр фактов в [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md) (**«Backpressure SSE»** и подраздел **«Evidence»**). Здесь — только планирование для **хост** / **prod**: явная политика (глубина, дроп, **relay** — см. п.7); блокировать **`runner`/подпроцесс `task`** из-за медленного UI — только осознанно (**latence**).
7. **Несколько процессов (SaaS):** если исполнитель отделён от процесса с открытым **SSE** (как **Flowise** **`PredictionQueue`** + **`RedisEventPublisher`/`Subscriber`** — **§3.3.1**), нужен явный канал доставки событий (**Redis**, message queue, gRPC stream) с тем же контрактом, что и для однопроцессного моста; не смешивать с **§34** MCP без версии. В **монолите Dify** типичный workflow stream держит буфер **в процессе** (**§3.6.1**) — не путать с этим эталоном «вынесенного воркера». У **n8n** готовый паттерн **pub/sub** → main → **Push** (**§3.2.1**); маскирование чувствительных полей в data-push — **§3.2.2**–**§3.2.4**; сколько встроенных нод объявляют пути — **§3.2.5**.
8. **Удалённый раннер без push в BFF:** если единственный контракт — **HTTP** start + **poll** статуса (как открытый контур **Vibe** — **§3.8** / **§3.8.1**), UI **хост** не получает частый **`run-event`** без доп. канала; либо осознанно принять грубый **poll**, либо договориться с хостом о **SSE/WS** по схеме **§39.2** п.2.

**Точечные углубления позже:** сравнение с bounded queues в других стэках; лимиты прокси на длину SSE-чанка; политика **`QueueFull`** для **prod**-мостов **хост** (dev — только [`IMPLEMENTED_FEATURES.md`](IMPLEMENTED_FEATURES.md)); полный **v2 workflow** stream в backend Langflow vs **LFX** — при сближении с продуктовым Langflow HTTP.

---
