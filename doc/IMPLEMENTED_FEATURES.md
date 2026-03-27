# GraphCaster — implemented features (from competitive mapping)

Краткий реестр возможностей, которые перенесены с эталонов (n8n, Dify и др.) в код или контракт GC. Подробный конкурентный разбор остаётся в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md); здесь только **факт реализации** и пути в репозитории.

---

## Host vs run state vs document (n8n `IWorkflowExecuteAdditionalData`)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Документ графа отдельно от инфраструктуры запуска | JSON графа → `GraphDocument` / схема `graph-document.schema.json` |
| Пути workspace, артефакты, индекс `graphs/` — не в «логике ноды» | `RunHostContext` (`python/graph_caster/host_context.py`): `graphs_root`, `artifacts_base`; передаётся в `GraphRunner(..., host=…)` |
| Словарь прогона без подмешивания `graphs_root` / `artifacts_base` | `context` в `run` / `run_from`: host-ключи выкидываются в `_prepare_context`; инфраструктура только через `host=` |

Документация: `python/README.md` (раздел про `RunHostContext`).

---

## Условные рёбра / F4 (n8n IF/Switch, Dify variable-based branch) — конспект **§32**

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Несколько исходов из ноды, предсказуемый выбор ветки | **Инвариант «первое подходящее»:** порядок массива **`edges`** в документе; **`_pick_next_edge`** берёт первое ребро с пустым **`condition`** или первое, для которого **`eval_edge_condition`** истинно; иначе **`run_end`** с **`reason`** **`no_outgoing_or_no_matching_condition`** (`runner.py`) |
| Выражения к данным шага без небезопасного eval | Подмножество **JSON Logic** в строке **`edge.condition`** (JSON-объект с одной корневой операцией); иначе legacy-литеры **`true`**/**`false`**/…; иначе не-JSON-строка → **`bool(context["last_result"])`**. Реализация: **`graph_caster/edge_conditions.py`** (`MAX_EDGE_CONDITION_CHARS`, truthiness GC — см. `python/README.md`) |
| Контекст предиката | **`last_result`**, **`node_outputs`**, пути **`var`** через **`.`** (напр. **`node_outputs.t1.processResult.exitCode`**). Скрыты только **корневые** ключи **`context`** с префиксом **`_`**; вложенные поля под **`node_outputs`** не маскируются |
| Связь с **task** | **`node_outputs[id].processResult`**: `exitCode`, `success`, `timedOut`, `cancelled`, объёмы stdout/stderr — после каждого **`process_complete`** и при **`spawn_error`** (`exitCode` **`-1`**, `python/graph_caster/process_exec.py`) |
| Статические предупреждения в UI (не заменяют раннер) | **`findBranchAmbiguities`** / **`branchWarnings`** — два безусловных исхода, дубликаты строки условия (`ui/`, **§32.1** competitive doc) |
| Событие выбранной ветки | **`edge_traverse`** в потоке NDJSON; отдельных **`branch_taken`**/**`branch_skipped`** пока нет (**§32.2** в competitive — открытый пункт) |

**Вне текущей реализации F4 у GC (остаётся в `COMPETITIVE_ANALYSIS.md`):** выражения уровня **n8n** (`{{$json…}}`), явные **fail-/on_error-ветки** (**§16**, **F19**), **fork/join** как у **n8n merge**, ИИ-ветвление без отдельной ноды (**фаза 6**).

Документация: `python/README.md` (раздел «Условия на рёбрах»), `schemas/graph-document.schema.json` (`edges[].condition`). Углублённое сравнение с конкурентами — **§32** в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md).

---

## Отмена / повтор в редакторе — **F20**, конспект **§21** (`COMPETITIVE_ANALYSIS.md`)

В **§21** для GC заложены три класса подходов: **(1)** стек команд `apply`/`revert`, **(2)** снимки состояния, **(3)** CRDT **`YjsUndoManager`** (только при **F22**). Реализован вариант **(2)** — как осознанный MVP (паритет экспорта с Python без inverse на каждую операцию).

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| **Dify** — черновик редактора в SPA, отдельные save к API | Локально: снимки **`GraphDocument`**, без отдельного **command stack** уровня Dify `web/` |
| **n8n** — локальный стек в editor-ui + версии workflow в БД ортогонально | Снимки JSON в памяти; версии workflow в БД **нет** (**F23** file-first); co-edit **Yjs** — **не** делается до **§19** / **F22** |
| **Langflow** — история шагов на canvas | Близко по UX: undo/redo структуры, инспектора, связей; глубина ограничена (`DOCUMENT_HISTORY_CAP`) |
| **Flowise** — частичный undo на UI | Аналогично «частично»: нет произвольной глубины как у IDE; есть **redo** после **undo** без сброса при простом начале drag (фикс в конце жеста) |
| Пользователь откатывает правки документа без отдельного сервера | **Снимки** полного `GraphDocumentJson` (`past` / `future`), hotkeys **Ctrl+Z** / **Ctrl+Shift+Z** / **Ctrl+Y**, меню **Правка** |
| Граница транзакции | `snapshotBeforeChange`; **drag** — capture в `onNodeDragCaptureBegin`, запись в стек в `onBeforeNodeDragStructureSync` только если экспорт изменился; **remove** — `onBeforeStructureRemove`; автосохранение в **`graphs/`** в стек **не** входит |
| Run-lock | При активном `activeRunId` snapshot/undo/redo отключены; кнопки disabled |

**Сделано / инварианты из §21.2 (бывший план):** совместимость с **`parseDocument` / `toReactFlow` / `fromReactFlow`** (единый канон JSON); пакетное удаление — один проход RF → один `remove` batch → один checkpoint; autosave после undo пишет откатанное состояние; run-lock согласован с политикой UX.

**Не сделано (остаётся в `COMPETITIVE_ANALYSIS.md` §21 / §28.2):** отдельная история **viewport**; отдельные **команды** с `apply`/`revert` per op (как в **Dify**); конфликт «файл на диске изменён снаружи» при autosave; **Yjs** для undo при **F22**.

Код: `ui/src/graph/documentHistory.ts`, `ui/src/layout/AppShell.tsx`, `ui/src/components/GraphCanvas.tsx`, `ui/src/components/TopBar.tsx`; тесты: `ui/src/graph/documentHistory.test.ts`.

---

## Сессия прогона в NDJSON (n8n `executionStarted` / `executionFinished`, один `runId`)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Стабильный идентификатор исполнения на потоке событий | Поле **`runId`** (UUID) на всех событиях корневого прогона и вложенного `graph_ref` |
| Старт сессии: id, workflow/graph, время, режим, имя | **`run_started`**: `rootGraphId`, `startedAt`, **`mode`** (по умолчанию `manual`, `context["run_mode"]`), опционально **`graphTitle`** из `meta.title` |
| Завершение с явным статусом | **`run_finished`**: `status` (`success` \| `failed` \| `cancelled`), **`finishedAt`**; всегда последнее событие корневого кадра (`try`/`finally`) |
| Нормализация пустого / невалидного `run_id` из контекста | Пустое / `None` / пробелы → новый UUID; см. `_normalize_run_id_candidate` в `runner.py` |
| Ограничение размера `mode` в потоке | Обрезка до 128 символов |

Контракт: `schemas/run-event.schema.json`. Код: `python/graph_caster/runner.py` (`emit`, `run_from`, вложенный `GraphRunner(..., run_id=…)`).

**Намеренно не перенесено** (см. обсуждение в `COMPETITIVE_ANALYSIS.md` §3.2.1–§3.2.4): `ExecutionPushMessage` целиком, `pushRef`, WebSocket/SSE, redaction / `flattedRunData`, relay кадров.

---

## Реестр корневых прогонов и отмена (Dify `ExecutionCoordinator` / команды снаружи, n8n `executionId`)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Хост видит активные исполнения по стабильному id | `RunSessionRegistry`: `run_id` → `RunSession` (статус, `started_at` / `finished_at`, `cancel_event`) |
| Запрос остановки снаружи процесса обхода | `request_cancel(run_id)` → `threading.Event`; раннер проверяет между шагами (включая **`nesting_depth > 0`**); для `task` — опрос + **`proc.kill()`** в фоновом **`communicate`**; до **`process_spawn`** — без событий **`process_*`** |
| Один процесс, несколько клиентов UI / потоков | `get_default_run_registry()` — ленивый синглтон; CLI: `run --track-session` |
| Канал команд в тот же процесс (аналог Dify `CommandChannel` / in-memory) | CLI: **`run --control-stdin`** (с **`--track-session`**) — строки NDJSON: `{"type":"cancel_run","runId":"<uuid>"}`; опционально **`--run-id`**; отладка JSON: **`GC_CONTROL_STDIN_DEBUG=1`** |
| Синглтон реестра | **`reset_default_run_registry()`** для тестов / сброса процесса |
| Повторное использование `context` | В **`_prepare_context`** сбрасываются **`_gc_process_cancelled`** и **`_run_cancelled`** |
| Нить **`communicate`** после **`kill`** | **`RuntimeWarning`**, если join не завершился за таймаут |
| Прерывание воркера при abort (как остановка шага у n8n) | Подпроцесс **`task`**: поток + `proc.kill()` при отмене; событие **`process_complete`** с **`cancelled: true`** |
| Итог прогона с отменой | `run_finished.status`: **`cancelled`**; флаг **`_gc_process_cancelled`** → **`_run_cancelled`**, проброс из вложенного **`graph_ref`** |

Код: `python/graph_caster/run_sessions.py`, `graph_caster.__main__` (**`--track-session`**, **`--control-stdin`**, **`--run-id`**), `process_exec._communicate_with_cancel`, опция `GraphRunner(..., session_registry=…)`, порядок: регистрация сессии **до** `run_started`, чтобы колбэки sink могли вызывать `request_cancel`. Вложенный **`GraphRunner`** получает тот же **`session_registry`** для общей сессии отмены.

**Сопоставление с §3.2 competitive doc (Dify / n8n):** срез **«команда abort / адресация исполнения по id»** сведён сюда (`CommandChannel` у Dify — полноценный pause/redis; у GC пока in-process + stdin). **`IRunExecutionData` / `executionId`** у n8n — частичный параллель: реестр **`RunSessionRegistry`** и стабильный **`runId`** на событиях; **без** очереди ready-nodes и **без** WebSocket **`pushRef`** в браузере (опционально **§39** в `COMPETITIVE_ANALYSIS.md`). **Десктоп:** мост без WS — см. раздел ниже.

---

## Десктоп (Tauri): мост UI ↔ Python Run (фаза 8, паттерн как у Flowise/n8n — один канал на прогон)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Один логический поток событий на исполнение (`executionId` / SSE-канал) | Подпроцесс `python -m graph_caster run`: **NDJSON в stdout/stderr**; тот же контракт, что у CLI; **`runId`** согласован с раннером |
| Остановка с хоста | **Cancel:** запись строки NDJSON в **stdin** процесса (`--control-stdin`): `{"type":"cancel_run","runId":"…"}` — см. раздел про реестр выше |
| Редактор запускает раннер локально | **Tauri 2:** `ui/src-tauri/src/run_bridge.rs` — `get_run_environment_info`, `gc_start_run`, `gc_cancel_run`; временный JSON документа (уникальное имя в `%TEMP%` / `$TMPDIR`), argv: `-d`, `--track-session`, `--control-stdin`, `--run-id`, опционально `-g`, `--artifacts-base` |
| Стрим в UI | События **`gc-run-event`** (`runId`, `line`, `stream`: stdout \| stderr), **`gc-run-exit`** (`runId`, `code`); на фронте фильтр по **`activeRunId`** |
| Консоль и полотно | `ui/src/run/*` (`useRunBridge`, `runSessionStore`, `parseRunEventLine`, `runCommands`), `ConsolePanel`, `AppShell` (Run/Stop, блокировка структуры при прогоне), подсветка ноды по `node_enter` / `node_execute` |
| Окружение | **`GC_PYTHON`**, **`GC_GRAPH_CASTER_PACKAGE_ROOT`** → `PYTHONPATH`; проверка `import graph_caster` при старте UI (кэш сессии + `invalidateRunEnvironmentInfoCache` в `runCommands.ts`) |
| Веб без Tauri | Run недоступен (без отдельного сервера); см. `ui/README.md`, `python/README.md` |

---

## Связанные артефакты run (уже было до жизненного цикла, уточнение слоя)

- Каталог run под корневым графом, событие **`run_root_ready`**, проброс **`root_run_artifact_dir`** во вложенные вызовы — `artifacts.py`, `runner.py` (см. также `DEVELOPMENT_PLAN.md` фаза 2).

---

*Обновляйте этот файл при закрытии новых пунктов из `COMPETITIVE_ANALYSIS.md`, чтобы не дублировать «сделано» в тексте про конкурентов.*
