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

## Экспорт и целостность связей (P2 `sanitizeGraphConnectivity`)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Не терять «немые» изменения графа без сигнала (n8n/Dify/Langflow — валидация/ошибки связей) | **`sanitizeGraphConnectivity`** (`ui/src/graph/sanitize.ts`): фильтр рёбер по существующим **`source`/`target`**; результат **`{ document, removedEdgeIds }`**; **`removedEdgeIds`** без дубликатов (стабильный порядок) |
| Прозрачность для пользователя | **`onExportRemovedDanglingEdges`** в **`GraphCanvas`**, строка в блоке предупреждений **`AppShell`** + **`app.editor.removedDanglingEdges`** (en/ru); сброс при **New/Open/undo/redo** и при **`onFlowStructureChange`** до экспорта |
| Без ложных баннеров на внутренних экспортах | **`exportDocument(options?: ExportDocumentOptions)`**: **`notifyRemovedDanglingEdges`** (по умолчанию **true**); в **`AppShell`** уведомление отключено для снимков истории, **undo/redo**, захвата/фиксации **drag**, **автосохранения** и **`getDocument`** в модалке сохранения (чтобы не дублировать предупреждение после открытия модалки) |

Рантайм Python не меняется: несогласованный JSON с диска по-прежнему обрабатывается при загрузке в модель отдельно.

---

## Условные рёбра / F4 (n8n IF/Switch, Dify variable-based branch) — конспект **§32**

Статус в competitive: закрытые пункты **§32.2** по **`branch_*`** и **`edge_traverse`** сведены в таблицу ниже; в **`COMPETITIVE_ANALYSIS.md`** (**§32.2**, «Открыто») остаются fork/join, ИИ-ветвление, продуктовая документация и контекст предикатов. In-graph **`out_error`** (**F19**) закрыт здесь и отражён в **§16** / **§37** competitive без дублирования объёма реализации.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Несколько исходов из ноды, предсказуемый выбор ветки | **Инвариант «первое подходящее»:** порядок массива **`edges`** в документе; **`_evaluate_next_edge`** выбирает первое ребро с пустым **`condition`** или первое, для которого **`eval_edge_condition`** истинно; иначе **`run_end`** с **`reason`** **`no_outgoing_or_no_matching_condition`** (`runner.py`) |
| Выражения к данным шага без небезопасного eval | Подмножество **JSON Logic** в строке **`edge.condition`** (JSON-объект с одной корневой операцией); иначе legacy-литеры **`true`**/**`false`**/…; иначе не-JSON-строка → **`bool(context["last_result"])`**. Реализация: **`graph_caster/edge_conditions.py`** (`MAX_EDGE_CONDITION_CHARS`, truthiness GC — см. `python/README.md`) |
| Контекст предиката | **`last_result`**, **`node_outputs`**, пути **`var`** через **`.`** (напр. **`node_outputs.t1.processResult.exitCode`**). Скрыты только **корневые** ключи **`context`** с префиксом **`_`**; вложенные поля под **`node_outputs`** не маскируются |
| Связь с **task** | **`node_outputs[id].processResult`**: `exitCode`, `success`, `timedOut`, `cancelled`, объёмы stdout/stderr — после каждого **`process_complete`** и при **`spawn_error`** (`exitCode` **`-1`**, `python/graph_caster/process_exec.py`) |
| Статические предупреждения в UI (не заменяют раннер) | **`findBranchAmbiguities`** / **`branchWarnings`** — два безусловных исхода, дубликаты строки условия (`ui/`, **§32.1** competitive doc) |
| Событие выбранной ветки | **`edge_traverse`** (совместимость); перед ним при ветвлении — **`branch_skipped`** (`reason`: **`condition_false`**) для оценённых ложных условий, **`branch_taken`** (с **`graphId`**) если исходящих больше одного или были skip (**`runner.py`**, **`schemas/run-event.schema.json`**) |

**Открыто в F4 (см. `COMPETITIVE_ANALYSIS.md`):** выражения уровня **n8n** (`{{$json…}}`), **fork/join** как у **n8n merge**, ИИ-ветвление без отдельной ноды (**фаза 6**). In-graph **`out_error`** после сбоя **`task`** / **`graph_ref`** — раздел **F19** ниже (в competitive больше не помечается как «нет в документе»).

Документация: `python/README.md` (раздел «Условия на рёбрах»), `schemas/graph-document.schema.json` (`edges[].condition`). Углублённое сравнение с конкурентами — **§32** в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md).

---

## Статическая достижимость из **start** (F3, как n8n/Dify структурные проверки)

Пункт **§31.2** п.1 в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) перенесён сюда как **закрытый** срез; в competitive остаётся только ссылка и «открытые» темы (циклы, fork/join, связность с учётом **F4**).

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Предупреждение о нодах вне обхода от входа | UI: **`findUnreachableWorkflowNodeIds`** (`ui/src/graph/reachability.ts`), **`findStructureIssues`** → **`unreachable_nodes`**; жёлтая строка рядом с прочими предупреждениями (`AppShell`). **`comment`** не попадает в список |
| Все исходящие рёбра считаем возможными (без симуляции **`condition`**) | Over-approximation: directed BFS по **`edges`** |
| Run / Save | Run **не** блокируется только из‑за **`unreachable_nodes`** (**`structureIssuesBlockRun`**); критичные проблемы **`start`** по-прежнему блокируют запуск |
| Паритет с хостом / CLI | **`find_unreachable_non_comment_nodes`** в **`python/graph_caster/validate.py`**, тесты в **`tests/test_validate_structure.py`** |

---

## Ветка после ошибки **F19** (`out_error`, конспект **§16** / **§37**)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| **Dify** `FAIL_BRANCH` — альтернативный переход в том же графе без отдельного error-workflow | Исход **`sourceHandle` / `source_handle` = `out_error`**: учитывается **только** после неуспеха **`task`** (после ретраев) или **`graph_ref`**; успешный путь — рёбра **не** с `out_error` |
| **n8n** `continueOnFail` / error-workflow (отдельный workflow) | Отдельный error-workflow **не** дублируется (file-first, **§16.2**); in-graph восхождение — через **`out_error`** |
| События | `branch_taken` / `edge_traverse` с опциональным **`route":"error"`**; схема **`schemas/run-event.schema.json`**. После неуспеха **`graph_ref`** возможны события **`error`** (включая вложенный прогон), затем при наличии **`out_error`** — обход восстановления и **`run_finished`** со статусом **`success`** |
| Отмена | **`out_error`** **не** используется при **`_gc_process_cancelled`** / **`_run_cancelled`** |
| Предупреждения / валидация | Статически: **`find_unreachable_out_error_sources`** (`validate.py`) и то же правило в UI (**`branchWarnings`**) — рёбра **`out_error`** с **`start`**, **`comment`**, **`exit`**, **`task`** без **`command`/`argv`** |
| UI | Второй source **`Handle`** `out_error` у **`task`** и **`graph_ref`**; предупреждения ветвления раздельно для success / error fan-out (`branchWarnings.ts`) |

Код: `python/graph_caster/runner.py` (`EDGE_SOURCE_OUT_ERROR`, `_edges_from_source`, `_follow_edges_from`), `python/graph_caster/validate.py` (`find_unreachable_out_error_sources`); тесты `python/tests/test_runner_fail_branch.py`, `python/tests/test_validate_structure.py`.

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

## Консоль наблюдаемости (**F13**, фаза 7)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| n8n / Dify: фильтрация и фокус на проблемных строках в ленте execution | Режимы **все / stderr / ошибки**; эвристика **`isErrorLike`**: stderr-префикс, события **`error`**, **`run_finished`** с **`status`** **`failed`**, **`process_complete`** с **`success: false`** или **`reason`** **`spawn_error`**, **`run_end`** с **`reason`** **`no_outgoing_or_no_matching_condition`**, подстроки **`"status":"failed"`** / **`"status": "failed"`** в **сырой** строке (в т.ч. в тексте хоста — намеренно грубо для dev-консоли) |
| Langflow: поиск по буферу | Поле поиска (substring, без учёта регистра) по полному буферу, пересечение с активным фильтром |
| Чтение середины лога без «срыва» вниз при новых событиях | **Sticky tail:** автопрокрутка в конец, если пользователь у низа (**в т.ч. после смены фильтра или поиска**); кнопка **Latest** / **В конец** снова приклеивает хвост |
| Переход к ноде из события | Клик (или Enter/Space) по строке с **`nodeId`**; для **`branch_taken`** / **`branch_skipped`** берётся **`fromNode`** как источник фокуса; **`aria-label`** и **`aria-pressed`** у фильтров; к выбору в инспекторе и **`fitView`** на ноду (`GraphCanvasHandle.focusNode`) |
| Экспорт | **Export** сохраняет **видимые** строки (после фильтра и поиска); **Export all** / **Весь лог** — полный буфер, когда включён фильтр или непустой поиск |
| Тесты | `ui/src/run/consoleLineMeta.test.ts` (Vitest) |

Код: `ui/src/run/consoleLineMeta.ts`, `ui/src/components/ConsolePanel.tsx`, `ui/src/components/GraphCanvas.tsx`, `ui/src/layout/AppShell.tsx`, стили консоли в `ui/src/styles/app.css`, i18n `app.console.*`.

---

## Связанные артефакты run (уже было до жизненного цикла, уточнение слоя)

- Каталог run под корневым графом, событие **`run_root_ready`**, проброс **`root_run_artifact_dir`** во вложенные вызовы — `artifacts.py`, `runner.py` (см. также `DEVELOPMENT_PLAN.md` фаза 2).

---

*Обновляйте этот файл при закрытии новых пунктов из `COMPETITIVE_ANALYSIS.md`, чтобы не дублировать «сделано» в тексте про конкурентов. Завершённые планы в `doc/plans/` удаляйте (оставляйте только `.gitkeep`).*
