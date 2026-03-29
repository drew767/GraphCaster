# GraphCaster — implemented features (from competitive mapping)

Краткий реестр возможностей, которые перенесены с эталонов (n8n, Dify и др.) в код или контракт GC. Подробный конкурентный разбор остаётся в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md); здесь только **факт реализации** и пути в репозитории.

---

## Host vs run state vs document (n8n `IWorkflowExecuteAdditionalData`)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Документ графа отдельно от инфраструктуры запуска | JSON графа → `GraphDocument` / схема `graph-document.schema.json` |
| Пути workspace, артефакты, индекс `graphs/` — не в «логике ноды» | `RunHostContext` (`python/graph_caster/host_context.py`): `graphs_root`, опционально `workspace_root` (иначе `resolved_workspace_root()` = родитель `graphs_root`), `artifacts_base`; передаётся в `GraphRunner(..., host=…)` |
| Словарь прогона без подмешивания `graphs_root` / `artifacts_base` | `context` в `run` / `run_from`: host-ключи выкидываются в `_prepare_context`; инфраструктура только через `host=` |

Документация: `python/README.md` (раздел про `RunHostContext`).

---

## MCP stdio server — направление **(A)** (**§34**, как Langflow/Dify tool surface)

Полная **сводная таблица продуктов** (Langflow, Dify, n8n, …) по MCP, tenant-scoped провайдеры и прочий расширяемый объём — в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) **§34**. Здесь — **факты реализации (A)** и **MVP (B)**.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Внешний агент/IDE подключается по **Model Context Protocol** к каталогу графов и запускам | Подкоманда **`python -m graph_caster mcp`** (требует **`pip install -e ".[mcp]"`**): транспорт **stdio**, SDK **`mcp`** (**`FastMCP`**) — `graph_caster/mcp_server/server.py` |
| Tools: список workflow / запуск | **`graphcaster_list_graphs`** (`limit`, `include_titles`) → индекс через **`load_graph_documents_index`** (вызов с диска в worker-thread, без блокировки asyncio-loop); **`graphcaster_run_graph`** — ровно одно из **`graphId`** или **`relativePath`** (имя файла **`.json`** в **`graphs/`**, без **`..`**); опции **`timeout_sec`**, **`dry_run_validate_only`**; ответ — **структурированный JSON** в MCP (не строка с JSON внутри): **`status`**, **`runId`**, **`eventBriefs`**, опц. **`rootRunArtifactDir`**, при таймауте ожидания tool — **`toolWaitTimedOut`**, при «застревании» после **`request_cancel`** — **`workerStillRunning`**; раннер с **`get_default_run_registry()`** для кооперативной отмены после **`timeout_sec`** |
| Отмена прогона из MCP-процесса | **`graphcaster_cancel_run`** — заглушка (**`supported: false`**); отмена по-прежнему через брокер / **`--track-session`** на воркере |
| Исполнение | Тот же **`GraphRunner`** + **`RunHostContext`**, события в in-memory sink (**без** NDJSON на stdout — stdio занят протоколом MCP) |

Код: **`graph_caster/mcp_server/handlers.py`**, **`graph_caster/__main__.py`** (**`_cmd_mcp`**); тесты **`python/tests/test_mcp_server_tools.py`**. Детали и ограничения (таймаут, **`GC_MCP_TOKEN`** зарезервирован) — **`python/README.md`**.

---

## MCP client node — направление **(B)** MVP (**§34**)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Отдельная нода / клиент MCP (n8n, Langflow, Dify, Flowise) | Тип ноды **`mcp_tool`**: один **`tools/call`** за визит; транспорты **`stdio`** и **`streamable_http`** (`graph_caster/mcp_client/client.py`, SDK **`mcp`**) |
| Секреты не в JSON графа | **`envKeys`**, **`bearerEnvKey`**, **`data.env`** — как у **`task`** (F8); редукция в **`node_execute`** / **`mcp_tool_invoke`** |
| Наблюдаемость | События **`mcp_tool_invoke`**, **`mcp_tool_result`** (опц. **`fromStepCache`** при F17 hit), **`mcp_tool_failed`**; **`run-event.schema.json`** |
| Ошибка → ветка **`out_error`** | Как **`task`** / **`graph_ref`**; предупреждения структуры в **`validate.find_mcp_tool_structure_warnings`** |
| Идемпотентный повтор шага (n8n / Langflow) | Опционально **`data.stepCache`** + хост **`--step-cache`**: см. подраздел **«Межпрогонный кэш выходов `task`, `mcp_tool`, `llm_agent` и `ai_route`»**; при **`context["mcp_tool_provider"]`** кэш для **`mcp_tool`** отключён; для **`ai_route`** межпрогонный кэш действует и при **`context["ai_route_provider"]`** (повторный прогон — **`node_cache_hit`** без повторного вызова провайдера); для **`llm_agent`** — **`node_cache_hit`** без повторного **`process_spawn`** (восстанавливаются **`processResult`** и **`agentResult`**) |

Код: **`graph_caster/mcp_client/`**, **`runner.py`**, **`handle_contract.py`**, схемы **`graph-document.schema.json`** (**`mcpToolNodeData`**), UI (**`mcp_tool`** в палитре и инспекторе). Тесты: **`python/tests/test_mcp_tool_node.py`**; фикстура **`schemas/test-fixtures/mcp-tool-linear.json`**. Опциональный e2e: **`GC_MCP_INTEGRATION=1`**. Не в MVP: OAuth, пул сессий, шаблоны в **`arguments`**.

---

## Делегированный LLM-агент — нода **`llm_agent`** (**F11**, внешний процесс)

Паттерн как у **Langflow** / **Dify** / **n8n Agent**: оркестрация и tool-loop живут **в отдельном процессе**, а раннер GC даёт **один шаг графа**, **stdin JSON** (контекст) и принимает **NDJSON шагов** на stdout. В ядре GC **нет** полноценного ReAct / памяти уровня этих продуктов — сравнение конкурентов и **остаток** **F11** (in-runner агент) — [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) **§23** и таблица **F11** там же (в этом файле — только **факт реализации** **`llm_agent`** / **`ai_route`**).

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Видимость шагов агента в логе прогона | События **`agent_delegate_start`**, **`agent_step`**, **`agent_tool_call`**, **`agent_finished`** / **`agent_failed`** в **`run-event.schema.json`**; оверлей канваса — **`ui/src/run/nodeRunOverlay.ts`** |
| Один контракт на границе процесса | **`stdin`:** одна строка UTF-8 JSON: **`schemaVersion`**, **`graphId`**, **`nodeId`**, **`runId`**, **`upstreamOutputs`**, опционально **`inputPayload`** (из **`data.inputPayload`**) — **`graph_caster/agent_delegate.build_llm_agent_stdin_text`** (лимит ~256 KiB, усечение **`upstreamOutputs`**). Поля ноды **`data`** (кроме **`inputPayload`**) в stdin **не** дублируются — дочерний процесс уже знает свою команду из **`argv`**. **`maxAgentSteps`** обрабатывает только хост (не в stdin). |
| Успех визита | Подпроцесс **exit 0** и строка **`agent_finished`**; дочерний процесс должен **завершиться** после финального события (иначе — таймаут **`timeoutSec`**). Иначе сбой / **`out_error`** как у **`task`**. Без **`command`/`argv`** — **`process_failed`** / ошибка, не «тихий» успех. |
| Секреты и окружение | Как **`task`**: **`command`/`argv`**, **`cwd`**, **`env`**, **`envKeys`**, **`timeoutSec`**, **`retryCount`** / **`maxRetries`**, **`retryBackoffSec`**; редукция в **`node_execute`** |
| Ретраи | Как у **`task`** (**`process_retry`**): новая попытка = **новый** subprocess с тем же stdin; внешние побочные эффекты могут **повторяться** — при **`retryCount`/`maxRetries` > 0** нужна **идемпотентность** агента или нулевые ретраи (подробнее **`python/README.md`**, нода **`llm_agent`**) |
| Параллельные ветки после **`fork`** | Поддерживается в том же классе планов, что **`task`** + **`mcp_tool`** (см. **`runner.py`**) |
| Межпрогонный кэш шага (F17) | Опционально **`data.stepCache`**: тот же **`StepCacheStore`**, **`nk`=`llm_agent`**; на диск — только успешные **`processResult`** + **`agentResult`**; повторный прогон — **`node_cache_hit`** без **`process_spawn`**

Код: **`graph_caster/agent_delegate.py`**, **`process_exec.run_llm_agent_process`**, **`runner._run_llm_agent_visit`**, **`validate.find_llm_agent_structure_warnings`**; схемы **`llmAgentNodeData`**; UI: палитра, **`InspectorPanel`** (в т.ч. F17), локали **en/ru**. Тесты: **`python/tests/test_agent_delegate.py`**, **`python/tests/test_llm_agent_node.py`**, **`python/tests/test_runner_step_cache.py`** (покрытие F17 для **`llm_agent`**).

---

## Workspace-секреты и `envKeys` (**F8** v1, file-first)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Имена кредов в графе, значения в vault (n8n, Langflow global vars, …) | Файл **`<workspaceRoot>/.graphcaster/workspace.secrets.env`** (не в Git); в **`task.data.envKeys`** и **`mcp_tool.data.envKeys`** — только имена переменных (`schemas/graph-document.schema.json`, **`$defs.envKeysList`**) |
| Подмешивание при исполнении | **`process_exec._build_task_subprocess_env`**: база **`os.environ`** → для ключей из **`envKeys`**, не перекрытых **`data.env`**, значение из файла, если есть → затем оверлей **`data.env`**; в **`envKeys`** допускаются только имена по тому же regex, что в схеме |
| Наблюдаемость | **`redact_task_data_for_node_execute`** (`process_exec.py`): **`node_execute`** и снимок **`node_outputs[].data`** для **`task`** с **`envKeys`** не содержат сырое значение для пересечения с **`envKeys`** и **`data.env`**; для **`mcp_tool`** — редукция в **`runner`** / событиях **`mcp_tool_*`** |
| F17 + секреты из файла | **`compute_step_cache_key`** (`node_output_cache.py`): при непустом **`envKeys`** в ключ добавляется **`ws_sec_fp`** — SHA-256 файла секретов или **`no_file`** / **`no_workspace`** |
| CLI / брокер | **`--workspace-root`** (`__main__.py`); **`run_start_body_to_argv_paths`** / **`build_graph_caster_run_argv`** — поле **`workspaceRoot`**; вложенный прогон (`nested_run_subprocess`) прокидывает **`host.workspace_root`** |

Код: **`python/graph_caster/secrets_loader.py`** (**`secrets_file_fingerprint`**), **`runner.py`** (**`_get_workspace_secrets`**, **`_get_secrets_file_fingerprint`**, redacted **`data`** в outputs), тесты **`python/tests/test_workspace_secrets_env.py`**. Пример пути: **`.graphcaster/workspace.secrets.env.example`**; игнор — **`.gitignore`**.

---

## Экспорт и целостность связей (P2 `sanitizeGraphConnectivity`)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Не терять «немые» изменения графа без сигнала (n8n/Dify/Langflow — валидация/ошибки связей) | **`sanitizeGraphConnectivity`** (`ui/src/graph/sanitize.ts`): фильтр рёбер по существующим **`source`/`target`**; результат **`{ document, removedEdgeIds }`**; **`removedEdgeIds`** без дубликатов (стабильный порядок) |
| Прозрачность для пользователя | **`onExportRemovedDanglingEdges`** в **`GraphCanvas`**, строка в блоке предупреждений **`AppShell`** + **`app.editor.removedDanglingEdges`** (en/ru); сброс при **New/Open/undo/redo** и при **`onFlowStructureChange`** до экспорта |
| Без ложных баннеров на внутренних экспортах | **`exportDocument(options?: ExportDocumentOptions)`**: **`notifyRemovedDanglingEdges`** (по умолчанию **true**); в **`AppShell`** уведомление отключено для снимков истории, **undo/redo**, захвата/фиксации **drag**, **автосохранения** и **`getDocument`** в модалке сохранения (чтобы не дублировать предупреждение после открытия модалки) |

Рантайм Python не меняется: несогласованный JSON с диска по-прежнему обрабатывается при загрузке в модель отдельно.

---

## Canvas: большие графы (**F1** / [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) **§28.2** п.4)

**SSOT по п.4:** закрытые факты (viewport **React Flow**, объём DOM, **LOD по zoom**, опциональный тир **`ghost`** для нод **полностью** вне вьюпорта с полем (**padding** в экранных px → flow), ленивое превью **`graph_ref`** в инспекторе — без встраивания дочернего JSON в документ родителя, оверлей, инкрементальный sync) перечислены **только здесь**; в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) §**28.2** п.**4** — отсылка сюда без дублирования перечня. Локальные черновики в **`doc/plans/`** (**`.gitignore`**, в Git не попадают) удаляйте после внедрения (в т.ч. по **LOD**, **ghost off-viewport**, **ленивому превью `graph_ref`**, **закреплённой визуализации прогона после выхода воркера**, **F18** / **`edges[].data.sourcePortKind` / `targetPortKind`**, **линия соединения при протягивании от ручки** — **`connectionRadius` / `connectionLineStyle`**). Открытые хвосты конкурентного сравнения по **F1** — **§15**, **§29** (встраивание дочернего графа в **A**).

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Не оплачивать полный DOM/React для невидимых нод (React Flow / паттерны n8n «не рисовать лишнее») | В **`GraphCanvas`**: **`onlyRenderVisibleElements`** на **`<ReactFlow>`** (**`@xyflow/react`**) |
| **LOD по zoom** (при отдалении — проще хром ноды в кадре: меньше DOM, те же габариты документа и handles; ориентир n8n/Dify) | **`lodLevelWithHysteresis`** (**`ZOOM_LOD_COMPACT_BELOW`** / **`ZOOM_LOD_FULL_EXIT`**) и **`lodLevelForZoom`** — **`ui/src/graph/canvasLod.ts`** (Vitest **`canvasLod.test.ts`**); подписка на **`transform[2]`** через **`useStore`** в **`GraphCanvas`**; контекст **`GcCanvasLodProvider`** / **`useGcCanvasLod`** (**вне провайдера в dev — `console.warn`**, **`full`**) — **`GcCanvasLodContext.tsx`**; **`compact`**: **`GcFlowNode`** без pill row + **`app.canvas.lodAria*`** в **`aria-label`** при pin/step cache; **`GcCommentNode`** / **`GcGroupNode`**: без **`NodeResizer`**, если **`compact`** и нода **не** выделена (**`selected`** → resizer снова доступен) + **`--lod-compact`**. Новые **`nodeTypes`**: эффективный тир — **`useGcEffectiveNodeTier`** (комбинирует LOD и viewport); см. **`ui/README.md`** |
| **Off-viewport ghost** (лёгкий хром для нод вне «кадра + поле»; паттерн n8n / RF + margin) | Чекбокс в **`TopBar`** (**`app.canvas.ghostOffViewport`**, **`localStorage`** **`gc-editor-ghost-offviewport`** через **`canvasGhostOffViewport.ts`**); классификация **`computeVisibilityByNodeId`** (**`viewportNodeTier.ts`**, **`VIEWPORT_OFFSCREEN_PADDING_PX`**, абсолютные прямоугольники через **`getWorldTopLeft`** / **`getFlowNodeSize`** / **`getCommentNodeSize`**, цепочка **`parentId`**); при выключенном режиме **`EMPTY_NODE_VISIBILITY_BY_ID`** — одна стабильная пустая **`Map`** (нет лишних обновлений **`GcViewportTierProvider`** при pan/zoom); провайдер **`GcViewportTierProvider`** + хук **`useGcEffectiveNodeTier`**; на нодах классы **`--ghost`** в **`app.css`**; **handles** и **`id` ручек** без изменений; **выделенные** ноды не переходят в **`ghost`**; a11y **`app.canvas.lodAriaGhostOffViewport`** (en/ru) — **`GcFlowNode`** (в **`aria-label`** вместе с LOD), **`GcCommentNode`** / **`GcGroupNode`**; Vitest — **`viewportNodeTier.test.ts`** (в т.ч. **`computeVisibilityByNodeId`** и родитель), **`gcEffectiveNodeTier.test.ts`** |
| Не делать **O(N)** пересборку массива нод на каждое событие прогона, если поменялась одна нода | Тот же файл: **`setNodes`** с сохранением ссылок на неизменённые ноды при стабильном порядке и совпадении структуры; рёбра — **`setEdges`**: **`gcFlowEdgeDocumentPayloadEqual`** (поля документа без `className` предупреждений; **`data`/`style`** — сравнение после нормализации порядка ключей JSON) + **`gcFlowEdgesSyncKeepSelection`** (перенос **`selected`/`selectable`** по **`id`**, не по индексу в массиве); оверлей — **`nodeRunOverlayRevision`** в **`runSessionStore`** + стабилизация карты в **`useMemo`** в **`GraphCanvas`** |
| **Подписи на рёбрах (F4 / `ai_route`, UX как n8n / workflow-редакторы)** | Тип **`gcBranch`** в **`graphDocumentToFlow`**; **`GcBranchEdge`**: **`BaseEdge`** + **`EdgeLabelRenderer`**, геометрия как у прежнего default (**`getBezierPath`**). Текст: **`edgeCanvasLabel.ts`** — **`flowEdgeLabelToCondition`** (строковый **`edge.label`** ↔ **`condition`** в JSON; общий путь для **`fromReactFlow`** и плашки), **`edgeCanvasLabelText`** (truncate **48**; **`ai_route`** — приоритет **`routeDescription`**, затем **`condition`**, иначе i18n **`edgeLabelAiRouteFallback`**). Контекст **`GcBranchEdgeUiContext`**: чекбокс **«Edge labels»** в **`TopBar`**, **`localStorage`** **`gc-editor-edge-labels`**, по умолчанию **вкл**; в **LOD `compact`** подписи **не** рисуются. Стили **`ui/src/styles/app.css`** **`.gc-branch-edge__label*`**, **`pointer-events: none`** на плашке |
| **n8n** / **Langflow** / Flowise / Dify — удобное протягивание связи (радиус подсадки к **Handle**, заметная линия превью на **@xyflow**) | **`ReactFlow`**: **`connectionRadius`** (**`GC_CONNECTION_RADIUS`**), **`connectionLineStyle`** (light/dark акцент как **`tokens.css`** / **`minimapChrome`**), **`connectionLineType.Bezier`** — согласовано с **`GcBranchEdge`**; **`canvasConnectionUi.ts`**, **`usePrefersColorSchemeDark`** в **`GraphCanvas.tsx`**; Vitest **`canvasConnectionUi.test.ts`** |
| **F18 / Langflow+n8n+RF** — отказ недопустимого drop и подсветка целевых ручек при жесте connect | Предикат как у нового ребра в **`connectionCompatibility`** (согласован с **`findHandleCompatibilityIssues`** по контракту ручек и **`PortDataKind`**; json↔primitive — **допускается** при drag; hard **`block`** — нет; к фреймам — как в прежнем **`onConnect`**). **`isValidConnection`**; **`GcFlowTargetHandle`** (подписка на store **только** во время drag) + **`GcConnectionDragContext`**; классы **`gc-handle--drop-*`**, **`app.canvas.connectionDropTarget*`** (en/ru). Код: **`connectionCompatibility.ts`**, **`GcFlowTargetHandle.tsx`**, **`GcConnectionDragContext.tsx`**, Vitest **`connectionCompatibility.test.ts`**. |
| **Ленивое превью вложенного графа** по **`graph_ref`** (как n8n / Dify: метаданные дочернего файла не сливаются в документ родителя; чтение файла — по выбору ноды, не при открытии всего родителя) | **`InspectorPanel`**: при выборе **`graph_ref`** автозагрузка превью (сворачивание **`Expand`/`Collapse`**, **`Refresh`** с **`force`**); поле **`hasStart`** и текст **`graphRefPreviewNoStart`**, согласованные с **`validate_graph_structure`** (Python: ровно одна нода **`start`**); без **`getGraphRefWorkspaceHint`** — **`graphRefPreviewTargetIdFallback`**; неожиданный **`throw`** из загрузки — в **DEV** **`console.error`** и отображение как **`read`**; **`getGraphRefWorkspaceHint`**: если цели нет в индексе **`graphs/`** — одно сообщение «нет в индексе», без чтения диска; поколение **`graphRefPreviewGenRef`** отсекает устаревшие **`await`**; **`AppShell`**: **`loadGraphRefSnapshot`**, in-memory кэш по **`targetGraphId`**, сброс при **`rescanWorkspace`** и точечная инвалидация по autosave; **`graphRefLazySnapshot.ts`**, Vitest **`graphRefLazySnapshot.test.ts`**; i18n **`app.inspector.graphRefPreview*`** |

Закрывает в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) **§28.2** п.**8** (подстрока **«Подписи на рёбрах…»** в таблице выше) и п.**9** (превью линии при протягивании связи — строка **«n8n / Langflow… протягивание связи»**); таблица **F1**, строка **GraphCaster** — только отсылка сюда, без дублирования перечня.

Код: **`ui/src/components/GraphCanvas.tsx`**, **`ui/src/graph/canvasConnectionUi.ts`**, Vitest **`canvasConnectionUi.test.ts`**, **`ui/src/graph/connectionCompatibility.ts`**, Vitest **`connectionCompatibility.test.ts`**, **`ui/src/components/GcConnectionDragContext.tsx`**, **`ui/src/components/nodes/GcFlowTargetHandle.tsx`**, **`ui/src/components/edges/GcBranchEdge.tsx`**, **`ui/src/components/edges/GcBranchEdgeUiContext.tsx`**, **`ui/src/graph/edgeCanvasLabel.ts`**, **`ui/src/graph/canvasEdgeLabels.ts`**, **`ui/src/components/GcCanvasLodContext.tsx`**, **`ui/src/components/GcViewportTierContext.tsx`**, **`ui/src/graph/canvasLod.ts`**, **`ui/src/graph/viewportNodeTier.ts`** (**`EMPTY_NODE_VISIBILITY_BY_ID`**), **`ui/src/graph/useGcEffectiveNodeTier.ts`**, **`ui/src/graph/canvasGhostOffViewport.ts`**, Vitest **`canvasLod.test.ts`**, **`viewportNodeTier.test.ts`**, **`gcEffectiveNodeTier.test.ts`**, **`edgeCanvasLabel.test.ts`**, **`canvasEdgeLabels.test.ts`**, **`fromReactFlow.test.ts`** (тип **`gcBranch`**), **`ui/src/graph/gcFlowEdgeSync.ts`**, Vitest **`gcFlowEdgeSync.test.ts`**; **`ui/src/run/runSessionStore.ts`** (**`nodeRunOverlayRevision`**), **`ui/src/run/nodeRunOverlay.ts`**, Vitest **`nodeRunOverlayBatch.test.ts`**. Локальный стресс-фикстур (stdout, не коммитить большие JSON): **`npm run fixture:large-graph`** в **`ui/`** (аргумент — число нод, по умолчанию **500**). **Baseline / Chrome Performance / целевые пороги** (процедура и таблица критериев): **`ui/README.md`** раздел **«Большой граф: фикстура и baseline»**.

**Рамки `group` и группировка выделения** (закрывает **§28.2** п.7 в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md), там остаётся только отсылка сюда): в документе первоклассный тип **`group`** (как у **`comment`**, не шаг раннера); **`parentId`** может указывать на **`comment`** или **`group`**. Полотно: **`GcGroupNode`** / **`gcGroup`**, репарент при перетаскивании и команды **Group selection** / **Ungroup** в **Правка** (**Ctrl+G** / **Ctrl+Shift+G**). Новые id групп: **`newGroupFrameId()`** в **`ui/src/graph/nodePalette.ts`** (префикс **`group-`**, не зависит от формата **`newGraphNodeId`**). Код: **`ui/src/graph/groupSelection.ts`**, **`flowHierarchy.ts`**, **`toReactFlow.ts`**, **`fromReactFlow.ts`**, **`AppShell.tsx`**, **`TopBar.tsx`**, **`nodeKinds.ts`**; схема и Python — **`schemas/graph-document.schema.json`**, **`python/graph_caster/validate.py`**, **`runner.py`**, **`handle_contract.py`**; тесты — **`ui/src/graph/groupSelection.test.ts`** (в т.ч. восстановление абсолютных позиций после ungroup; группировка двух **task** внутри **`comment`**), **`python/tests/test_group_frame_node.py`**.

**Snap-to-grid и align/distribute выделения** (эталон: n8n / **React Flow** `snapToGrid`; выравнивание по «общему родителю», как у типичных редакторов на базе **@xyflow**): шаг сетки **`CANVAS_GRID_STEP` (16)** — одна константа для **`Background gap`** и **`snapGrid`** на **`<ReactFlow>`** в **`GraphCanvas.tsx`**. Опция **привязки при перетаскивании** — **выкл** по умолчанию, чекбокс в **`TopBar`**; **`localStorage`**: **`gc-editor-snap-grid`** (**`SNAP_GRID_STORAGE_KEY`** в **`canvasSnapGrid.ts`**). **`flowNodesForAlign`** для доступности операций при возможности берётся из **`exportDocument`** (как и применение), иначе из **`graphDocument`**. **Выравнивание / равномерное распределение** — селекторы в **`TopBar`**; корзины по **`parentId`** (align ≥2, distribute ≥3 в корзине); запись позиций как у **group**: экспорт → **`graphDocumentToFlow`** → **`applyAlignDistribute`** → **`flowToDocument`** → **`commitHistorySnapshot`** + **`setGraphDocument`** + тик раскладки; no-op — модалка **`app.canvas.alignDistributeNoChange`**. Код: **`canvasSnapGrid.ts`**, **`canvasAlignSelection.ts`**, **`AppShell.tsx`**, **`TopBar.tsx`**, **`GraphCanvas.tsx`**; Vitest — **`canvasSnapGrid.test.ts`**, **`canvasAlignSelection.test.ts`**. Сравнение конкурентов по **F1** — [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) **§28**; **отдельный пункт плана** под эту фичу в **§28.2 не ведётся** — SSOT реализации здесь.

Сравнение с конкурентами и **остаток** F1 (**встраивание** полного дочернего JSON в слой **A** вне file-first — **§29**; полная типизация пинов — **§15**) — [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) **§28**, таблица **F1** (строка GraphCaster).

---

## Визуализация прогона на канвасе (edge highlight + motion modes)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Подсветка последней пройденной связи и ощущение «активного» прогона (React Flow animated edges, n8n running feedback) | События **`edge_traverse`** / **`branch_taken`** → **`runEdgeOverlay.ts`**; в снимке сессии — **`highlightedRunEdgeId`**, ревизия **`edgeRunOverlayRevision`** (**`runSessionStore.ts`**); **`GraphCanvas`** подмешивает класс **`gc-edge--run-active`** при разрешённой анимации; пульс на текущей ноде — **`gc-node--run-motion-pulse`** в режиме **`full`**; сброс активной ноды на **`run_success`** (и прочие финалы) — **`runEventSideEffects.ts`** |
| Режимы «полная / только рёбра / без движения» (согласовано с идеей reduced motion) | Селектор в **`TopBar`**; **`localStorage`** **`gc-editor-run-motion`** — **`canvasRunMotion.ts`** (**`full`** \| **`minimal`** \| **`off`**); пульс ноды — CSS **`prefers-reduced-motion`** в **`app.css`** и флаг **`effectiveRunNodePulse`**; анимация ребра React Flow — отключается через **`effectiveRunEdgeAnimated`** и **`usePrefersReducedMotion`** (**`ui/src/lib/usePrefersReducedMotion.ts`**) |
| Опционально следить камерой за текущим шагом во время live-run или replay (Comfy **`executing`**, n8n-style focus на активной ноде, без смены zoom) | Чекбокс **«Follow run»** в **`TopBar`**; **`localStorage`** **`gc-editor-follow-run`** — **`canvasFollowRun.ts`**. При включении и активной сессии (**replay** или **focused run** ∈ **`liveRunIds`**) **`FollowActiveRunCamera`** в **`GraphCanvas`** (внутри **`<ReactFlow>`**): дебаунс **~85 ms** (плюс **~220 ms** после смены **`layoutEpoch`**, чтобы не пересечься с **`fitView`** при Open/New), центр ноды в мировых координатах (**`getWorldTopLeft`** + **`getFlowNodeSize`** / **`getCommentNodeSize`** для frame-нод), **`setCenter`** с текущим **`zoom`**; плавный pan только в режиме **`full`** и без **`prefers-reduced-motion`** — **`effectiveFollowRunCameraPanAnimated`** в **`canvasRunMotion.ts`** (как у пульса ноды; **`minimal`** / **`off`** — мгновенный сдвиг) |
| Итог прогона на холсте после выхода воркера (n8n / Langflow / Flowise: статусы шагов до следующего запуска) | При **`runSessionOnRunProcessExited`** / **`runSessionAbortRegisteredRun`** финальный **`nodeRunOverlay`** и последнее пройденное ребро (трекер **`lastTraversedEdgeByRunId`**, т.к. **`run_finished`** обнуляет живую подсветку ребра) копируются в **`settledVisualByRootGraphId`** по **`rootGraphId`** из NDJSON (**`runSessionNoteRootGraphForRun`** из **`run_started`** / **`run_finished`** в **`runEventSideEffects.ts`**). Публичный снимок при отсутствии live-run показывает settled для открытого документа (**`runSessionSetCurrentRootGraphId`**, синхронизация **`meta.graphId`** в **`AppShell`**); при смене графа — свой settled на граф. Новый live-run очищает settled только текущего графа; кнопка **«Clear highlights»** (**`aria-label`**) — **`runSessionClearSettledVisualForCurrentGraph`**, i18n **`app.run.clearSettledVisual*`**. |

Код и проверки: **`ui/src/run/runEdgeOverlay.ts`**, Vitest **`ui/src/run/runEdgeOverlay.test.ts`**; **`ui/src/graph/canvasRunMotion.ts`**, Vitest **`ui/src/graph/canvasRunMotion.test.ts`**; **`ui/src/graph/canvasFollowRun.ts`**, Vitest **`ui/src/graph/canvasFollowRun.test.ts`**; **`ui/src/run/runSessionStore.ts`**, **`runEventSideEffects.ts`**, Vitest **`runSessionStore.test.ts`** (в т.ч. смена **`currentRootGraphId`** между двумя settled), **`runEventSideEffects.test.ts`**; **`ui/src/components/GraphCanvas.tsx`**, **`ui/src/layout/AppShell.tsx`**, **`ui/src/components/TopBar.tsx`**, локали **`ui/src/locales/en.json`** / **`ru.json`**. Конкурентный пробел по этой теме снят — см. [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) §**1** / §**17** / §**28.2** (отсылка сюда, без второго перечня).

---

## Открытие графа, инспектор и Save: ошибки (P1, как n8n/Dify — явная причина отказа)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Не показывать безликий alert при битом workflow | **Файл → Открыть** и **Открыть из graphs/…**: при ошибке чтения, синтаксиса JSON или **`parseGraphDocumentJsonResult`** — модалка **`OpenGraphErrorModal`** с i18n-текстом по виду ошибки (**`nodes` не массив**, невалидный **`schemaVersion`**, индекс битой ноды/ребра и т.д.) |
| Понять, какой файл ломается | Заголовок **`titleWithFile`** с **`fileName`** (локальный pick и файл воркспейса); детали для копирования — JSON ошибки парсера или текст **`JSON.parse`** / read |
| Модалка ошибки открытия: копирование и busy-состояние | **`OpenGraphErrorModal`**: общий **`writeTextToClipboard`** (**`lib/clipboardWrite.ts`**); **`onCopy`**: в начале **`if (copyBusyRef.current) return`**, затем ref и **`copyBusy`** **синхронно**, сброс в **`finally`**; **`safeClose`** по **`copyBusyRef`** блокирует **Escape** / backdrop / **Закрыть** на время копирования; **`aria-busy`**, кнопки **Copy** / **Закрыть** **`disabled`** при **`copyBusy`**; эффект **`[open, presentation?.copyText]`**: при **`open === false`** — полный сброс **`copyBusy`** / ref / **`copyDone`**; при **`open === true`** — всегда **`setCopyDone(false)`**, а **`copyBusy`** и ref сбрасываются **только если** **`!copyBusyRef.current`**, чтобы смена **`presentation`** во время копирования **не** обнуляла ref и не открывала **`safeClose`** до **`finally`** |
| Инспектор: явная ошибка вместо «голого» alert | Ошибки разбора JSON в **Data** ноды, в **inputs/outputs** графа и невалидный **schema version** — **`OpenGraphErrorModal`** через **`onUserMessage`** (**`presentationForInspector*`**); тип **`AppMessagePresentation`**, состояние **`appMessageModal`** в **`AppShell`** |
| Save / workspace: одна модалка, полевые ошибки без второй модалки поверх диалога | **`GraphSaveModal`**: под полем имени — **`SaveFieldIssue`** (пустое имя; **`getDocument()` === null** — **`document_unavailable`** / **`app.saveModal.documentUnavailable`**; сбой **`saveJsonWithFilePickerOrDownload`**; конфликт **`graphId`** с другим файлом в **`graphs/`**; сбой **`writeJsonFileToDir`**; потеря привязки папки — **`workspaceUnavailable`**); **`onSaveToWorkspace`** → **`Promise<GraphSaveToWorkspaceResult>`**; **`saveDocumentToWorkspace`** возвращает структурированный результат и **не** открывает **`AppMessageModal`** для duplicate **`graphId`** / ошибки записи на этом пути; **`role="alert"`**, **`aria-describedby`**, **`aria-busy`** при **`isSaving`** или **`copyBusy`**; копирование текста ошибки — **`handleCopyIssue`** с **`copyBusy`** / **`copyBusyRef`** (синхронно, **`try`/`finally`**, защита от повторного входа), те же ключи **`app.errors.openModal.copy`** / **`copied`**; пока **`copyBusy`** или **`isSaving`** — отключены **Copy**, **Отмена**, **Save**, поле имени и плитки workspace; **`safeClose`** учитывает **`isSavingRef`** и **`copyBusyRef`** (**Escape**, backdrop, **Отмена**); **`isSavingRef`** — в **`handleSave`** / **`finally`**; эффект **`[open, suggestedFileName]`**: при **`open === false`** — сброс **`copyBusy`** / ref; при **`open === true`** — **`setFileName`**, **`setSaveIssue(null)`**, а **`copyBusy`** / ref сбрасываются **только если** **`!copyBusyRef.current`** (та же защита от гонки со сменой пропов во время копирования); успешный Save по-прежнему закрывает через **`onClose`** |

Код: **`ui/src/lib/clipboardWrite.ts`**, Vitest **`ui/src/lib/clipboardWrite.test.ts`**; **`OpenGraphErrorModal.tsx`**, **`GraphSaveModal.tsx`**; **`ui/src/graph/openGraphErrorPresentation.ts`** (в т.ч. **`presentationForSave*`** / **`presentationForWorkspace*`** для Vitest и прочих вызовов; путь Save из **`GraphSaveModal`** их не использует), **`AppShell.tsx`**, **`InspectorPanel.tsx`**; Vitest **`openGraphErrorPresentation.test.ts`**. В **`doc/DEVELOPMENT_PLAN.md`** пункт P1 по открытию — **закрыт**; в **`COMPETITIVE_ANALYSIS.md`** §**1** и §**28.2** — только отсылка сюда, **без** дублирования деталей реализации P1 (открытие, инспектор, Save, копирование в буфер).

---

## Редактор: расхождение **`schemaVersion`** и сбой автосохранения (P3, UX как у зрелых IDE)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Явный сигнал при противоречивых полях документа до **Save** | Если заданы и **`schemaVersion`** корня, и **`meta.schemaVersion`**, и числа **различаются** — **`StructureIssue`** **`schema_version_mismatch`** (жёлтая строка в **`AppShell`**, не блокирует Run). Сравнение через **`comparableSchemaVersions`** (`ui/src/graph/parseDocument.ts`) |
| Не молчать при ошибке фоновой записи | Автосохранение в **`graphs/`**: при **`writeJsonFileToDir`** — баннер **`app.editor.autosaveFailedBanner`**, в консоль **`app.editor.autosaveFailedConsole`** не чаще **1 / 30 s**; сброс при успешном autosave или при успешном **Save** в workspace |

Код: `ui/src/graph/structureWarnings.ts`, `ui/src/layout/AppShell.tsx`, локали **en/ru**; тесты **`structureWarnings.test.ts`**, **`parseDocument.test.ts`**. План: **`doc/DEVELOPMENT_PLAN.md`** (подпункты P3).

---

## Условные рёбра / F4 (n8n IF/Switch, Dify variable-based branch) — конспект **§32**

Статус в competitive: факты реализации **F4** (в т.ч. **`$json`**, **`$node`** (чтение **`node_outputs`**), **`branch_*`**, **`edge_traverse`**) — в **§32.1–§32.2** [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) со ссылкой сюда; ноды **`fork`**, **`merge`** (**passthrough** / **`barrier`**) — отдельный подраздел ниже. В **§32.2** список «**Открыто**» — полный **n8n Expression** runtime (JS sandbox), продуктовая документация, расширение контекста предикатов, **масштабный** межпрогоновый пул / очереди уровня **§13.3** (**F6**, не dev-брокер; масштабируемый пул — вне этого репозитория); **FIFO** pending при лимите слотов **`serve`** — закрыто (таблица **«Dev WebSocket…»** ниже). **Внутриграфовый** bounded OS-параллель после **`fork`** — в таблице **Merge** ниже. **Структурированное ИИ-ветвление** (**нода `ai_route`**, wire v1) — **закрыто** (подраздел **«ИИ-ветвление / нода `ai_route`»** ниже и п.4 **§32.2** в competitive). Узкие конверты **`$json`** / **`$node`** без VM — **закрыты** (таблица ниже). In-graph **`out_error`** (**F19**) закрыт здесь и отражён в **§16** / **§37** competitive без дублирования объёма реализации.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Несколько исходов из ноды, предсказуемый выбор ветки | **Инвариант «первое подходящее»:** порядок массива **`edges`** в документе; **`_evaluate_next_edge`** выбирает первое ребро с пустым **`condition`** или первое, для которого **`eval_edge_condition`** истинно; иначе **`run_end`** с **`reason`** **`no_outgoing_or_no_matching_condition`** (`runner.py`) |
| Выражения к данным шага без небезопасного eval | Подмножество **JSON Logic** в строке **`edge.condition`** (JSON-объект с одной корневой операцией); **шаблоны** **`{{path}}`** (truthiness) и **`{{path}} <op> <literal>`** (`op` ∈ `==`, `!=`, `<`, `<=`, `>`, `>=`; кавычки для строковых литералов; для **`==`/`!=`** — числовое приведение строки и числа как **`_coerce_num`**; литерал сравнения **без** многострочного «растягивания» regex); корень пути — зарезервированные **`$json`**, **`$node`** (см. «Контекст предиката») или прежние **dotted** корни (**`node_outputs`**, …); иначе legacy-литеры **`true`**/**`false`**/…; иначе не-JSON-строка без `{{` → **`bool(context["last_result"])`**. Реализация: **`graph_caster/edge_conditions.py`**, статический разбор в UI: **`edgeConditionTemplates.ts`** / предупреждения в **`branchWarnings.ts`** и **`AppShell`** (в т.ч. **`too_long`** при превышении **`MAX_EDGE_CONDITION_CHARS`**, см. `python/README.md`) |
| Контекст предиката | **`last_result`**, **`node_outputs`**, пути **`var`** через **`.`** (напр. **`node_outputs.t1.processResult.exitCode`** — для **UUID** в **id** наивный **`node_outputs.<uuid>…`** по точкам не годится); **синтетический корень** **`$json`** = **`last_result`** если **`dict`**, иначе **`{"value": last_result}`**; **синтетический корень** **`$node`** = **алиас** того же **`node_outputs`**, что уже в данных предиката (**`$node["…"]`**, **`$node['…']`**, **`$node.shortId`** — см. **`python/README.md`**). Ключи **`$json`** / **`$node`** из **`context`** при оценке перезаписываются. Полный **n8n Expression** / JS sandbox **не** используются. Скрыты только **корневые** ключи **`context`** с префиксом **`_`**; вложенные поля под **`node_outputs`** не маскируются |
| Связь с **task** | **`node_outputs[id].processResult`**: `exitCode`, `success`, `timedOut`, `cancelled`, объёмы stdout/stderr — после каждого **`process_complete`** и при **`spawn_error`** (`exitCode` **`-1`**, `python/graph_caster/process_exec.py`) |
| Статические предупреждения в UI (не заменяют раннер) | **`findBranchAmbiguities`** / **`branchWarnings`** — два безусловных исхода, дубликаты строки условия (`ui/`, **§32.1** competitive doc); затронутые рёбра — на canvas (**`edgeIdsForBranchAmbiguities`**, **`gc-edge--warning`**) |
| Событие выбранной ветки | **`edge_traverse`** (совместимость); перед ним при ветвлении — **`branch_skipped`** (`reason`: **`condition_false`**) для оценённых ложных условий, **`branch_taken`** (с **`graphId`**) если исходящих больше одного или были skip (**`runner.py`**, **`schemas/run-event.schema.json`**) |
| **`$node`** в условиях (срез n8n **`$node[…]`** без Expression VM) | Рантайм: **`python/graph_caster/edge_conditions.py`** (**`_predicate_data`**, **`_get_path`**, regex шаблонов). Паритет статического разбора в UI: **`ui/src/graph/edgeConditionTemplates.ts`**. Тесты: **`python/tests/test_edge_conditions.py`**, **`test_edge_condition_templates.py`**, **`ui/src/graph/edgeConditionTemplates.test.ts`**. Поведение и ограничения (кавычки в id и т.д.): **`python/README.md`** |

**Закрыто в этом файле (маппинг конкурентов → код):** **структурированное ИИ-ветвление** — нода **`ai_route`** (wire v1), таблица ниже; смешение классики и ИИ на одной ноде — **не** в v1 (композиция **`task` → `ai_route`**).

**Открыто в F4 (см. `COMPETITIVE_ANALYSIS.md` §32.2):** полноценный **n8n Expression** (произвольные функции, произвольный JS, sandbox VM) — **вне** безопасной грамматики JSON Logic + mustache + **`$json`** + ограниченного **`$node`** (только чтение из **`node_outputs`**, таблица выше). **Fan-out/join** в одном процессе (**`fork`**, **`merge`** **`barrier`**) — в таблице **Merge** ниже (в т.ч. опциональный **OS-параллель** веток). В competitive остаётся: **межпрогоновый** параллелизм и паритет **n8n** после fan-out / **Merge** (**§13**, **F6**) вне узкого **host pending FIFO** dev-брокера (см. таблицу **«Dev WebSocket…»**); подмешивание LLM в **`edge.condition`** без отдельной ноды — **§32.2** п.4. In-graph **`out_error`** — раздел **F19** ниже.

### ИИ-ветвление / нода **`ai_route`** (wire v1)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| **n8n** IF / Switch / AI-ноды как отдельный шаг маршрутизации | Нода **`ai_route`**: вход **`in_default`**, несколько **`out_default`**; порядок веток = порядок в массиве **`edges`**; условия на рёбрах с **`ai_route`** **не** используются для выбора |
| **Langflow** structured output / выбор ветки | Провайдер возвращает **`choiceIndex`** **1…N**; см. **`schemas/ai-route-wire.schema.json`** |
| **Dify** условный обход графа | Один синхронный выбор исхода за визит ноды |
| HTTP POST + Bearer из env | **`data.endpointUrl`**, опционально **`data.envVarApiKey`** (имя переменной окружения); в инспекторе ноды — **ссылка «Открыть endpoint»** на **http/https** (нормализация и отсев **`javascript:`** / **`file:`** — **`safeExternalHttpUrl`**, новая вкладка **`noopener`**); если в **Data JSON** есть ключ **`endpointUrl`**, превью ссылки берётся из **черновика** до **Apply**, иначе из сохранённого документа |
| Описание веток для модели | **`edges[].data.routeDescription`** (до 1024 символов); статические предупреждения в UI/Python при отсутствии описаний при **>1** ветке |
| Наблюдаемость | События **`ai_route_invoke`**, **`ai_route_decided`**, **`ai_route_failed`**; **`branch_skipped`** с **`ai_route_not_selected`**; **`node_exit`** ноды — после маршрутизации; **`node_outputs[id].aiRoute`**; тело POST и лимит **`maxRequestJsonBytes`** — один компактный JSON |
| Тесты без сети | **`context["ai_route_provider"]`**: **`Callable[[dict], dict]`** |

Код: **`python/graph_caster/ai_routing.py`**, **`runner.py`** (`_follow_ai_route_from`), **`handle_contract.py`**, **`validate.py`** (`find_ai_route_structure_warnings`), **`schemas/graph-document.schema.json`**, **`schemas/run-event.schema.json`**; UI: **`nodeKinds`**, палитра, **`InspectorPanel`** (в т.ч. внешняя ссылка на **`endpointUrl`**), инспектор ребра, **`structureWarnings`**, фикстура **`schemas/test-fixtures/ai-route-simple.json`**. Тесты: **`python/tests/test_ai_route_node.py`**, Vitest **`fromReactFlow`**, **`handleCompatibility`**, **`structureWarnings`**, **`safeExternalUrl.test.ts`**.

### Merge (`join`) — реконвергенция после ветки (MVP)

**Нормативный срез (перенесено из [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) §31.2 п.4 и блока про параллелизм после fan-out в §32.2):** контракт **`fork`** / **`merge`** **`barrier`**, опциональный **bounded OS-параллель** веток (лимиты **`fork.data.maxParallel`**, CLI/env/context, **`ThreadPoolExecutor`**), предупреждения **`structure_warning`** с **`kind`** **`fork_parallel_deferred`** / **`fork_parallel_region_unsupported`**, схема **`run-event`** — **только в этой таблице, в `python/README.md`, `schemas/*` и коде** (`fork_parallel.py`, `runner.py`). В competitive остаётся сравнение продуктов и **незакрытый** межпрогоновый **F6** (**§13**: очередь прогонов, полный паритет **n8n Merge** для произвольных топологий).

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| **n8n** — отдельная нода **Merge**, несколько входов | Тип ноды **`merge`**: **`in_default`** / **`out_default`** только (**F18**); в меню полотна (ПКМ); ромб на канвасе (`ui/`) |
| **Dify** — неявное ожидание предков в **GraphEngine** | **Passthrough:** **`node_outputs[id].merge.passthrough`** при **`data.mode`** не **`barrier`**. **Barrier (`data.mode` = `barrier`):** join как у n8n **Merge** «дождаться всех» — приход с каждого предка по **`out_default`**; без успешных входов barrier не планируется. **Переход `out_error` в barrier-merge** не ставит ноду в очередь: **`error`** **`barrier_merge_error_path_not_supported`**. **`node_outputs[id].merge`**: **`barrier`**, **`arrivedFrom`**, **`passthrough`:** **`false`**. Между **`fork`** и barrier по умолчанию ветки **последовательно**; при **`maxParallel` > 1** — см. строку **n8n** ниже |
| **n8n** — несколько исходов в шину + **Merge** | Нода **`fork`** — безусловные **`out_default`**; по умолчанию последовательно в **`StepQueue`**. Опционально **OS-параллель** веток до одного **`merge`** **`barrier`**: **`fork.data.maxParallel`**, **`--fork-max-parallel`**, **`GC_FORK_MAX_PARALLEL`**, **`context["fork_max_parallel"]`** (минимум из лимитов, **≥1**); только линейные ветки по одному subprocess-**`task`**; иначе **`structure_warning`** и последовательный fallback. Код: **`fork_parallel.py`**, **`runner.py`** (**`ThreadPoolExecutor`**); тесты **`test_merge_barrier_fork.py`**, **`test_fork_parallel.py`** |
| Статика | Python: **`find_merge_incoming_warnings`**, **`find_fork_few_outputs_warnings`**, **`find_barrier_merge_out_error_incoming`**, **`find_barrier_merge_no_success_incoming_warnings`**; UI: **`merge_few_inputs`**, **`fork_few_outputs`**, **`barrier_merge_out_error_incoming`**, **`barrier_merge_no_success_incoming`** в **`findStructureIssues`**. Раннер эмитит соответствующие **`structure_warning`** в NDJSON |
| Контракт документа | `schemas/graph-document.schema.json` (описание **`type`**, **`fork`**, **`merge.data.mode`**), фикстуры **`handle-merge.json`**, **`merge-after-branch.json`**, **`fork-merge-barrier.json`**, **`handle-fork.json`** |

Код: **`python/graph_caster/runner.py`** (в т.ч. **`fork`**, **`_gc_merge_barrier`**, параллельный срез **F6**), **`fork_parallel.py`**, **`handle_contract.py`**, **`validate.py`**; тесты **`test_merge_node.py`**, **`test_merge_barrier_fork.py`**, **`test_fork_parallel.py`**, **`test_validate_structure.py`**, **`test_handle_compatibility.py`**.

Документация: `python/README.md` (раздел «Условия на рёбрах»), `schemas/graph-document.schema.json` (`edges[].condition`). Углублённое сравнение с конкурентами — **§32** в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md).

---

## Пресет Cursor Agent CLI (фаза 9, как n8n **Execute Command** + явный argv)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Явный список аргументов и cwd, секреты вне JSON | Нода **`task`** с **`data.gcCursorAgent`** (`presetVersion` **1**): рантайм собирает **`argv`** для **`agent -p`** (опц. **`--force`**, **`--model`**, **`--output-format`**, **`extraArgs`**); исполняемый файл из **`GC_CURSOR_AGENT`**, **`PATH`**, или Windows **`%LOCALAPPDATA%\cursor-agent\agent.cmd`** |
| **`command`/`argv` важнее пресета** | Если заданы **`command`** или **`argv`**, пресет не используется (**`process_exec._argv_from_data`** первым) |
| База cwd и вложенные графы | **`GraphRunner.run_from`** кладёт **`_gc_graphs_root`** в контекст; **`cwdBase`**: **`workspace_root`** / **`graphs_root`** / **`artifact_dir`** + **`cwdRelative`** (без **`..`**); явное **`data.cwd`** перекрывает базу пресета; ключ **`gcCursorAgent`** в **`data`** (даже **`{}`**) планирует **`task`** в **`process_exec`**, чтобы валидация/ошибка не были «тихими» |
| Плейсхолдеры промпта | **`{{out:<nodeId>.processResult.stdout}}`** / **`.stderr`** в **`cursor_agent_argv.expand_prompt_placeholders`** (лимит **`MAX_CHAINED_PROCESS_OUTPUT_TEXT_LEN`**); в **`node_outputs`** — то же усечение в **`process_exec._record_task_process_result`** |
| UI | ПКМ → **Cursor Agent (task preset)**; инспектор **`task`**: блок полей **`gcCursorAgent`** + **Apply data**; **`ui/src/graph/cursorAgentPreset.ts`**, **`defaultCursorAgentTaskData`** в **`nodePalette.ts`** |
| Контракт и пример | **`schemas/graph-document.schema.json`** (**`$defs.gcCursorAgent`**), фикстура **`schemas/test-fixtures/cursor-agent-linear.json`** |

Код: **`python/graph_caster/cursor_agent_argv.py`**, **`process_exec.py`** (**`_resolve_argv_and_optional_preset_cwd`**), **`runner.py`** (**`_task_has_process_command`**, **`_gc_graphs_root`**). Тесты: **`python/tests/test_cursor_agent_preset.py`**.

**Конкурентный контекст (фаза 9):** сравнение с **n8n Execute Command**, headless **Langflow `lfx run`**, вынесение секретов из JSON (**F8**) сведено в таблицу выше; в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) остаются обзорные таблицы по продуктам (**§4 F7**, **§7**, **§11**, **§27**) и эталоны для будущих расширений **F7**, без дублирования контракта **`gcCursorAgent`**.

---

## Статическая достижимость из **start** (F3, как n8n/Dify структурные проверки)

Пункт **§31.2** п.1 в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) перенесён сюда как **закрытый** срез; в competitive остаются «открытые» темы (циклы, полная рантайм-связность с симуляцией **F4**, **межпрогоновый** **F6** / очереди) — см. строку **GraphCaster** в таблице F3 там же. **Внутриграфовый** bounded параллель после **`fork`** — подраздел **Merge** выше, не дублировать здесь.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Предупреждение о нодах вне обхода от входа | UI: **`findUnreachableWorkflowNodeIds`** (`ui/src/graph/reachability.ts`), **`findStructureIssues`** → **`unreachable_nodes`**; жёлтая строка рядом с прочими предупреждениями (`AppShell`). **`comment`** не попадает в список |
| Все исходящие рёбра считаем возможными (без симуляции **`condition`**) | Over-approximation: directed BFS по **`edges`** |
| Run / Save | Run **не** блокируется только из‑за **`unreachable_nodes`** (**`structureIssuesBlockRun`**); критичные проблемы **`start`** по-прежнему блокируют запуск |
| Паритет с хостом / CLI | **`find_unreachable_non_frame_nodes`** в **`python/graph_caster/validate.py`** (исключает **`comment`** / **`group`**; имя **`find_unreachable_non_comment_nodes`** оставлено как совместимый алиас), тесты в **`tests/test_validate_structure.py`** |
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

## Вложенный **`graph_ref`**: опциональная изоляция OS-процесса (**F5**, §**29**)

Эталон конкурентов — отдельный процесс или worker на вызов саб-воркфлоу (n8n queue / sub-workflow, Dify child graph, headless run у Langflow и т.д.). Ниже — **факт реализации** GraphCaster; продуктовые таблицы **F5** / §**29** в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) остаются для сравнения продуктов без дублирования полного описания кода.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| **n8n** — Execute Workflow / sub-workflow, в enterprise часто изоляция на worker | **`GC_GRAPH_REF_SUBPROCESS=1`** (также **`true`** / **`yes`** / **`on`**): на каждый заход в **`graph_ref`** — отдельный процесс **`python -m graph_caster run`**; строки NDJSON дочернего прогона в тот же **`RunEventSink`**, тот же корневой **`runId`**, **`nested_graph_enter` / `nested_graph_exit`** как при in-process. Родитель **синхронно** ждёт дочерний CLI; это **не** отдельная очередь прогонов (**F6**, **§13**). |
| **Dify** — child graph и merge переменных / контекста | Allow-list ключей контекста (**`NESTED_CONTEXT_INPUT_KEYS`**) → **`--context-json`**; снимок после прогона → **`--nested-context-out`**, merge **`node_outputs`** и флагов в родителя (**`nested_run_subprocess.py`**). |
| **Flowise** queue / **Langflow** отдельный процесс на run | Тот же CLI entrypoint, что у корневого Run; без Redis/WebSocket. |

По умолчанию (**ENV** не задан / **`0`**) вложенный граф — **in-process** (**`GraphRunner`** в родителе).

Код: **`python/graph_caster/nested_run_subprocess.py`**, **`runner._execute_graph_ref`**; **`TeeRunEventSink.emit`** под **`threading.Lock`** (поток pump stdout дочернего процесса и основной поток раннера). Тесты: **`python/tests/test_nested_graph_subprocess.py`**. Таблица NDJSON **`type`** — строка «Вложенный **`graph_ref`**, изоляция процесса (опция)». См. также **`python/README.md`**, **`doc/DEVELOPMENT_PLAN.md`** (фаза 2).

---

## Статическая совместимость ручек **F18** (n8n connection types / Langflow `validate_edge`)

Сравнение с **ComfyUI / Dify / Flowise / Langflow / n8n** по моделям портов и таблицы конкурентов — **§15** в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md); здесь только **факт реализации** GraphCaster.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Жёсткая проверка пинов до исполнения | **`validate_graph_structure`** вызывает **`find_handle_compatibility_violations`** (`python/graph_caster/handle_contract.py`); первая ошибка → **`GraphStructureError`** |
| Отказ недопустимого **drop** и подсказка на целевых ручках **во время** жеста connect (**Langflow** `validate_edge` / **n8n**-стиль / **React Flow** `isValidConnection`) | Тот же предикат, что для нового ребра: **`connectionCompatibility.ts`** (**`isGcFlowConnectionAllowed`**), **`isValidConnection`** + **`onConnectStart`/`onConnectEnd`** в **`GraphCanvas.tsx`**, **`GcFlowTargetHandle.tsx`**, **`GcConnectionDragContext.tsx`**, стили **`gc-handle--drop-*`**, строки **`app.canvas.connectionDropTarget*`** (en/ru). Краткая строка в таблице раздела **«Canvas: большие графы»** выше (**F18 / Langflow+n8n+RF**); Vitest **`connectionCompatibility.test.ts`**. |
| Мягкое предупреждение в редакторе | UI: **`findHandleCompatibilityIssues`** (`ui/src/graph/handleCompatibility.ts`), контракт пинов **`handleContract.ts`**, несовпадение **port data kind** (**`port_data_kind_mismatch`** / **`port_data_kind_incompatible`**) и жёлтая полоса в **`AppShell`** (не входит в **`structureIssuesBlockRun`**). Рёбра с теми же и родственными статическими проблемами подсвечиваются на canvas (**`collectCanvasWarningEdgeIds`**, **`warningEdges.ts`**, класс **`gc-edge--warning`** в **`app.css`**) — вместе с ветвлением (**`edgeIdsForBranchAmbiguities`**) и частью структуры (**`edgeIdsForStructureIssueHighlights`**: вход в **start**, **out_error** в barrier **merge**, **ai_route** без **`routeDescription`**) |
| Паритет TS/Python | Фикстуры **`schemas/test-fixtures/handle-*.json`**; тесты **`python/tests/test_handle_compatibility.py`**, **`ui/src/graph/handleCompatibility.test.ts`** |
| Статические **типы данных на портах** (фаза 1–2 F18, ориентир **Langflow** per-edge typing + **Dify** declarative overrides) | Закрытый перечень **`PortDataKind`**: **`any`** \| **`json`** \| **`primitive`**; базовая таблица по **`node.type`** + id ручки — **`ui/src/graph/portDataKinds.ts`**, **`ui/src/graph/portDataKindCompat.ts`** (матрица: **`any`** сочетается со всем; **`json`↔`primitive`** — предупреждение, без **`GraphStructureError`**). **Фаза 2:** опционально на ребре **`edges[].data.sourcePortKind`** / **`targetPortKind`** (только допустимые строки; иначе игнор и откат к таблице) — эффективные виды считаются в **`python/graph_caster/port_data_kinds.py`** (`effective_port_kind_for_*`, **`coerce_port_kind_override`**) и в UI **`handleCompatibility.ts`** (`coercePortKindOverride`); схема **`schemas/graph-document.schema.json`** `$defs.edgeData`. Слияние патчей в **`edges[].data`** (бакет схемы, **`coercePortKindOverride`** на **`prev`** и патче) — **`ui/src/graph/mergeGraphEdgeData.ts`**, Vitest **`mergeGraphEdgeData.test.ts`**. Те же правила предупреждений при run — **`find_port_data_kind_warnings`** в **`runner.py`**. Жёсткая проверка имён ручек без изменений. Тесты: **`portDataKinds.test.ts`**, **`portDataKindCompat.test.ts`**, **`handleCompatibility.test.ts`**, **`mergeGraphEdgeData.test.ts`**, **`python/tests/test_port_data_kinds.py`**. |

**Правила (MVP):** **`start`** — только **`out_default`**; **`exit`** — только **`in_default`**, без исходящих как источник; **`task`** / **`graph_ref`** — **`out_default`** \| **`out_error`** в исход, **`in_default`** в приём; **`merge`** — только **`in_default`** / **`out_default`**; **`comment`** — рёбра к комментарию не проверяются.

**Неизвестный `node.type`:** в TS и Python трактуется как исполняемая нода с теми же пинами, что **`task`** (исход **`out_default`** \| **`out_error`**, вход **`in_default`**), пока нет отдельного контракта типа.

**Дубликаты `nodes[].id`:** индекс **id → нода** в проверке ручек — последняя нода с таким **id**; отдельная валидация уникальности **id** в документе не входит в F18.

**`edges[].data` (F18 фаза 2):** ключи переопределения видов — только **camelCase** **`sourcePortKind`** / **`targetPortKind`** (`source_port_kind` и т.п. **не** читаются в Python и UI). Экспорт графа из канваса (**`fromReactFlow`**) записывает в документ по ребру лишь известные поля (**`routeDescription`**, валидные виды); иные ключи в **`edge.data`** после цикла «открыть → правка на полотне → сохранить» могут быть утрачены (см. описание **`$defs.edgeData`** в **`schemas/graph-document.schema.json`**). Патчи к **`data`** из редактора надо прогонять через **`mergeGraphEdgeData`**, чтобы не затирать соседние поля бакета (например **`routeDescription`** при смене видов порта).

**Сделано по сравнению с §15 (см. [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md)):** **фаза 2 F18** — декларативное переопределение **`PortDataKind`** на ребре (**`edges[].data.sourcePortKind` / `targetPortKind`**, ориентир **Dify** в JSON + **Langflow**-стиль эффективной пары на соединении); паритет UI/Python/runner, **`fromReactFlow` / `toReactFlow`**, **`$defs.edgeData`**, правила **camelCase** — в строке таблицы выше и в абзаце **`edges[].data`**. **Живой жест connect** (отказ несовместимого соединения, подсветка целей) — отдельная строка таблицы выше и раздел **Canvas / F1** (таблица больших графов).

**Остаток типизации портов (только планы/идеи для GC — [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) §15.2):** вид **`blob_ref`** и расширение **`PortDataKind`**; мультишины **n8n**; доменные типы **Comfy** (IMAGE/LATENT, …) — только при явном продуктовом домене медиа; новый **`kind`** ноды и набор портов — **§18** (**F15**) в competitive.

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
| Run-lock | При живых прогонах и/или очереди старта (**`runSession`**: `liveRunIds` / `pendingRunCount`) snapshot/undo/redo отключены; кнопки disabled |

**Сделано / инварианты из §21.2 (бывший план):** совместимость с **`parseDocument` / `toReactFlow` / `fromReactFlow`** (единый канон JSON); пакетное удаление — один проход RF → один `remove` batch → один checkpoint; autosave после undo пишет откатанное состояние; run-lock согласован с политикой UX.

**Не сделано** (см. [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) **§21**; **co-edit / F22** — **§28.2** п.10): отдельная история **viewport**; отдельные **команды** с `apply`/`revert` per op (как в **Dify**); конфликт «файл на диске изменён снаружи» при autosave; **Yjs** для undo при **F22**.

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

**Не копируем целиком** n8n **`ExecutionPushMessage`**, их redaction / **`flattedRunData`**. **Dev-брокер:** **SSE** и **WebSocket** с **`viewerToken`** (сессия подписки, аналог **`pushRef`**); **relay** кадров между процессами — **§39.2** п.7, отдельный прод-транспорт / инфраструктура хоста.

### Dev WebSocket и `run_transport` (§39 / n8n `pushRef`, факты для `COMPETITIVE_ANALYSIS.md`)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Отдельный канал «живого» прогона с секретом подписки (**`pushRef`**) | **`POST /runs`** возвращает **`viewerToken`**; **`GET /runs/{runId}/ws?viewerToken=…`** (алиас query **`pushRef`**); опц. **`GC_RUN_BROKER_TOKEN`** / заголовок **`X-GC-Dev-Token`** или **`token`** в query — как у HTTP middleware |
| Очередь старта при занятых слотах воркеров (отделение «приёма» от исполнения) | **`GC_RUN_BROKER_MAX_RUNS`**: лимит **живых** `Popen`; новые старты — **FIFO** pending (**`run_broker/registry.py`**), от **200** с **`runBroker.phase`**, **`runBroker.queuePosition`** (снимок при **`queued`**, без пересчёта при отменах впереди); индикаторная строка **`run_broker_queued`** — **`schemas/run-event.schema.json`**; **`GC_RUN_BROKER_PENDING_MAX`**, переполнение — исключение **`PendingQueueFullError`**, HTTP **503** **`pending_queue_full`** — **`python/README.md`**, **`python/tests/test_run_broker.py`** |
| Коды закрытия WS до **`accept`** | **`run_broker/app.py`**: **1008** — неверный dev-token; **4404** — неизвестный **`runId`**; **4401** — неверный **`viewerToken`** / **`pushRef`** (таблица в **`doc/RUN_EVENT_TRANSPORT.md`** §3) |
| Один NDJSON ↔ один кадр моста без второго enum **`type`** | **`python/graph_caster/run_transport/`**: **`frame_from_ndjson_line`**, **`ndjson_line_from_event`**; спека кадра и ping — **`doc/RUN_EVENT_TRANSPORT.md`**; зависимость **`jsonschema`** в основных зависимостях пакета (**`pyproject.toml`**) |
| Дуплекс (**cancel** как stdin CLI) | Входящие WS text JSON **`{ "type": "cancel_run", "runId": "…" }`** → отмена прогона (**`run_broker/app.py`**) |
| Веб-UI | **`VITE_GC_RUN_TRANSPORT=ws`** (иначе **SSE** по умолчанию); **`ui/src/run/webRunBroker.ts`**, **`webRunBrokerDispatch.ts`**, **`useRunBridge.ts`** |

Тесты: **`python/tests/test_run_event_frame.py`**, **`python/tests/test_run_broker.py`** (в т.ч. WS + неверный токен, очередь **`POST /runs`** vs лимит слотов и **503** при переполнении pending). В **`COMPETITIVE_ANALYSIS.md`** обзорный ряд **§39.1** для **GraphCaster** и **§3.2.1** («Для GC») ссылаются сюда вместо дублирования полного списка отличий от n8n **`ExecutionPushMessage`**.

### Слой события → транспорт и очередь шагов (срез **F6**, + опциональный пул после **fork**)

Сравнение продуктов по очередям прогонов, режимам **n8n** `queue`, **Dify**/**Comfy** и планирование межпрогонового параллелизма / моста (**§13.2–§13.3**) — в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) §**13**; ниже только то, что уже в коде **graph-caster**.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| **Langflow** — `EventManager.send_event` → буфер → выдача в HTTP | **`RunEventSink`** (`python/graph_caster/run_event_sink.py`): **`emit(event: RunEventDict)`**; CLI — **`NdjsonStdoutSink(write, flush)`**; обратная совместимость: **`Callable[[RunEventDict], None]`** → **`CallableRunEventSink`**; **`RunEventDict`** экспортируется из **`graph_caster`** |
| **Dify** — готовые к выполнению узлы в очереди движка (концепция) | **`StepQueue`** + **`ExecutionFrame(node_id)`** (`step_queue.py`): синхронный FIFO, один поток; следующая нода ставится после **`_follow_edges_from`**; отмена опрашивается в начале каждой итерации |
| **Comfy** — раздельные очереди исполнения и WebSocket | В GC одна цепочка: очередь визитов → события только через sink (расширение «буфер до медленного клиента» — **§39** / мост на стороне хоста) |

Тесты: `python/tests/test_run_event_sink.py`, `test_step_queue.py`, `test_runner_event_order_golden.py` (порядок `type` на `graph-document.example.json`).

---

## Реестр корневых прогонов и отмена (Dify `ExecutionCoordinator` / команды снаружи, n8n `executionId`)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Хост видит активные исполнения по стабильному id | `RunSessionRegistry`: `run_id` → `RunSession` (статус, `started_at` / `finished_at`, `cancel_event`) |
| Запрос остановки снаружи процесса обхода | `request_cancel(run_id)` → `threading.Event`; раннер проверяет между шагами (включая **`nesting_depth > 0`**); для `task` — опрос + **`proc.kill()`** во время стриминга stdout/stderr (см. **`process_output`** ниже); до **`process_spawn`** — без событий **`process_*`** |
| Один процесс, несколько клиентов UI / потоков | `get_default_run_registry()` — ленивый синглтон; CLI: `run --track-session` |
| Канал команд в тот же процесс (аналог Dify `CommandChannel` / in-memory) | CLI: **`run --control-stdin`** (с **`--track-session`**) — строки NDJSON: `{"type":"cancel_run","runId":"<uuid>"}`; опционально **`--run-id`**; отладка JSON: **`GC_CONTROL_STDIN_DEBUG=1`** |
| Синглтон реестра | **`reset_default_run_registry()`** для тестов / сброса процесса |
| Повторное использование `context` | В **`_prepare_context`** сбрасываются **`_gc_process_cancelled`** и **`_run_cancelled`** |
| Нить **`communicate`** после **`kill`** | **`RuntimeWarning`**, если join не завершился за таймаут |
| Прерывание воркера при abort (как остановка шага у n8n) | Подпроцесс **`task`**: поток + `proc.kill()` при отмене; событие **`process_complete`** с **`cancelled: true`** |
| Итог прогона с отменой | `run_finished.status`: **`cancelled`**; флаг **`_gc_process_cancelled`** → **`_run_cancelled`**, проброс из вложенного **`graph_ref`** |

Код: `python/graph_caster/run_sessions.py`, `graph_caster.__main__` (**`--track-session`**, **`--control-stdin`**, **`--run-id`**), `process_exec._communicate_with_cancel`, опция `GraphRunner(..., session_registry=…)`, порядок: регистрация сессии **до** `run_started`, чтобы колбэки sink могли вызывать `request_cancel`. Вложенный **`GraphRunner`** получает тот же **`session_registry`** для общей сессии отмены.

**Сопоставление с §3.2 competitive doc (Dify / n8n):** срез **«команда abort / адресация исполнения по id»** сведён сюда (`CommandChannel` у Dify — полноценный pause/redis; у GC пока in-process + stdin). **`IRunExecutionData` / `executionId`** у n8n — частичный параллель: реестр **`RunSessionRegistry`** и стабильный **`runId`** на событиях; **без** очереди ready-nodes. В **веб-режиме (dev)** поток событий — локальный брокер **`serve`**: по умолчанию **SSE**; опционально **WebSocket** (**`VITE_GC_RUN_TRANSPORT=ws`**, **`viewerToken`**) — **«Веб без Tauri»** ниже, **`doc/RUN_EVENT_TRANSPORT.md`**. Полный n8n-канал **`/push`**, prod-**relay** и тяжёлая redaction — **§39** `COMPETITIVE_ANALYSIS.md`. **Десктоп:** мост без WS — см. раздел ниже.

---

## Стабильный `runId` на строках NDJSON (канон; **§3.7** в `COMPETITIVE_ANALYSIS.md` — краткий обзор и эталоны)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Один идентификатор на весь прогон (**`prompt_id`** Comfy, **`workflow_run_id`** Dify, **`executionId`** n8n) | Поле **`runId`** в объектах NDJSON корневого прогона; вложенные **`graph_ref`** используют **тот же** **`runId`**, что и корень |
| Контракт и проверки | **`schemas/run-event.schema.json`**: описание корня, **`allOf`** с обязательным **`runId`** для ключевых **`type`** (**`run_started`**, **`run_finished`**, …) |
| Транспорт в UI (фаза 8) | Десктоп: **`run_bridge.rs`** → события с **`runId`**; веб: **SSE** или **WebSocket** к **`serve`** (те же NDJSON-строки в конверте WS — см. **`RUN_EVENT_TRANSPORT.md`**); **`runSessionStore`** по **`runId`**. **Prod**-relay — **§39** |

Код/тесты: `python/graph_caster/runner.py` (эмиссия с **`run_id`**), `python/tests/test_run_event_schema.py`. Эталоны очередей/буферов у конкурентов — по смыслу в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) **§3.6**–**§3.7**. **Полный перечень значений `type` и обязательных полей** — в подразделе ниже и в JSON Schema, без второй полной таблицы в competitive.

---

## NDJSON `run-event`: полный перечень `type` (v0.1, машиночитаемый контракт)

Единый реестр строк **`type`** из **`schemas/run-event.schema.json`** (закрытый **`enum`**). Обязательные поля по каждому типу — ветки **`allOf`/`if`/`then`** той же схемы. Паритет с раннером и примерами — **`python/tests/test_run_event_schema.py`**.

| Группа | `type` | Назначение (кратко) |
|--------|--------|---------------------|
| Жизненный цикл корня | **`run_started`**, **`run_finished`**, **`run_root_ready`**, **`run_success`**, **`run_end`** | Старт/финиш прогона, каталог артефактов, нормальный выход через **`exit`**, останов без **`exit`** |
| Нода | **`node_enter`**, **`node_execute`**, **`node_exit`** | Визит ноды; **`node_exit`**: опц. **`usedPin`** (short-circuit **`gcPin`**) |
| Ветвление (F4) | **`edge_traverse`**, **`branch_taken`**, **`branch_skipped`** | Выбранное ребро; явная ветвь; пропуск (**`condition_false`**, **`ai_route_not_selected`**) |
| Вложенный граф | **`nested_graph_enter`**, **`nested_graph_exit`** | **`graph_ref`**, тот же корневой **`runId`** |
| Вложенный **`graph_ref`**, изоляция процесса (опция) | Subprocess + NDJSON в тот же sink | **`GC_GRAPH_REF_SUBPROCESS=1`**: `python -m graph_caster run` на каждый заход в **`graph_ref`**; **`--context-json`** / **`--nested-context-out`** (внутренние детали); merge **`node_outputs`** и флагов в родительский контекст — **`nested_run_subprocess.py`**, тесты **`python/tests/test_nested_graph_subprocess.py`** |
| Подпроцесс **`task`** | **`process_spawn`**, **`process_complete`**, **`process_failed`**, **`process_output`**, **`process_retry`** | Запуск команды, исход, чанки stdout/stderr, ретрай по политике ноды |
| Транспорт (dev SSE) | **`stream_backpressure`** | Дроп **`process_output`** у медленного подписчика брокера (**`RunBroadcaster`**) |
| Статика / предупреждения | **`structure_warning`** | В т.ч. **`kind`**: merge/fork/barrier/**`fork_parallel_*`**/**`gc_pin_enabled_empty_payload`**/**`ai_route_*`** (см. **`validate.py`**, **`run-event.schema.json`**, UI) |
| Кэш и pin (F17 / n8n-style) | **`node_cache_hit`**, **`node_cache_miss`**, **`node_pinned_skip`**, **`node_outputs_snapshot`** | Comfy-style кэш шага; пропуск по pin; снимок выхода для UI |
| ИИ-маршрут (**`ai_route`**) | **`ai_route_invoke`**, **`ai_route_decided`**, **`ai_route_failed`** | Запрос к провайдеру, выбранная ветка, сбой маршрутизации |
| Инварианты | **`error`** | Жёсткая ошибка прогона / графа |

Источники эмиссии: **`python/graph_caster/runner.py`** (**`GraphRunner.emit`**), **`python/graph_caster/process_exec.py`**, **`python/graph_caster/nested_run_subprocess.py`** (проброс NDJSON дочернего CLI при **`GC_GRAPH_REF_SUBPROCESS`**), **`python/graph_caster/run_broker/broadcaster.py`** (**`stream_backpressure`**). Сопоставление с продуктами-референсами — только краткая таблица в **§3.7** [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md); детали реализации по группам — разделы выше и ниже в этом файле (**`process_output`**, **Backpressure SSE**, **F4**, **`ai_route`**, **`gcPin`**, F17).

---

## Инкрементальный вывод подпроцесса **`task`** (**`process_output`**, n8n/Flowise-style)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Живые логи шага (stdout/stderr) в UI до завершения команды | NDJSON **`type`:** **`process_output`**: **`stream`** **`stdout`** \| **`stderr`**, **`text`**, монотонный **`seq`** по потоку, опц. **`eol`**, **`attempt`**; на каждой строке **`runId`** (как у прочих событий корня) |
| Захват без блокирующего **`communicate()`** до конца | **`python/graph_caster/process_exec.py`**: потоки **`readline`** → очередь с **`maxsize`** (**backpressure**: **`put`** блокирует читатель при переполнении, основной цикл забирает через **`get(timeout)`**, без **`sleep`** между порциями — нет взаимной блокировки с потребителем); таймаут и **`should_cancel`**; хвосты — потолок **`_STDOUT_CAP`** для **`process_complete`** и **`node_outputs`** |
| Поведение по строкам | События по **`readline`**: вывод без **`flush()`**/перевода строки может появляться в UI с задержкой до завершения строки или процесса |
| Контракт | **`schemas/run-event.schema.json`** (ветка **`process_output`**) |
| Консоль UI | Сырые строки NDJSON в сторе; отображение: **`buildConsoleLineMeta`** (`ui/src/run/consoleLineMeta.ts`) — читаемые строки **`[nodeId] …`** и префикс **`[stderr]`** для потока stderr |
| Сводная таблица **`type` (GC)** в competitive | В **§3.7** [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) — краткий обзор и аналоги у n8n/Dify; **полный enum и обязательные поля** — подраздел **«NDJSON `run-event`: полный перечень `type`»** выше и **`schemas/run-event.schema.json`**; **`process_output`** / **`stream_backpressure`** — также этот файл |
| Два уровня буфера (**§13.3** / **§39.2** у конкурентов) | **Ядро:** **`process_exec`** — очередь **`readline` → emit** с **`maxsize`** (этот раздел). **Транспорт (dev):** **`RunBroadcaster`** — **«Backpressure SSE»** и подраздел **Evidence** ниже. **Prod** / relay / политика хоста — [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) **§39.2** п.7 и п.6 |

Код/тесты: `process_exec.py`, `test_run_event_schema.py`, **`python/tests/test_process_exec_streaming.py`**, Vitest **`consoleLineMeta.test.ts`**.

---

## Десктоп (Tauri): мост UI ↔ Python Run (фаза 8, паттерн как у Flowise/n8n — один канал на прогон)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Один логический поток событий на исполнение (`executionId` / SSE-канал) | Подпроцесс `python -m graph_caster run`: **NDJSON в stdout/stderr**; тот же контракт, что у CLI; **`runId`** согласован с раннером |
| Остановка с хоста | **Cancel:** запись строки NDJSON в **stdin** процесса (`--control-stdin`): `{"type":"cancel_run","runId":"…"}` — см. раздел про реестр выше |
| Редактор запускает раннер локально | **Tauri 2:** `ui/src-tauri/src/run_bridge.rs` — `get_run_environment_info`, `gc_start_run`, `gc_cancel_run`, **`gc_list_persisted_runs`**, **`gc_read_persisted_events`**, **`gc_read_persisted_run_summary`**; временный JSON документа (уникальное имя в `%TEMP%` / `$TMPDIR`), argv: `-d`, `--track-session`, `--control-stdin`, `--run-id`, опционально `-g`, `--artifacts-base`, **`--no-persist-run-events`**, **`--until-node`**, **`--context-json`** |
| Стрим в UI | События **`gc-run-event`** (`runId`, `line`, `stream`: stdout \| stderr), **`gc-run-exit`** (`runId`, `code`); на фронте маршрутизация по **`runId`**, фокус влияет на консоль и побочные эффекты канваса |
| **Обрыв воркера (n8n worker / Flowise queue — нормализация финала)** | Если процесс **`graph_caster run`** завершился **без** «штатного» **`run_finished`** для данного **`runId`**, **Tauri** и dev-**брокер** после **`wait`** дописывают одну synthetic строку NDJSON: **`type`:** **`run_finished`**, **`status`:** **`failed`**, **`reason`:** **`coordinator_worker_lost`**, **`coordinatorWorkerLost`:** **`true`**, **`workerProcessExitCode`**, **`rootGraphId`** из последнего **`run_started`** на stdout или **`unknown`**. **Штатный финал** (synthetic **не** вставляется): **`run_finished`** с **`status`** ∈ {success, failed, cancelled, partial} и тем же **`runId`** (в JSON допускаются строка или целое число); одно правило в **`run_broker/worker_lost.py`** и **`run_bridge.rs`**. Код: **`run_broker/worker_lost.py`**, **`run_broker/registry.py`**, **`run_bridge.rs`**; схема **`schemas/run-event.schema.json`**; фикстура **`schemas/test-fixtures/coordinator-worker-lost-run-finished.json`**; тесты **`python/tests/test_run_broker_worker_lost.py`**, **`ui/src/run/coordinatorWorkerLostRunEvent.test.ts`**. Отмена **`POST …/cancel`** при отсутствии активного run — **404** (как «нет процесса»). |
| Консоль и полотно | `ui/src/run/*` (`useRunBridge`, `runSessionStore`, `parseRunEventLine`, `runCommands`, `consoleLineMeta` для **`process_output`**), `ConsolePanel`, `AppShell` (Run/Stop, блокировка структуры при прогоне или очереди), подсветка ноды по `node_enter` / `node_execute` для сфокусированного прогона |
| Окружение | **`GC_PYTHON`**, **`GC_GRAPH_CASTER_PACKAGE_ROOT`** → `PYTHONPATH`; **`GC_TAURI_MAX_RUNS`** (1–32, по умолчанию **2**) — лимит одновременных дочерних `run` в Tauri; проверка `import graph_caster` при старте UI (кэш сессии + `invalidateRunEnvironmentInfoCache` в `runCommands.ts`) |
| Веб без Tauri | **`python -m graph_caster serve`** (опц. **`[broker]`**): **SSE** `text/event-stream` и **WebSocket** **`GET …/runs/{runId}/ws?viewerToken=`** (ответ **`POST /runs`** содержит **`viewerToken`**; алиас **`pushRef`**); опц. **`POST /webhooks/run`** (подписанный push-старт, **`GC_RUN_BROKER_WEBHOOK_SECRET`**) — подраздел **«Push webhook…»** ниже, **`python/README.md`**; конверт кадров и **`cancel_run`** по сокету — **`doc/RUN_EVENT_TRANSPORT.md`**; **`graph_caster.run_transport`** (NDJSON ↔ **`{runId, event}`** для валидных **`run-event`**). Vite **`/gc-run-broker`** → брокер; UI: `webRunBroker.ts`, **`webRunBrokerDispatch.ts`**, **`VITE_GC_RUN_TRANSPORT`** (`sse` \| **`ws`**), `runCommands.ts`, прокси в `vite.config.ts`; опц. **`GC_RUN_BROKER_TOKEN`** / **`VITE_GC_RUN_BROKER_TOKEN`**; **`GC_RUN_BROKER_MAX_RUNS`**; Python: `graph_caster/run_broker/`; см. `ui/README.md`, `python/README.md`; тесты: `python/tests/test_run_broker.py`, **`test_run_broker_webhook.py`**, **`test_run_event_frame.py`**, `test_run_broker_registry.py`, **`test_run_broker_worker_lost.py`** |
| **Backpressure SSE (dev-брокер)** | У каждого подписчика **`RunBroadcaster`** — **`queue.Queue(maxsize=…)`** (**`GC_RUN_BROKER_SUB_QUEUE_MAX`**, по умолчанию **8192**, clamp **64…131072**; в **`RunBroadcasterConfig`** значения **`max_sub_queue_depth` ≤ 0** нормализуются до **1**). События **`process_output`** в stdout при переполнении **отбрасываются** (новый кадр). **Не-JSON** строки и **битый** JSON (не распознанный как объект события) при переполнении **тоже** отбрасываются, чтобы произвольный текст не блокировал очередь. **`run_finished`**, **`run_started`**, прочий NDJSON и **`err`/`exit`** — **не** отбрасываются: блокирующий **`put`** per-подписчик даёт backpressure на чтение stdout подпроцесса; **без** глобального лока на весь `broadcast` на время `put`. При **≥2** подписчиках доставка — **общий** **`ThreadPoolExecutor`** + **`concurrent.futures.wait`** (один «медленный» не блокирует остальных). **`stream_backpressure`**: сначала **`put_nowait`**, при полной очереди — короткий **`put`** (**~0,35 s**, без глобального лока `broadcast`); при неудаче счётчик восстанавливается; throttle **~100 ms** на подписчика; счётчики дропа под **`bp_lock`**. Схема **`schemas/run-event.schema.json`**. Консоль UI: **`app.run.console.outputTruncated`**. Расширенный Evidence (пути, тесты, детали политики) — подраздел **ниже**. **Prod** / relay / WS **`pushRef`** — только планирование в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) **§39.2** (п.7 и п.6 — остаток для хоста). Код: **`python/graph_caster/run_broker/broadcaster.py`**, `registry.py`; тесты: **`python/tests/test_run_broker_backpressure.py`**, `test_run_event_schema.py` |

### Backpressure SSE и ядро `process_exec` — Evidence

Срез **§13.3** / **§39.2** у конкурентов: **dev `serve` (**SSE** + **WebSocket** + **`viewerToken`**) реализован здесь и в **`doc/RUN_EVENT_TRANSPORT.md`**; **prod**-**relay** между процессами — [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) **§39.2** п.7 (хост приложения / оркестратор).

| Тема | Реализация |
|------|------------|
| Классификация droppable stdout | `python/graph_caster/run_broker/broadcaster.py` — **`_is_droppable_out_line`**: один **`json.loads`**, признак **`type == "process_output"`**; не-JSON и битый JSON — droppable. Регрессия: **`test_is_droppable_uses_type_not_substring`** в **`python/tests/test_run_broker_backpressure.py`**. |
| Пул доставки при выходе процесса | **`ThreadPoolExecutor.shutdown(wait=False, cancel_futures=True)`** (fallback без **`cancel_futures`** на старых Python). |
| Интервал **`stream_backpressure`** | **`RunBroadcasterConfig.backpressure_emit_interval_sec`** (по умолчанию **0,1** с); **0** отключает троттлинг между предупреждениями. |
| Env и описание `serve` | **`python/README.md`** — **`GC_RUN_BROKER_SUB_QUEUE_MAX`**, интервал backpressure, shutdown пула. |
| Поиск в консоли по предупреждению | **`ui/src/run/consoleLineMeta.ts`** — **`STREAM_BACKPRESSURE_SEARCH_EXTRA`**, **`consoleLineMatchesSearch`** при **`streamBackpressureDropped`**. |

### Несколько корневых прогонов с хоста (очередь FIFO, cap параллелизма)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| **n8n** / **Flowise** — несколько исполнений, лимит параллелизма, очередь | UI: **`runSessionStore`** — порядок живых **`runId`**, FIFO **`pendingStarts`**, потолок **`gc.run.maxConcurrent`** в **`localStorage`** (1–32, по умолчанию 2, согласовать с **`GC_*_MAX_RUNS`**); кнопка **Run** остаётся доступной при полном cap (постановка в очередь); **Stop** отменяет **сфокусированный** живой прогон; селектор фокуса при 2+ живых; снимки вывода нод (`node_outputs_snapshot`) и активная нода для подсветки кешируются отдельно по каждому `runId`; инспектор и канвас отражают сфокусированный прогон |
| Защита брокера и Tauri от лишних процессов | См. **`GC_RUN_BROKER_MAX_RUNS`**, **`GC_TAURI_MAX_RUNS`** в строках окружения выше; ответ брокера **400** при **`max concurrent runs reached`** |
| Тесты | `ui/src/run/runSessionStore.test.ts`; **`test_run_broker_rejects_when_max_concurrent_reached`** в `python/tests/test_run_broker.py` |

### Push webhook старта Run (**F9**, dev broker)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| **GitHub** **`X-Hub-Signature-256`**, **Stripe** **`Idempotency-Key`**, **n8n** webhook как вход без отдельной ноды в open core | **`POST /webhooks/run`** в **`graph_caster serve`**: HMAC-SHA256 **сырого** тела, заголовок **`X-GC-Webhook-Signature`** (**`sha256=<hex>`**); опционально **`X-GC-Idempotency-Key`** (in-memory, TTL **15** мин, max **1024** записей); тот же **`spawn_from_body`**, что **`POST /runs`** |
| Не смешивать с dev session token | **`BrokerTokenMiddleware`** **не** применяется к **`/webhooks/run`** при включённом **`GC_RUN_BROKER_TOKEN`** |
| Без секрета webhook | Маршрут отвечает **404** **`webhook_not_configured`** (эндпоинт зарегистрирован, режим выключен) |

Код: **`python/graph_caster/run_broker/webhook_signature.py`**, **`idempotency.py`**, **`app.py`**; тесты **`python/tests/test_run_broker_webhook.py`**; операторская документация **`python/README.md`**.

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

**Связь с F17:** отладочный partial — в таблице выше; закрепление вывода в документе (**`gcPin`**) — подраздел ниже; межпрогонный кэш выходов **`task`**, **`mcp_tool`**, **`llm_agent`**, **`ai_route`** (headless) — ещё ниже.

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

**Поведение при родительском `graph_ref`:** открытие целевого графа из инспектора ведёт стек **`parentWorkspaceFileName` + `graphRefNodeId`** (кадр добавляется **только** после успешной загрузки JSON; при ошибке чтения/парса стек не засоряется). При пометке **dirty** (данные ноды, ребро, кнопка «Mark dirty») дочерний документ помечается как обычно, плюс **bubble**: последовательная цепочка `Promise`, снимок стека на момент пометки, с диска читаются родительские JSON и для каждого **`graph_ref`** на пути вызывается **`markStepCacheDirtyTransitive`**. В **`runner.py`** во вложенном прогоне задаётся **`_parent_graph_ref_node_id`**; **`task`** / **`mcp_tool`** / **`ai_route`** с F17 получают **`node_cache_miss` / `reason: dirty`**, если **`dirty_nodes`** содержит **id родительской ноды `graph_ref`** (нет ложных совпадений id между разными файлами). *Ограничение:* bubble опирается на содержимое файлов воркспейса на диске.

Код/UI: `ui/src/run/nestedStepCacheDirtyBubble.ts`, `AppShell.tsx`, `InspectorPanel.tsx`; `python/graph_caster/runner.py` (**`_execute_graph_ref`**). Тесты: **`test_step_cache_dirty_parent_graph_ref_forces_nested_miss`** в `test_runner_step_cache.py`, Vitest **`nestedStepCacheDirtyBubble.test.ts`**.

**Открытые темы F17** (не вложенность; в [COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) **§22.2** — планирование остатка): step-cache для типов нод **помимо** **`task`**, **`mcp_tool`** и **`ai_route`** (таблица выше); TTL и лимиты каталога кэша; отдельный продуктовый тоггл step-cache на полотне.

### Ревизия вложенного graph_ref в ключе step-cache (F17 × §36.2)

Сводка в конкурентном документе: [COMPETITIVE_ANALYSIS.md](COMPETITIVE_ANALYSIS.md) **§36.1** (строка GraphCaster), **§36.2** п.2 (пункт закрыт в пользу этой реализации).

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Comfy / n8n: смена вложенного подграфа инвалидирует downstream-шаги родителя | При входе в **`graph_ref`** в **`context`** накапливается **`_gc_nested_doc_revisions`**: ключ **`targetGraphId`**, значение **`graph_document_revision`** загруженного **`GraphDocument`** (инвариант workspace — один файл на id). Для **`task`** / **`mcp_tool`** / **`llm_agent`** / **`ai_route`** с **`data.stepCache`**: в материал **`upstream_step_cache_fingerprint`** (и далее **`compute_step_cache_key`**) входят отсортированные пары **`(id предка graph_ref, revision_hex)`** для каждого прямого предка типа **`graph_ref`**. Пустой список пар сохраняет прежнюю семантику отпечатка только по выходам предков |
| Паритет in-process и **`GC_GRAPH_REF_SUBPROCESS=1`** | Ключ **`_gc_nested_doc_revisions`** в **`NESTED_CONTEXT_INPUT_KEYS`**; запись в **`--context-json`** дочернего CLI и мерж в **`__main__._merge_context_json`** |

Код: **`python/graph_caster/runner.py`** (**`_prepare_context`**, **`_graph_ref_upstream_revision_pairs`**, **`_execute_graph_ref`**), **`python/graph_caster/node_output_cache.py`** (**`upstream_step_cache_fingerprint`**, **`compute_step_cache_key`**), **`python/graph_caster/nested_run_subprocess.py`**, экспорт в **`graph_caster/__init__.py`**. Тесты: **`python/tests/test_runner_step_cache.py`** (**`test_step_cache_child_file_change_invalidates_parent_downstream_task`** и др.), **`test_nested_graph_subprocess.py`** (**`test_write_nested_context_json_propagates_nested_doc_revisions`**), **`test_node_output_cache.py`**. Документация: **`python/README.md`** (абзац F17 про пары graph_ref).

### Межпрогонный кэш выходов **`task`**, **`mcp_tool`**, **`llm_agent`** и **`ai_route`** (F17 — ключ в духе Comfy + **dirty** в духе n8n)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Comfy: стабильная сигнатура входов + состояние графа | **`graph_document_revision(doc)`** — SHA-256 канонического снимка документа (ноды, рёбра, **`data`**); участвует в **`compute_step_cache_key`** вместе с **`graphId`**, id ноды, полем **`nk`** (**`task`** \| **`mcp_tool`** \| **`llm_agent`** \| **`ai_route`**), **`node_data_for_cache_key`** (без флага **`stepCache`**) и **`upstream_step_cache_fingerprint`** / **`upstream_outputs_fingerprint`** (SHA-256 от нормализованного среза **`node_outputs`** предков по входам не из **`out_error`**, плюс при необходимости пары ревизий для предков **`graph_ref`** — см. подраздел **«Ревизия вложенного graph_ref…»** выше) — без встраивания полного среза в JSON ключа |
| n8n: принудительное перевыполнение выбранных нод | **`StepCachePolicy.dirty_nodes`**; CLI **`--step-cache-dirty`**; событие **`node_cache_miss`** с **`reason: dirty`** |
| n8n: **`dirtyNodeNames`** / транзитивная инвалидация при partial | **Десктоп:** по успешным рёбрам (не **`out_error`**), как предки в ключе F17 в **`runner.py`**; в очередь попадают **`task`**, **`mcp_tool`**, **`llm_agent`** и **`ai_route`** с **`data.stepCache`** truthy; кнопка «Mark dirty» берёт граф с канваса (**`exportDocument`**); **`onApplyNodeData`** вызывает замыкание только для исполняемых типов (не **`comment`**); смена **`condition`** ребра и новое ребро — seed **`source`**; лог консоли: дельта **`+N`** и полная очередь; открытие вложенного графа по **`graph_ref`** накапливает стек для **bubble** **dirty** на предков (файлы воркспейса с диска) |
| Персистентность | **`StepCacheStore`** под **`artifacts_base`**: **`runs/<graphId>/step-cache/v1/<shard>/<key>.json`**; опция **`context["tenant_id"]`** — опциональный суффикс ключа |
| Чтение с диска | **`StepCacheStore.get`**: для **`task`** и **`mcp_tool`** — только **`processResult.success`** / **`mcpTool.success`** строго **`true`**; для **`llm_agent`** — **`processResult.success`** и **`agentResult.success`** строго **`true`**; для **`ai_route`** — валидный **`aiRoute`** (`choiceIndex`, `edgeId`) и проверка против текущих исходящих рёбер; иначе **`None`** (промах) |
| Смена формата ключа (**`nk`**) | Поле **`nk`** в материале SHA-256 разделяет **`task`**, **`mcp_tool`**, **`llm_agent`** и **`ai_route`**; файлы в **`step-cache/v1/`**, записанные версией без **`nk`**, больше не совпадают с ключом — ожидаемые промахи до перепрогона (**`python/README.md`**, F17) |
| Узел участвует только явно | Поле **`data.stepCache`** truthy у ноды **`task`**, **`mcp_tool`**, **`llm_agent`** или **`ai_route`**; без флага при включённой политике кэш-событий нет |
| Наблюдаемость | **`node_cache_hit`**, **`node_cache_miss`**; при hit **`mcp_tool`** — **`mcp_tool_result`** с **`fromStepCache`** (**`schemas/run-event.schema.json`**); при hit **`ai_route`** — **`ai_route_decided`** с теми же **`choiceIndex`** / **`edgeId`**, без **`ai_route_invoke`**; **`keyPrefix`** — 16 hex |
| **Десктоп (Tauri):** явный **`--step-cache`** / **`--step-cache-dirty`** как у n8n **`dirtyNodeNames`** | Панель **Run**: чекбокс «Step cache» (требует непустой корень воркспейса = **`--artifacts-base`**); бейдж — число id в очереди **dirty**. Очередь **dirty** очищается после **успешного** старта run (нет исключения **`invoke`**); **`--step-cache`** в Rust не добавляется без непустого **`artifacts_base`**. Пустой путь артефактов сбрасывает чекбокс Step cache. **`InspectorPanel`** для **`task`**, **`mcp_tool`**, **`llm_agent`** и **`ai_route`**: **`data.stepCache`**, кнопка «Mark dirty for next run» (транзитивно). **`run_bridge.rs`** → **`gcStartRun`** (`run/runCommands.ts`). Состояние очереди: **`run/stepCacheDirtyStore.ts`** (**`markStepCacheDirtyTransitive`**); граф — **`graph/stepCacheDirtyGraph.ts`** (в т.ч. **`mcp_tool`**, **`llm_agent`**, **`ai_route`**); на ноде — бейдж **`C`** в **`GcFlowNode`**. Локальное сохранение намерения кэша: **`localStorage`** **`gc.run.stepCacheEnabled`** |

Код: `python/graph_caster/document_revision.py`, `node_output_cache.py`, `runner.py`, `__main__.py`; `ui/src-tauri/src/run_bridge.rs`, `ui/src/run/runCommands.ts`, `ui/src/run/stepCacheDirtyStore.ts`, `ui/src/run/nestedStepCacheDirtyBubble.ts`, `ui/src/graph/stepCacheDirtyGraph.ts`, `ui/src/layout/AppShell.tsx`, `ui/src/components/TopBar.tsx`, `ui/src/components/InspectorPanel.tsx`, `ui/src/components/nodes/GcFlowNode.tsx`. Тесты: `test_document_revision.py`, `test_node_output_cache.py`, `test_runner_step_cache.py` (в т.ч. вложенный **`graph_ref`** + **dirty** родителя и **`llm_agent`** F17), **`test_mcp_tool_node.py`** (step-cache **`mcp_tool`**), `test_run_event_schema.py`, `test_cli_main.py`; Vitest **`stepCacheDirtyGraph.test.ts`**, **`stepCacheDirtyStore.test.ts`**, **`nestedStepCacheDirtyBubble.test.ts`**. Документация CLI: `python/README.md`.

**Сводка для [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) §22.2:** межпрогонный step-cache под **`artifacts_base`** для нод **`task`**, **`mcp_tool`**, **`llm_agent`** (успешные **`processResult`** + **`agentResult`**) и **`ai_route`** при **`data.stepCache`** (провайдер / test-harness — см. таблицу выше); транзитив **`dirty`** и **bubble** во вложенном **`graph_ref`** — в подразделе **«Ревизия вложенного `graph_ref`…»** выше; связь **`--context-json`**, **`gcPin`**, **`node_outputs_snapshot`** — в отдельных разделах этого файла. Детали перечисления «закрыто» — **только здесь**, не в competitive.

Политика **dirty** в UI: id попадают в **`--step-cache-dirty`** при следующем успешном **`invoke` `gc_start_run`** (процесс Python стартовал); при ошибке старта список **не** очищается. Идентификаторы нод не должны содержать **`,`** (формат CSV в CLI).

---

## Консоль наблюдаемости (**F13**, фаза 7)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| n8n / Dify: фильтрация и фокус на проблемных строках в ленте execution | Режимы **все / stderr / ошибки**; эвристика **`isErrorLike`**: stderr-префикс, события **`error`**, **`run_finished`** с **`status`** **`failed`**, **`process_complete`** с **`success: false`** или **`reason`** **`spawn_error`**, **`run_end`** с **`reason`** **`no_outgoing_or_no_matching_condition`**, подстроки **`"status":"failed"`** / **`"status": "failed"`** в **сырой** строке (в т.ч. в тексте хоста — намеренно грубо для dev-консоли) |
| Langflow: поиск по буферу | Поле поиска (substring, без учёта регистра) по полному буферу, пересечение с активным фильтром |
| Чтение середины лога без «срыва» вниз при новых событиях | **Sticky tail:** автопрокрутка в конец, если пользователь у низа (**в т.ч. после смены фильтра или поиска**); кнопка **Latest** / **В конец** снова приклеивает хвост |
| Переход к ноде из события | Клик (или Enter/Space) по строке с **`nodeId`**; для **`branch_taken`** / **`branch_skipped`** берётся **`fromNode`** как источник фокуса; **`aria-label`** и **`aria-pressed`** у фильтров; к выбору в инспекторе и **`fitView`** на ноду (`GraphCanvasHandle.focusNode`) |
| n8n / Dify / Langflow: статусы нод на полотне во время execution | Редьюсер **`run-event` → фазы нод** (**`nodeRunOverlay.ts`**), инкрементально в **`applyRunnerNdjsonSideEffects`** / стор **`runSessionStore`** (раздельно по **`runId`** и по ключу replay); **`GraphCanvas`** — классы **`gc-node--run-running|success|failed|skipped`**, подсветка «текущей» ноды без записи оверлея — **`gc-node--run-active`** (**`runHighlightNodeId`**); кэш **`graphDocumentToFlow`** в **`useMemo`** (**`flowFromDocument`**) для снижения пересчёта при обновлении оверлея; **`GcFlowNode`** — **`app.run.overlay.*`** (**title** / **`aria-label`**) |
| Экспорт | **Export** сохраняет **видимые** строки (после фильтра и поиска); **Export all** / **Весь лог** — полный буфер, когда включён фильтр или непустой поиск |
| Тесты | `ui/src/run/consoleLineMeta.test.ts`, `ui/src/run/nodeRunOverlay.test.ts`, `ui/src/run/parseRunEventLine.test.ts` (**`peekRootGraphIdFromNdjson`**) (Vitest) |

Код: `ui/src/run/consoleLineMeta.ts`, `ui/src/run/nodeRunOverlay.ts`, `ui/src/run/runEventSideEffects.ts`, `ui/src/run/runSessionStore.ts`, `ui/src/run/parseRunEventLine.ts`, `ui/src/components/ConsolePanel.tsx`, `ui/src/components/GraphCanvas.tsx`, `ui/src/components/nodes/GcFlowNode.tsx`, `ui/src/layout/AppShell.tsx`, стили консоли и оверлея в `ui/src/styles/app.css`, i18n `app.console.*`, `app.run.overlay.*`.

---

## Персистентный журнал прогона / execution history (file-first, срез **F13**)

Сравнение с n8n **`executionId`** / Dify persisted run / Flowise **`Execution`** — в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md) **§17**; здесь только реализация GC.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Список прошлых прогонов и просмотр логов без live-run | При **`--artifacts-base`**: **`events.ndjson`** (все события NDJSON, включая **`run_root_ready`**) и **`run-summary.json`** (**`schemaVersion`**: 1, **`runId`**, **`status`**, таймстампы); отключение: **`--no-persist-run-events`** |
| Тот же поток, что в stdout, не терять при сбое диска на вторичном приёмнике | **`TeeRunEventSink`**: сначала основной sink; **`OSError`** на файловой ветке не рвёт прогон после успешного stdout |
| Хост читает файлы без path-escape | Tauri: **`canonicalize`** + проверка префикса **`runs/<graphId>/`**; чтение с потолком размера (**16 MiB** для хвоста **`events`**) |
| Веб (dev) и десктоп | Брокер **`POST /persisted-runs/list`**, **`events`** (ответ **`text`**, **`truncated`**; **`maxBytes`** ≤ **16 MiB**), **`summary`**; UI модалка **History**, replay в консоль (offline) **и тот же оверлей нод на канвасе**, i18n при **`truncated`**; при несовпадении **`rootGraphId`** из первого **`run_started`** в тексте лога и id открытого графа — строка предупреждения в консоли (**`peekRootGraphIdFromNdjson`**, **`app.runHistory.replayGraphIdMismatch`**) |

Код: `run_event_sink.py`, `artifacts.py`, `runner.py`, `run_broker/app.py`, `run_bridge.rs`, `RunHistoryModal.tsx`, `run/runCommands.ts`, `run/runEventSideEffects.ts`, `run/parseRunEventLine.ts`, `run/nodeRunOverlay.ts`, `webRunBroker.ts`. Сводка жизненного цикла артефактов рана — подраздел «Связанные артефакты run» ниже.

---

## MiniMap и панель управления полотном (навигация, @xyflow)

Пункт **§28.2** п.4 «мини-карта» в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md): в таблице **F1** — без дублирования реализации; перечень «уже закрыто» и отсылка к маске/рамке вьюпорта — также §1 и строка **GraphCaster** у **F1** в том файле. **Факты мини-карты** (в т.ч. **`minimapChrome.ts`**, **цвет по типу ноды**, **`minimapNodeColors.ts`**, оверлей рана на executable-нодах) — **только здесь**, в таблице ниже. **Производительность очень больших графов** (волна **onlyRenderVisible** + оверлей + рёбра) и **ленивое превью `graph_ref`** — раздел **«Canvas: большие графы»** выше. Статус **F1** «**частично**» в competitive — из‑за **остатка** (**§15**, **§29**); не миникарта и не п.7 **`group`** (опциональный **ghost** off-viewport — в таблице выше).

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| **n8n** / **Dify** / **Langflow** — обзорная миникарта и кнопки масштаба | Виджеты **`MiniMap`** (**`pannable`**, **`zoomable`**) и **`Controls`** (**zoom in/out**, **fit view**, переключатель интерактивности) из **@xyflow/react** на **`GraphCanvas`** (`ui/src/components/GraphCanvas.tsx`); подписи **`aria-*`** через **`reactFlowTranslations`** и **`app.canvas.flowControls.*`** (локали **en/ru**) |
| Те же продукты — затемнение области вне вьюпорта и явная рамка вьюпорта на миникарте (как в **React Flow** `maskColor` / `maskStrokeColor`) | Пропсы **`bgColor`**, **`maskColor`**, **`maskStrokeColor`**, **`maskStrokeWidth`** на **`MiniMap`**: **`minimapChromeForTheme`** (`ui/src/graph/minimapChrome.ts`), выбор light/dark по **`usePrefersColorSchemeDark`** (`ui/src/lib/usePrefersColorSchemeDark.ts`); палитра согласована с **`tokens.css`** (**`--gc-surface-1`**, рамка: **`--gc-accent`** в light, **`--gc-accent-hover`** в dark для контраста); Vitest **`minimapChrome.test.ts`** |
| Те же продукты — цвет прямоугольников миникарты по типу ноды (как у **React Flow** `nodeColor`) | Колбэки **`nodeColor`** / **`nodeStrokeColor`** на **`MiniMap`**: **`minimapNodeFill`** / **`minimapNodeStroke`** (`ui/src/graph/minimapNodeColors.ts`) — палитра согласована с **`app.css`** (бордеры **`.gc-flow-node--*`**); **comment** / **group** — приглушённые заливки; при **`data.runOverlayPhase`** на **исполняемых** нодах — лёгкий оттенок фазы рана (фреймы **comment** / **group** без оверлей-тинта); Vitest **`minimapNodeColors.test.ts`** |

Код: `GraphCanvas.tsx`, **`minimapChrome.ts`**, **`minimapNodeColors.ts`**, `app.css` (классы полотна при необходимости), локали **`app.canvas.flowControls`**.

---

## Меню «Добавить ноду» на полотне (ПКМ; категории как у n8n / Langflow)

Пункт **§28.2** п.6 в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md): факт реализации только здесь; в competitive — ссылка без дублирования таблиц.

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| **n8n** / **Langflow** — палитра с группами и поиском | **ПКМ** на полотне → **`CanvasAddNodeMenu`**: чипы **Все / Поток / Запуск и ИИ / Вложенные / Заметки** (**`ADD_NODE_CATEGORY_ORDER`**) плюс поле **фильтра** по подстроке (**id** ноды и локализованный ярлык); категория **«Вложенные»** показывает только строки **`graph_ref`** из индекса **`graphs/`** (при пустом workspace — отдельное сообщение) |
| Согласованность с одной **`start`** | **`hasStartNode`** скрывает **`start`** во всех категориях, где он в базовом списке |

Код: **`ui/src/graph/addNodeMenu.ts`** (**`computeAddNodeMenuLists`**), **`CanvasAddNodeMenu.tsx`**, Vitest **`addNodeMenu.test.ts`**.

---

## Поиск и переход к ноде на canvas (n8n «Add node» palette / Langflow поиск компонентов)

Пункт **§28.2** п.4 «поиск на полотне» в [`COMPETITIVE_ANALYSIS.md`](COMPETITIVE_ANALYSIS.md): факт реализации только здесь, без дублирования таблиц в competitive (рядом — раздел **«MiniMap и панель управления полотном»** выше).

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

## CI и проверки

Канонический источник истины по GraphCaster — **этот** репозиторий. Локально: **`python/`** — **`pip install -e ".[dev]"`**, **`pytest -q`**; **`ui/`** — **`npm ci`**, **`npm test`**, **`npm run build`** (см. **`engines`** в **`ui/package.json`**).

При встраивании GraphCaster как **git submodule** в другой репозиторий команда может дополнительно настроить свой **GitHub Actions** (или иной CI) на каталог субмодуля — это политика **хоста**, не часть контракта GraphCaster.

Детали планов по прозрачности CI — **`doc/DEVELOPMENT_PLAN.md`** (блок **P2 — CI**).

---

## Связанные артефакты run (уже было до жизненного цикла, уточнение слоя)

- Каталог run под корневым графом, событие **`run_root_ready`**, проброс **`root_run_artifact_dir`** во вложенные вызовы — `artifacts.py`, `runner.py` (см. также `DEVELOPMENT_PLAN.md` фаза 2).
- **Персистентный журнал** на диске ( **`events.ndjson`**, **`run-summary.json`**, **`GraphRunner(..., persist_run_events=True)`** ) — полная таблица и пути в разделе **«Персистентный журнал прогона / execution history»** выше.

---

*Обновляйте этот файл при закрытии новых пунктов из `COMPETITIVE_ANALYSIS.md`, чтобы не дублировать «сделано» в тексте про конкурентов. Черновики планов — `doc/plans/YYYY-MM-DD-<feature>.md` (каталог **`doc/plans/`** в **`.gitignore`**, локально у разработчика). Удаляйте файл плана **после того, как поведение есть в коде** (и зафиксировано здесь при необходимости); незавершённые планы оставляйте. Временные **`doc/*-plan.md`** в корне **`doc/`** — по тому же правилу. Коммиты по плану не обязательны.*
