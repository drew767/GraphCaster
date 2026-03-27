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

Статус в competitive: факты реализации **F4** (в т.ч. **`$json`**, **`$node`** (чтение **`node_outputs`**), **`branch_*`**, **`edge_traverse`**) — в **§32.1–§32.2** [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) со ссылкой сюда; ноды **`fork`**, **`merge`** (**passthrough** / **`barrier`**) — отдельный подраздел ниже. В **§32.2** список «**Открыто**» — полный **n8n Expression** runtime (JS sandbox), ИИ-ветвление (**фаза 6**), продуктовая документация, расширение контекста предикатов, **истинный параллелизм** веток (**F6**); узкие конверты **`$json`** / **`$node`** без VM — **закрыты** (таблица ниже). In-graph **`out_error`** (**F19**) закрыт здесь и отражён в **§16** / **§37** competitive без дублирования объёма реализации.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Несколько исходов из ноды, предсказуемый выбор ветки | **Инвариант «первое подходящее»:** порядок массива **`edges`** в документе; **`_evaluate_next_edge`** выбирает первое ребро с пустым **`condition`** или первое, для которого **`eval_edge_condition`** истинно; иначе **`run_end`** с **`reason`** **`no_outgoing_or_no_matching_condition`** (`runner.py`) |
| Выражения к данным шага без небезопасного eval | Подмножество **JSON Logic** в строке **`edge.condition`** (JSON-объект с одной корневой операцией); **шаблоны** **`{{path}}`** (truthiness) и **`{{path}} <op> <literal>`** (`op` ∈ `==`, `!=`, `<`, `<=`, `>`, `>=`; кавычки для строковых литералов; для **`==`/`!=`** — числовое приведение строки и числа как **`_coerce_num`**; литерал сравнения **без** многострочного «растягивания» regex); корень пути — зарезервированные **`$json`**, **`$node`** (см. «Контекст предиката») или прежние **dotted** корни (**`node_outputs`**, …); иначе legacy-литеры **`true`**/**`false`**/…; иначе не-JSON-строка без `{{` → **`bool(context["last_result"])`**. Реализация: **`graph_caster/edge_conditions.py`**, статический разбор в UI: **`edgeConditionTemplates.ts`** / предупреждения в **`branchWarnings.ts`** и **`AppShell`** (в т.ч. **`too_long`** при превышении **`MAX_EDGE_CONDITION_CHARS`**, см. `python/README.md`) |
| Контекст предиката | **`last_result`**, **`node_outputs`**, пути **`var`** через **`.`** (напр. **`node_outputs.t1.processResult.exitCode`** — для **UUID** в **id** наивный **`node_outputs.<uuid>…`** по точкам не годится); **синтетический корень** **`$json`** = **`last_result`** если **`dict`**, иначе **`{"value": last_result}`**; **синтетический корень** **`$node`** = **алиас** того же **`node_outputs`**, что уже в данных предиката (**`$node["…"]`**, **`$node['…']`**, **`$node.shortId`** — см. **`python/README.md`**). Ключи **`$json`** / **`$node`** из **`context`** при оценке перезаписываются. Полный **n8n Expression** / JS sandbox **не** используются. Скрыты только **корневые** ключи **`context`** с префиксом **`_`**; вложенные поля под **`node_outputs`** не маскируются |
| Связь с **task** | **`node_outputs[id].processResult`**: `exitCode`, `success`, `timedOut`, `cancelled`, объёмы stdout/stderr — после каждого **`process_complete`** и при **`spawn_error`** (`exitCode` **`-1`**, `python/graph_caster/process_exec.py`) |
| Статические предупреждения в UI (не заменяют раннер) | **`findBranchAmbiguities`** / **`branchWarnings`** — два безусловных исхода, дубликаты строки условия (`ui/`, **§32.1** competitive doc) |
| Событие выбранной ветки | **`edge_traverse`** (совместимость); перед ним при ветвлении — **`branch_skipped`** (`reason`: **`condition_false`**) для оценённых ложных условий, **`branch_taken`** (с **`graphId`**) если исходящих больше одного или были skip (**`runner.py`**, **`schemas/run-event.schema.json`**) |
| **`$node`** в условиях (срез n8n **`$node[…]`** без Expression VM) | Рантайм: **`python/graph_caster/edge_conditions.py`** (**`_predicate_data`**, **`_get_path`**, regex шаблонов). Паритет статического разбора в UI: **`ui/src/graph/edgeConditionTemplates.ts`**. Тесты: **`python/tests/test_edge_conditions.py`**, **`test_edge_condition_templates.py`**, **`ui/src/graph/edgeConditionTemplates.test.ts`**. Поведение и ограничения (кавычки в id и т.д.): **`python/README.md`** |

**Открыто в F4 (см. `COMPETITIVE_ANALYSIS.md` §32.2):** полноценный **n8n Expression** (произвольные функции, произвольный JS, sandbox VM) — **вне** безопасной грамматики JSON Logic + mustache + **`$json`** + ограниченного **`$node`** (только чтение из **`node_outputs`**, таблица выше). **Fan-out/join** в одном процессе (**`fork`**, **`merge`** **`barrier`**) — в таблице **Merge** ниже. Остаётся в competitive: **истинный параллелизм веток** (worker pool / **F6**), ИИ-ветвление без отдельной ноды (**фаза 6**). In-graph **`out_error`** — раздел **F19** ниже.

### Merge (`join`) — реконвергенция после ветки (MVP)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| **n8n** — отдельная нода **Merge**, несколько входов | Тип ноды **`merge`**: **`in_default`** / **`out_default`** только (**F18**); в меню полотна (ПКМ); ромб на канвасе (`ui/`) |
| **Dify** — неявное ожидание предков в **GraphEngine** | **Passthrough:** **`node_outputs[id].merge.passthrough`** при **`data.mode`** не **`barrier`**. **Barrier (`data.mode` = `barrier`):** join как у n8n **Merge** «дождаться всех» — приход с каждого предка по **`out_default`**; без успешных входов barrier не планируется. **Переход `out_error` в barrier-merge** не ставит ноду в очередь: **`error`** **`barrier_merge_error_path_not_supported`**. **`node_outputs[id].merge`**: **`barrier`**, **`arrivedFrom`**, **`passthrough`:** **`false`**. Ветки по-прежнему **последовательно** в одном процессе |
| **n8n** — несколько исходов в шину + **Merge** | Нода **`fork`** — все безусловные **`out_default`** в порядке документа в **`StepQueue`**; без OS-параллелизма (**F6** вне MVP) |
| Статика | Python: **`find_merge_incoming_warnings`**, **`find_fork_few_outputs_warnings`**, **`find_barrier_merge_out_error_incoming`**, **`find_barrier_merge_no_success_incoming_warnings`**; UI: **`merge_few_inputs`**, **`fork_few_outputs`**, **`barrier_merge_out_error_incoming`**, **`barrier_merge_no_success_incoming`** в **`findStructureIssues`**. Раннер эмитит соответствующие **`structure_warning`** в NDJSON |
| Контракт документа | `schemas/graph-document.schema.json` (описание **`type`**, **`fork`**, **`merge.data.mode`**), фикстуры **`handle-merge.json`**, **`merge-after-branch.json`**, **`fork-merge-barrier.json`**, **`handle-fork.json`** |

Код: **`python/graph_caster/runner.py`** (в т.ч. **`fork`**, **`_gc_merge_barrier`**), **`handle_contract.py`**, **`validate.py`**; тесты **`test_merge_node.py`**, **`test_merge_barrier_fork.py`**, **`test_validate_structure.py`**, **`test_handle_compatibility.py`**.

Документация: `python/README.md` (раздел «Условия на рёбрах»), `schemas/graph-document.schema.json` (`edges[].condition`). Углублённое сравнение с конкурентами — **§32** в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md).

---

## Статическая достижимость из **start** (F3, как n8n/Dify структурные проверки)

Пункт **§31.2** п.1 в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) перенесён сюда как **закрытый** срез; в competitive остаются «открытые» темы (циклы, полная рантайм-связность с симуляцией **F4**, OS-параллелизм **F6**) — см. строку **GraphCaster** в таблице F3 там же.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Предупреждение о нодах вне обхода от входа | UI: **`findUnreachableWorkflowNodeIds`** (`ui/src/graph/reachability.ts`), **`findStructureIssues`** → **`unreachable_nodes`**; жёлтая строка рядом с прочими предупреждениями (`AppShell`). **`comment`** не попадает в список |
| Все исходящие рёбра считаем возможными (без симуляции **`condition`**) | Over-approximation: directed BFS по **`edges`** |
| Run / Save | Run **не** блокируется только из‑за **`unreachable_nodes`** (**`structureIssuesBlockRun`**); критичные проблемы **`start`** по-прежнему блокируют запуск |
| Паритет с хостом / CLI | **`find_unreachable_non_comment_nodes`** в **`python/graph_caster/validate.py`**, тесты в **`tests/test_validate_structure.py`** |
| Визуальная точка **join** после ветвления (**F4**) | **`merge`** (**passthrough** / **barrier**) и **`fork`** — подраздел **Merge (`join`)** выше; BFS **F3** по-прежнему не симулирует **F4** |

---

## Статический цикл **`graph_ref`** по workspace (**F5**, §**29.2**)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| **n8n** — ограничение рекурсии **Execute Workflow** / циклические зависимости workflow | Ориентированный граф **`graphId` → targetGraphId** по всем `*.json` в **`graphs/`**; DFS с окраской; первый найденный цикл канонизируется лексикографически минимальной ротацией (покомпонентное сравнение строк, как **`tuple`** в Python) |
| **Dify** — отсутствие бесконечной вложенности child graph без валидного разрешения | **Python:** `build_workspace_graph_ref_adjacency`, `find_workspace_graph_ref_cycle`; **`run -g`**: при цикле — stderr + exit **3** до **`run_started`**. **UI:** поле **`refTargets`** в записи индекса (`scanWorkspaceGraphs`), **`workspaceGraphRefCycleIssues`** → **`graph_ref_workspace_cycle`** в **`structureIssuesBlockRun`** (как критичные проблемы **`start`**) |
| Один проход по диску без повторного чтения JSON | Индекс документов: **`load_graph_documents_index`** (`workspace.py`); **`scan_graphs_directory`** возвращает только **`graphId` → Path** из того же прохода; смежность для цикла строится из уже распарсенных **`GraphDocument`** |
| Дубликат **`graphId`** в двух файлах | **Python:** **`WorkspaceIndexError`** при скане индекса. **UI:** дубликат помечается в индексе; при поиске цикла учитывается **первая** запись по порядку списка (согласовано с сортировкой по **`fileName`** в **`scanWorkspaceGraphs`**) |
| Паритет TS/Python | Тесты: **`python/tests/test_graph_ref_workspace_cycles.py`**, **`python/tests/test_cli_main.py`** (цикл); **`ui/src/graph/workspaceGraphRefCycles.test.ts`**, **`ui/src/graph/structureWarnings.test.ts`** |

---

## Статическая совместимость ручек **F18** (n8n connection types / Langflow `validate_edge`)

Сравнение с **ComfyUI / Dify / Flowise / Langflow / n8n** по моделям портов и таблицы конкурентов — **§15** в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md); здесь только **факт реализации** GraphCaster.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Жёсткая проверка пинов до исполнения | **`validate_graph_structure`** вызывает **`find_handle_compatibility_violations`** (`python/graph_caster/handle_contract.py`); первая ошибка → **`GraphStructureError`** |
| Мягкое предупреждение в редакторе | UI: **`findHandleCompatibilityIssues`** (`ui/src/graph/handleCompatibility.ts`), контракт пинов **`handleContract.ts`**, жёлтая полоса в **`AppShell`** (не входит в **`structureIssuesBlockRun`**) |
| Паритет TS/Python | Фикстуры **`schemas/test-fixtures/handle-*.json`**; тесты **`python/tests/test_handle_compatibility.py`**, **`ui/src/graph/handleCompatibility.test.ts`** |

**Правила (MVP):** **`start`** — только **`out_default`**; **`exit`** — только **`in_default`**, без исходящих как источник; **`task`** / **`graph_ref`** — **`out_default`** \| **`out_error`** в исход, **`in_default`** в приём; **`merge`** — только **`in_default`** / **`out_default`**; **`comment`** — рёбра к комментарию не проверяются.

**Неизвестный `node.type`:** в TS и Python трактуется как исполняемая нода с теми же пинами, что **`task`** (исход **`out_default`** \| **`out_error`**, вход **`in_default`**), пока нет отдельного контракта типа.

**Дубликаты `nodes[].id`:** индекс **id → нода** в проверке ручек — последняя нода с таким **id**; отдельная валидация уникальности **id** в документе не входит в F18.

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
| Завершение с явным статусом | **`run_finished`**: `status` (`success` \| `failed` \| `cancelled` \| **`partial`**), **`finishedAt`**; всегда последнее событие корневого кадра (`try`/`finally`); **`partial`** — ранний stop по **`--until-node`** / **`GraphRunner(..., stop_after_node_id=…)`** |
| Нормализация пустого / невалидного `run_id` из контекста | Пустое / `None` / пробелы → новый UUID; см. `_normalize_run_id_candidate` в `runner.py` |
| Ограничение размера `mode` в потоке | Обрезка до 128 символов |

Контракт: `schemas/run-event.schema.json`. Код: `python/graph_caster/runner.py` (`_event_sink.emit`, `run_from`, вложенный `GraphRunner(..., run_id=…)`).

**Намеренно не перенесено** (см. обсуждение в `COMPETITIVE_ANALYSIS.md` §3.2.1–§3.2.4): `ExecutionPushMessage` целиком, `pushRef`, WebSocket/SSE, redaction / `flattedRunData`, relay кадров.

### Слой события → транспорт и очередь шагов (срез **F6**, без worker pool)

Сравнение продуктов по очередям прогонов, режимам **n8n** `queue`, **Dify**/**Comfy** и планирование межпрогонового параллелизма / моста (**§13.2–§13.3**) — в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) §**13**; ниже только то, что уже в коде **graph-caster**.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| **Langflow** — `EventManager.send_event` → буфер → выдача в HTTP | **`RunEventSink`** (`python/graph_caster/run_event_sink.py`): **`emit(event: RunEventDict)`**; CLI — **`NdjsonStdoutSink(write, flush)`**; обратная совместимость: **`Callable[[RunEventDict], None]`** → **`CallableRunEventSink`**; **`RunEventDict`** экспортируется из **`graph_caster`** |
| **Dify** — готовые к выполнению узлы в очереди движка (концепция) | **`StepQueue`** + **`ExecutionFrame(node_id)`** (`step_queue.py`): синхронный FIFO, один поток; следующая нода ставится после **`_follow_edges_from`**; отмена опрашивается в начале каждой итерации |
| **Comfy** — раздельные очереди исполнения и WebSocket | В GC одна цепочка: очередь визитов → события только через sink (расширение «буфер до медленного клиента» — **§39** / мост Aura) |

Тесты: `python/tests/test_run_event_sink.py`, `test_step_queue.py`, `test_runner_event_order_golden.py` (порядок `type` на `graph-document.example.json`).

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

**Сопоставление с §3.2 competitive doc (Dify / n8n):** срез **«команда abort / адресация исполнения по id»** сведён сюда (`CommandChannel` у Dify — полноценный pause/redis; у GC пока in-process + stdin). **`IRunExecutionData` / `executionId`** у n8n — частичный параллель: реестр **`RunSessionRegistry`** и стабильный **`runId`** на событиях; **без** очереди ready-nodes. В **веб-режиме (dev)** поток событий идёт через локальный SSE-брокер (**«Веб без Tauri»** ниже), не через единый n8n-канал **`/push`** + сессионный **`pushRef`**, redaction и relay — это остаётся в **§39** `COMPETITIVE_ANALYSIS.md`. **Десктоп:** мост без WS — см. раздел ниже.

---

## Десктоп (Tauri): мост UI ↔ Python Run (фаза 8, паттерн как у Flowise/n8n — один канал на прогон)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Один логический поток событий на исполнение (`executionId` / SSE-канал) | Подпроцесс `python -m graph_caster run`: **NDJSON в stdout/stderr**; тот же контракт, что у CLI; **`runId`** согласован с раннером |
| Остановка с хоста | **Cancel:** запись строки NDJSON в **stdin** процесса (`--control-stdin`): `{"type":"cancel_run","runId":"…"}` — см. раздел про реестр выше |
| Редактор запускает раннер локально | **Tauri 2:** `ui/src-tauri/src/run_bridge.rs` — `get_run_environment_info`, `gc_start_run`, `gc_cancel_run`, **`gc_list_persisted_runs`**, **`gc_read_persisted_events`**, **`gc_read_persisted_run_summary`**; временный JSON документа (уникальное имя в `%TEMP%` / `$TMPDIR`), argv: `-d`, `--track-session`, `--control-stdin`, `--run-id`, опционально `-g`, `--artifacts-base`, **`--no-persist-run-events`**, **`--until-node`**, **`--context-json`** |
| Стрим в UI | События **`gc-run-event`** (`runId`, `line`, `stream`: stdout \| stderr), **`gc-run-exit`** (`runId`, `code`); на фронте фильтр по **`activeRunId`** |
| Консоль и полотно | `ui/src/run/*` (`useRunBridge`, `runSessionStore`, `parseRunEventLine`, `runCommands`), `ConsolePanel`, `AppShell` (Run/Stop, блокировка структуры при прогоне), подсветка ноды по `node_enter` / `node_execute` |
| Окружение | **`GC_PYTHON`**, **`GC_GRAPH_CASTER_PACKAGE_ROOT`** → `PYTHONPATH`; проверка `import graph_caster` при старте UI (кэш сессии + `invalidateRunEnvironmentInfoCache` в `runCommands.ts`) |
| Веб без Tauri | **`python -m graph_caster serve`** (опц. **`[broker]`**): **Flowise/n8n-стиль** — **SSE** `text/event-stream`, один канал на **`runId`**; Vite **`/gc-run-broker`** → брокер; UI: `webRunBroker.ts`, `runCommands.ts`, прокси в `vite.config.ts`; опц. **`GC_RUN_BROKER_TOKEN`** / **`VITE_GC_RUN_BROKER_TOKEN`** (заголовок и **`?token=`** для **`EventSource`**); Python: `graph_caster/run_broker/`; см. `ui/README.md`, `python/README.md`; тесты: `python/tests/test_run_broker.py`, `test_run_broker_registry.py` |

### Частичный прогон (Dify debugger / n8n pinned data — срез)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Остановиться после выбранной ноды без обязательного **`exit`** | **`GraphRunner.stop_after_node_id`**; CLI **`--until-node`** (всегда от документного **`start`**); **`run_finished.status`** **`partial`** |
| Старт с середины с подмешанными выходами предков | Уже было: **`run` / `run_from`** + **`--start`**; плюс **`--context-json`** (ключ **`node_outputs`**) для пинов контекста; предупреждение в stderr при mid-**`--start`** без **`--context-json`** |
| Десктоп | **`StartRunRequest.untilNodeId`** / **`contextJsonPath`** → argv в **`run_bridge.rs`**; кнопка инспектора **«Запуск до этой ноды»** (`AppShell`, i18n) |
| **`--until-node` / `stop_after_node_id` только по id корневого документа** | Вложенный **`graph_ref`** выполняется **целиком** (дочерний **`GraphRunner(..., stop_after_node_id=None)`**); остановка «на ноде внутри вложенного JSON» одним id корня **не** задаётся |
| Целевая нода **не на активном пути** (ветки, условия) или **ошибка раньше** | **`run_finished.status`** **`failed`**, не **`partial`** |
| **`until`** указывает на ноду типа **`exit`** | **`success`** (нормальное завершение графа), не **`partial`** — см. `test_stop_after_exit_node_is_success_not_partial` |
| Остановка на **`comment`** (и др. «пустых» по исполнению) | Узел всё равно посещается; при совпадении **`id`** — **`partial`** |

**Связь с F17:** отладочный partial — в таблице выше; закрепление вывода в документе (**`gcPin`**) — подраздел ниже; межпрогонный кэш выходов **`task`** (headless) — ещё ниже.

Код: `python/graph_caster/runner.py`, `__main__.py`; тесты: `python/tests/test_runner_partial.py`, `test_cli_main.py`; фикстура `schemas/test-fixtures/partial-run-linear.json`.

### Закреплённый вывод в документе (**`gcPin`**, n8n **pinData**)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| n8n **pinData** / pinned output в JSON workflow | В **`task.data`**: **`gcPin.enabled`**, **`gcPin.payload`**; **`apply_gc_pins_to_document_context`** копирует **`payload`** в **`node_outputs[id]`** до шага, **только если** **`id`** ещё не задан в контексте (значение из **`--context-json` / внешнего контекста не перезаписывается**). На визите ноды прошлые ключи выхода (**`processResult`**, …) сливаются с оболочкой **`nodeType`/`data`** |
| Пропуск исполнения при валидном pin | В документе **`enabled`** и **`payload.processResult`** — объект **и** после слияния в **`node_outputs[id]`** **`processResult`** — **непустой** объект; тогда **`node_pinned_skip`**, без **`run_task_process`** и без F17 для этой ноды; иначе обычный запуск. **`node_exit`** может нести **`usedPin: true`**. Пустой **`processResult`** **`{}`** или его отсутствие после мержа — без short-circuit |
| Снимок для редактора | После реального прогона (или после cache hit F17): **`node_outputs_snapshot`** — усечённый срез **`node_outputs[id]`** (длинные stdout/stderr в **`processResult`**) |
| Десктоп UI | Инспектор: вкладка управления pin, «из последнего запуска», снятие pin; маркер на ноде; NDJSON → **`runSessionStore.nodeOutputSnapshots`** |
| Статика / UX | **`structure_warning`** **`gc_pin_enabled_empty_payload`**; в инспекторе предупреждение, если JSON **`payload`** > ~256 KiB |

Код: `python/graph_caster/gc_pin.py`, `runner.py`; `schemas/graph-document.schema.json` (описание **`gcPin`**, версия заголовка **v1.5**), `schemas/run-event.schema.json`; `ui/src/components/InspectorPanel.tsx`, `nodes/GcFlowNode.tsx`, `run/runSessionStore.ts`, `run/useRunBridge.ts`; тесты **`test_runner_pins.py`**, фикстура **`schemas/test-fixtures/task-with-gcpin.json`**.

### Вложенный **`graph_ref`** и **`--step-cache-dirty`** (паритет n8n sub-workflow / Comfy subgraph)

Очередь **`--step-cache-dirty`** на **корневом графе** (и на активном документе) пополняется транзитивно по DAG **успешных** рёбер (как предки в ключе F17 в **`runner.py`**); правки **`condition`** / новое ребро (seed **`source`**); типы нод с триггером при **`onApplyNodeData`** — см. таблицу F17 ниже (**`dirtyNodeNames`** у n8n).

**Поведение при родительском `graph_ref`:** открытие целевого графа из инспектора ведёт стек **`parentWorkspaceFileName` + `graphRefNodeId`** (кадр добавляется **только** после успешной загрузки JSON; при ошибке чтения/парса стек не засоряется). При пометке **dirty** (данные ноды, ребро, кнопка «Mark dirty») дочерний документ помечается как обычно, плюс **bubble**: последовательная цепочка `Promise`, снимок стека на момент пометки, с диска читаются родительские JSON и для каждого **`graph_ref`** на пути вызывается **`markStepCacheDirtyTransitive`**. В **`runner.py`** во вложенном прогоне задаётся **`_parent_graph_ref_node_id`**; **`task`** с F17 получает **`node_cache_miss` / `reason: dirty`**, если **`dirty_nodes`** содержит **id родительской ноды `graph_ref`** (нет ложных совпадений id между разными файлами). *Ограничение:* bubble опирается на содержимое файлов воркспейса на диске.

Код/UI: `ui/src/run/nestedStepCacheDirtyBubble.ts`, `AppShell.tsx`, `InspectorPanel.tsx`; `python/graph_caster/runner.py` (**`_execute_graph_ref`**). Тесты: **`test_step_cache_dirty_parent_graph_ref_forces_nested_miss`** в `test_runner_step_cache.py`, Vitest **`nestedStepCacheDirtyBubble.test.ts`**.

**Открытые темы F17** (не вложенность): кэш не-**`task`**, TTL, отдельный тоггл step-cache на полотне — [COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) §22.2.

### Межпрогонный кэш выходов **`task`** (F17 — ключ в духе Comfy + **dirty** в духе n8n)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Comfy: стабильная сигнатура входов + состояние графа | **`graph_document_revision(doc)`** — SHA-256 канонического снимка документа (ноды, рёбра, **`data`**); участвует в **`compute_step_cache_key`** вместе с **`graphId`**, id ноды, **`node_data_for_cache_key`** (без флага **`stepCache`**) и **`upstream_outputs_fingerprint`** (SHA-256 от **`normalize_outputs_for_cache_key`** среза **`node_outputs`** предков по входам не из **`out_error`**) — без встраивания полного среза в JSON ключа |
| n8n: принудительное перевыполнение выбранных нод | **`StepCachePolicy.dirty_nodes`**; CLI **`--step-cache-dirty`**; событие **`node_cache_miss`** с **`reason: dirty`** |
| n8n: **`dirtyNodeNames`** / транзитивная инвалидация при partial | **Десктоп:** по успешным рёбрам (не **`out_error`**), как предки в ключе F17 в **`runner.py`**; в очередь попадают только **`task`** с **`data.stepCache`** truthy; кнопка «Mark dirty» берёт граф с канваса (**`exportDocument`**); **`onApplyNodeData`** вызывает замыкание только для исполняемых типов (не **`comment`**); смена **`condition`** ребра и новое ребро — seed **`source`**; лог консоли: дельта **`+N`** и полная очередь; открытие вложенного графа по **`graph_ref`** накапливает стек для **bubble** **dirty** на предков (файлы воркспейса с диска) |
| Персистентность | **`StepCacheStore`** под **`artifacts_base`**: **`runs/<graphId>/step-cache/v1/<shard>/<key>.json`**; опция **`context["tenant_id"]`** — опциональный суффикс ключа |
| Чтение с диска | **`StepCacheStore.get`** возвращает запись только если **`nodeType`** — строка **`task`**, **`data`** — объект, в **`processResult`** есть ключ **`success`**; иначе **`None`** (промах) |
| Узел участвует только явно | Поле **`data.stepCache`** truthy у ноды **`task`**; без флага при включённой политике кэш-событий нет |
| Наблюдаемость | **`node_cache_hit`**, **`node_cache_miss`** в **`schemas/run-event.schema.json`** (**`keyPrefix`** — 16 hex, без полного ключа в потоке) |
| **Десктоп (Tauri):** явный **`--step-cache`** / **`--step-cache-dirty`** как у n8n **`dirtyNodeNames`** | Панель **Run**: чекбокс «Step cache» (требует непустой корень воркспейса = **`--artifacts-base`**); бейдж — число id в очереди **dirty**. Очередь **dirty** очищается после **успешного** старта run (нет исключения **`invoke`**); **`--step-cache`** в Rust не добавляется без непустого **`artifacts_base`**. Пустой путь артефактов сбрасывает чекбокс Step cache. **`InspectorPanel`** для **`task`**: **`data.stepCache`**, кнопка «Mark dirty for next run» (транзитивно). **`run_bridge.rs`** → **`gcStartRun`** (`run/runCommands.ts`). Состояние очереди: **`run/stepCacheDirtyStore.ts`** (**`markStepCacheDirtyTransitive`**); граф — **`graph/stepCacheDirtyGraph.ts`**; на ноде — бейдж **`C`** в **`GcFlowNode`**. Локальное сохранение намерения кэша: **`localStorage`** **`gc.run.stepCacheEnabled`** |

Код: `python/graph_caster/document_revision.py`, `node_output_cache.py`, `runner.py`, `__main__.py`; `ui/src-tauri/src/run_bridge.rs`, `ui/src/run/runCommands.ts`, `ui/src/run/stepCacheDirtyStore.ts`, `ui/src/run/nestedStepCacheDirtyBubble.ts`, `ui/src/graph/stepCacheDirtyGraph.ts`, `ui/src/layout/AppShell.tsx`, `ui/src/components/TopBar.tsx`, `ui/src/components/InspectorPanel.tsx`, `ui/src/components/nodes/GcFlowNode.tsx`. Тесты: `test_document_revision.py`, `test_node_output_cache.py`, `test_runner_step_cache.py` (в т.ч. вложенный **`graph_ref`** + **dirty** родителя), `test_run_event_schema.py`, `test_cli_main.py`; Vitest **`stepCacheDirtyGraph.test.ts`**, **`stepCacheDirtyStore.test.ts`**, **`nestedStepCacheDirtyBubble.test.ts`**. Документация CLI: `python/README.md`.

Политика **dirty** в UI: id попадают в **`--step-cache-dirty`** при следующем успешном **`invoke` `gc_start_run`** (процесс Python стартовал); при ошибке старта список **не** очищается. Идентификаторы нод не должны содержать **`,`** (формат CSV в CLI).

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

## Персистентный журнал прогона / execution history (file-first, срез **F13**)

Сравнение с n8n **`executionId`** / Dify persisted run / Flowise **`Execution`** — в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) **§17**; здесь только реализация GC.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Список прошлых прогонов и просмотр логов без live-run | При **`--artifacts-base`**: **`events.ndjson`** (все события NDJSON, включая **`run_root_ready`**) и **`run-summary.json`** (**`schemaVersion`**: 1, **`runId`**, **`status`**, таймстампы); отключение: **`--no-persist-run-events`** |
| Тот же поток, что в stdout, не терять при сбое диска на вторичном приёмнике | **`TeeRunEventSink`**: сначала основной sink; **`OSError`** на файловой ветке не рвёт прогон после успешного stdout |
| Хост читает файлы без path-escape | Tauri: **`canonicalize`** + проверка префикса **`runs/<graphId>/`**; чтение с потолком размера (**16 MiB** для хвоста **`events`**) |
| Веб (dev) и десктоп | Брокер **`POST /persisted-runs/list`**, **`events`** (ответ **`text`**, **`truncated`**; **`maxBytes`** ≤ **16 MiB**), **`summary`**; UI модалка **History**, replay в консоль (offline), i18n при **`truncated`** |

Код: `run_event_sink.py`, `artifacts.py`, `runner.py`, `run_broker/app.py`, `run_bridge.rs`, `RunHistoryModal.tsx`, `run/runCommands.ts`, `webRunBroker.ts`. Сводка жизненного цикла артефактов рана — подраздел «Связанные артефакты run» ниже.

---

## Поиск и переход к ноде на canvas (n8n «Add node» palette / Langflow поиск компонентов)

Снятие пункта «поиск ноды на полотне» из **открытого** плана в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) **§28.2** (п.4 «Мини-карта / навигация»): факт реализации только здесь, без дублирования таблиц в competitive.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Быстрый поиск по графу, стрелки + Enter, без правки документа | **`NodeSearchPalette`** (`ui/src/components/NodeSearchPalette.tsx`): оверлей, поле фильтра, до 200 строк + подсказка об усечении; **↑/↓**, **Enter**, **Escape** |
| Горячие клавиши | **Ctrl+F** / **Ctrl+K** (глобально, если фокус не в поле ввода); во время **Run** не блокируется (навигация и выбор ноды, как из консоли) |
| Меню | **Вид → Найти ноду…** (`TopBar`, i18n `app.canvas.findNode*`) |
| Индекс по документу | **`buildCanvasNodeSearchRows`** / **`filterCanvasNodeSearchRows`** (`ui/src/graph/canvasNodeSearch.ts`): **id**, **type**, **`nodeLabel`**, для **`graph_ref`** — **`graphId`** и **`targetGraphId`** |
| Фокус на полотне | Тот же путь, что клик по ноде из консоли: **`setSelection`** + **`GraphCanvasHandle.focusNode`** (`AppShell` / **`onConsoleNavigateToNode`**) |

Код: `ui/src/graph/canvasNodeSearch.ts`, **`canvasNodeSearch.test.ts`** (Vitest), `ui/src/styles/app.css` (`.gc-node-search*`), локали **en/ru**.

---

## Мультивыбор, буфер обмена и групповое удаление (Langflow / Flowise / n8n-style canvas)

Выбор эталона: жесты **React Flow** (рамка, **Shift** для добавления к выбору), как у **Langflow** / **Flowise**; обмен фрагментом графа — **явный JSON** в системном буфере (не HTML), чтобы вставка не зависела от сторонних форматов.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Рамка и **Shift** на полотне | **`GraphCanvas`**: **`selectionOnDrag`**, **`multiSelectionKeyCode="Shift"`**, **`panOnDrag={[1, 2]}`**; **`onSelectionChange`** → выбор **`node`**, **`multiNode`** (≥2 нод) или **`edge`** |
| Копирование подграфа | **`buildClipboardPayload`** (`ui/src/graph/clipboard.ts`): ноды из множества **`id`**, рёбра только с обоими концами в множестве; тип **`start`** из копируемого набора **исключается** |
| Вставка с новыми идентификаторами | **`mergePastedSubgraph`**: **`newGraphNodeId`** / **`newGraphEdgeId`**, сдвиг **`position`**, **`parentId`** только если родитель вставлен; второй **`start`** **не** добавляется, если в базовом документе уже есть **`start`** |
| Горячие клавиши | **`AppShell`**: **Ctrl+C** / **Ctrl+V** (и **Cmd** на macOS); не срабатывают в полях ввода (**`isTextEditingTarget`**) и при открытой палитре «Найти ноду»; **Ctrl+V** при активном **Run** отключена |
| Групповое удаление | **Delete/Backspace** в **React Flow** для выбранных нод. В инспекторе для **`multiNode`** — **«Удалить выбранные»** → **`GraphCanvasHandle.removeNodesById`**: **`start`** в переданных **id** **пропускается** |
| Нода **`start`** не удаляется с полотна | **`graphDocumentToFlow`**: **`deletable: false`** для типа **`start`**; **`onBeforeDelete`** в **`GraphCanvas`** дополнительно снимает **`start`** из удаляемого набора |
| История при вставке | **`AppShell`**: **`commitHistorySnapshot`** **только если** после **`mergePastedSubgraph`** появились новые **`node id`** (пустая вставка не добавляет шаг **undo**) |
| Устойчивость буфера при вставке | **`mergePastedSubgraph`**: дубликаты **`id`** среди вставляемых нод → вставка отменяется (возврат исходного документа); ребро без ремапа концов в новые **id** **не** добавляется |
| Тесты | **`ui/src/graph/clipboard.test.ts`**, в **`fromReactFlow.test.ts`** — **`deletable`** для **`start`** / **`task`** |

Код: `ui/src/graph/clipboard.ts`, `ui/src/graph/toReactFlow.ts`, `ui/src/components/GraphCanvas.tsx`, `ui/src/layout/AppShell.tsx`, `ui/src/components/InspectorPanel.tsx`, i18n **`app.inspector.*`** (**multiHint**, **clipboardCopyFailed**, **clipboardInvalid**).

---

## CI в монорепозитории Aura (PR-гейт для субмодуля)

Рабочий код GraphCaster живёт в **`third_party/graph-caster/`** внутри корня **Aura**; автоматический прогон тестов и сборки UI настроен **в родительском репо**, не в изолированном клоне только graph-caster.

| Идея (как у конкурентов) | Реализация |
|--------------------------|------------|
| Регрессия контракта и UI при merge в основную ветку | **`.github/workflows/graph-caster-ci.yml`** в корне **Aura**: **push**/**pull_request** на **`main`**, если diff затрагивает **`third_party/graph-caster/**`** или сам workflow |
| Python | **Ubuntu**, **Python 3.11**, **`pip install -e ".[dev]"`**, **`pytest -q`** (cwd **`third_party/graph-caster/python`**) |
| UI | **Node 20.19**, **`npm ci`**, **`npm test`**, **`npm run build`** (cwd **`third_party/graph-caster/ui`**) — см. **`engines`** в **`ui/package.json`** |
| Каталог тестов / как запускать локально | **`docs/AUTOTESTS_CATALOG.md`** §**4.3** в монорепо **Aura** |

Детали политики путей и десктопного workflow — **`doc/DEVELOPMENT_PLAN.md`** (блок **P2 — CI**).

---

## Связанные артефакты run (уже было до жизненного цикла, уточнение слоя)

- Каталог run под корневым графом, событие **`run_root_ready`**, проброс **`root_run_artifact_dir`** во вложенные вызовы — `artifacts.py`, `runner.py` (см. также `DEVELOPMENT_PLAN.md` фаза 2).
- **Персистентный журнал** на диске ( **`events.ndjson`**, **`run-summary.json`**, **`GraphRunner(..., persist_run_events=True)`** ) — полная таблица и пути в разделе **«Персистентный журнал прогона / execution history»** выше.

---

*Обновляйте этот файл при закрытии новых пунктов из `COMPETITIVE_ANALYSIS.md`, чтобы не дублировать «сделано» в тексте про конкурентов. Завершённые планы в `doc/plans/` удаляйте (оставляйте только `.gitkeep`).*
