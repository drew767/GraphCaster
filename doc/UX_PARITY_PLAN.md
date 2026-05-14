# UX_PARITY_PLAN — n8n mechanic-by-mechanic parity for GraphCaster

> **Цель**: довести GraphCaster до полного функционального и пространственного соответствия n8n —
> чтобы пользователь, привычный к n8n, мог сесть за GraphCaster и не искать кнопки.
> Каждая механика: «где она у n8n», «что у нас сейчас», «что должно стать», «какие файлы трогать».
>
> Этот документ — продолжение [UX_PORT_PLAN.md](./UX_PORT_PLAN.md): UX1–UX120 дали скелет
> (layout, primitives, tokens, страницы-шаблоны). UXP1–UXP132 ниже — это «начинка»,
> механики и поведение, на которых n8n отличается от наших стабов.

---

## Executive summary — категории пробелов

| Категория | Маркер‑диапазон | Кол‑во | Приоритет |
|---|---|---|---|
| Canvas mechanics (node toolbar, plus‑button, edge UX, mini‑map, selection) | UXP1 – UXP28 | 28 | **P0** — core editor parity |
| NDV mechanics (parameter types, expression UX, RL, test step, hotkeys) | UXP29 – UXP60 | 32 | **P0** — core editor parity |
| Shell, header, sidebar, command bar, modals, banners | UXP61 – UXP82 | 22 | **P1** |
| Pages (workflows, executions, credentials, templates, settings) | UXP83 – UXP110 | 28 | **P1** |
| System (state persistence, push, RBAC, theming, i18n, a11y, mobile) | UXP111 – UXP132 | 22 | **P2** |
| **Итого** | UXP1 – UXP132 | **132** | |

Главные верхнеуровневые гэпы из инвентаря текущего состояния:

1. **Inline expression editor + data‑mapping** — есть только `InlineExpressionEditor`/`ExpressionEditModal`, нет drag‑from‑input‑panel, нет hover‑highlight выражений в node card.
2. **Node toolbar (floating action bar)** — у нас только context‑menu, нет hover‑toolbar с execute/disable/duplicate/delete.
3. **Edge interactions** — нет plus‑button‑in‑middle, нет drag‑middle‑to‑add, нет delete‑on‑hover.
4. **Execution history & logs** — `SingleExecution.tsx` — стаб; нет дерева выполнений, нет ретрая, нет debug‑replay.
5. **Сanvas mini‑map** — есть, но без zoom‑to‑node, без selection‑sync, без выделения current execution path.
6. **Command bar (Cmd+K)** — есть, но индекс маленький (≈20 actions); n8n ≈ 200+, включая «open node», «open execution N».
7. **Sticky notes** — есть как тип ноды, но без resize handles, без backgroundColor swatches.
8. **Push / live execution** — `ActivityFeedBridge` показывает toasts, но нет per‑node spinner / status flow во время выполнения.
9. **Settings sub‑pages** — половина — стабы (`StubSettingsPage`), включая Environments, Variables, Log Streaming, Worker View.
10. **Credentials test step** — кнопка есть, но без detailed‑error overlay как в n8n.
11. **Workflow variables** — `/settings/variables` стаб, нет UI создания/редактирования с типами.
12. **Templates marketplace** — locally cached список, нет remote fetch, нет category facets, нет «use template».
13. **Multi‑edit / bulk ops** — bulk‑actions‑bar есть, но в страницах executions/credentials не подключён.
14. **Undo/redo UI** — стек хранится в `historyStore`, но нет visual indicator depth, нет шорткат‑hint в header.
15. **Collaboration cursors** — Y.js есть, presence есть, но visual cursors на canvas — нет.
16. **Webhook test panel** — нет полноценного UI с copy‑url, live‑request‑log, paste‑sample‑request.
17. **Schedule trigger preview** — cron вводится, но нет «next 5 fires preview».
18. **Workflow testing UI** — F10 evaluation есть на backend, frontend `/evaluation` — стаб.
19. **Credentials manager** — список + edit, но без «used by N workflows» с drilldown, без credential‑sharing.
20. **Export / versioning** — есть JSON export, нет per‑version diff view, нет «restore to version».
21. **API docs panel** — нет встроенной `/settings/api`‑Swagger.
22. **Empty states** — есть `EmptyState` primitive, но не везде подключён (executions, credentials, sub‑settings).
23. **Performance monitoring** — нет «slow run > 5s» indicator в run UI.
24. **Dark mode** — токены есть, но 6+ компонентов hardcoded `#fff/#000` (Canvas overlay, Tooltip arrow, etc.).
25. **A11y / mobile** — focus traps в Dialog есть, но a11y‑audit не проводился; mobile breakpoints не покрыты.

---

## Источники

- **n8n** (Vue 3 + Vue Flow + Pinia + Element‑Plus + Reka UI + Tailwind + CodeMirror 6).
  - Canvas: `editor-ui/src/components/canvas/*`, `editor-ui/src/composables/useCanvas*.ts`.
  - NDV: `editor-ui/src/components/ParameterInputFull.vue`, `NodeDetailsView.vue`, `ResourceLocator*.vue`.
  - Shell: `editor-ui/src/components/MainSidebar.vue`, `MainHeader.vue`, `App.vue`.
- **GraphCaster**: текущее состояние из inventory‑агента (см. саммари), `ui/src/`.
- Прежние документы: [UX_PORT_PLAN.md](./UX_PORT_PLAN.md), [COMPETITIVE_ANALYSIS.md](./COMPETITIVE_ANALYSIS.md), [IMPLEMENTED_FEATURES.md](./IMPLEMENTED_FEATURES.md).

---

## Формат маркера

```
### UXPxx — название
- n8n: <где, какой компонент, какое поведение>
- Сейчас: <текущее состояние GraphCaster>
- Target: <конкретная разница, которую нужно убрать>
- Files: <что трогать>
- Effort: S / M / L (≈1–2д / ≈3–5д / 1+ нед)
```

---

# A. Canvas mechanics — UXP1 – UXP28

### UXP1 — Node hover toolbar (floating action bar над нодой)
- n8n: при hover над нодой сверху всплывает узкий toolbar: `Execute step`, `Deactivate`, `Pin data`, `Copy`, `Delete`. Иконки 16px, gap 4px, появляется по `mouseenter`, исчезает с задержкой 200 мс.
- Сейчас: только right‑click context menu (`GcFlowNode` + `ContextMenu`); hover ничего не показывает.
- Target: компонент `NodeHoverToolbar.tsx`, абсолютно‑позиционированный над bbox ноды, появляется через `onPointerEnter` с 80 мс задержкой, скрывается с 200 мс. Связан с `useReactFlow().getNode(id)`.
- Files: `ui/src/graph/nodes/GcFlowNode.tsx`, новый `ui/src/graph/nodes/NodeHoverToolbar.tsx`, store `useEditorUiStore.ts` (hoveredNodeId).
- Effort: M

### UXP2 — Plus‑button between two nodes (insert‑on‑edge)
- n8n: на hover над edge в его середине появляется круглый «+», нажатие открывает node‑search popover; выбор ноды вставляет её, перерезая edge.
- Сейчас: добавить можно только из плюса‑на‑ноде или drag empty handle.
- Target: edge custom component `EdgeWithPlus.tsx` рисует invisible 16px hit‑zone, на hover показывает кнопку (24px), клик → `NodeSearchPopover` в координатах курсора; при выборе — `splitEdgeWithNode(edgeId, newNode)` в `graphStore`.
- Files: `ui/src/graph/edges/`, `ui/src/graph/store.ts` (splitEdgeWithNode), `ui/src/components/node-search/NodeSearchPopover.tsx`.
- Effort: M

### UXP3 — Plus‑button on node output handle (existing improvement)
- n8n: handle подсвечивается на hover, плюс ровно в центре handle pulses когда node только что добавили (3 сек после mount).
- Сейчас: есть `+` на handle, но статичный.
- Target: добавить CSS keyframe `pulse 1.4s ease-in-out 2` на mount‑state нового нода; снять анимацию по pointerdown или через 2.8s.
- Files: `ui/src/graph/nodes/GcFlowNode.tsx`, `ui/src/graph/nodes/handles.css`.
- Effort: S

### UXP4 — Node connect by drag (output→input) с auto‑pan
- n8n: при drag за пределы viewport canvas auto‑pans 8 px / frame в сторону края.
- Сейчас: нет auto‑pan.
- Target: hook `useCanvasAutoPan` подписывается на pointermove во время connection drag и `setViewport({ x, y, zoom })` шагами.
- Files: `ui/src/graph/hooks/useCanvasAutoPan.ts` (new), интеграция в `GcFlow.tsx`.
- Effort: S

### UXP5 — Connection by Tab key (sequential connect mode)
- n8n: нажатие Tab на selected node открывает search inline, выбор автоматически создает edge.
- Сейчас: Tab проигнорирован.
- Target: hotkey `Tab` в `useCanvasHotkeys` — если есть selected node без edge на main‑output → open `NodeSearchPopover` под нодой.
- Files: `ui/src/graph/hooks/useCanvasHotkeys.ts`.
- Effort: S

### UXP6 — Edge labels (показ типа на non‑main edges: ai_tool, ai_memory)
- n8n: edge типа `ai_tool` показывает «🛠 Tool» лейбл по центру; `ai_memory` — «🧠 Memory».
- Сейчас: все edges одинаковые, без лейбла.
- Target: `edgeTypes.ai_tool`/`ai_memory`/`ai_languageModel` в reactflow registry; renderer показывает SVG icon + label.
- Files: `ui/src/graph/edges/AiEdge.tsx`, registry в `ui/src/graph/index.tsx`.
- Effort: M

### UXP7 — Edge hover delete (× в середине)
- n8n: на hover edge показывает мелкий красный «×» в midpoint; click — удаляет edge без подтверждения.
- Сейчас: только через context‑menu / Backspace.
- Target: расширить `EdgeWithPlus.tsx` — два state'а hover‑toolbar: «+» и «×» в зависимости от modifier (Alt → delete).
- Files: `ui/src/graph/edges/EdgeWithPlus.tsx`.
- Effort: S

### UXP8 — Selection rectangle (drag‑select)
- n8n: SHIFT‑drag по пустому canvas или просто drag → выделить группу нод. Selection highlight на каждом outline.
- Сейчас: ReactFlow поддерживает out‑of‑box но `selectionOnDrag` отключён.
- Target: `<ReactFlow selectionOnDrag panOnDrag={[1]}>` (drag правой/средней — pan, левой — select). MultiSelectionStore tracks ids.
- Files: `ui/src/graph/GcFlow.tsx`.
- Effort: S

### UXP9 — Bulk node operations (multi‑select context menu)
- n8n: при selected ≥ 2 nodes — context menu показывает «Execute selected», «Disable», «Duplicate», «Delete», «Group into sticky».
- Сейчас: ContextMenu single‑node only.
- Target: в `ContextMenu.tsx` ветка `if (selection.size >= 2) renderBulkActions()`.
- Files: `ui/src/graph/ContextMenu.tsx`, `ui/src/graph/store.ts` (bulk handlers).
- Effort: M

### UXP10 — Sticky note resize handles
- n8n: sticky имеет 8 resize handles (4 угла + 4 стороны); resize drag меняет width/height ноды.
- Сейчас: sticky фиксированного размера.
- Target: `StickyNode.tsx` оборачивает в `NodeResizer` (xyflow built‑in).
- Files: `ui/src/graph/nodes/StickyNode.tsx`.
- Effort: S

### UXP11 — Sticky color swatches
- n8n: внутри sticky toolbar — 6 цветовых swatch (yellow, blue, pink, green, purple, gray); клик меняет `data.color`.
- Сейчас: один цвет.
- Target: floating toolbar при selected sticky — `StickyToolbar.tsx`, 6 кружков, обновление через `updateNodeData`.
- Files: `ui/src/graph/nodes/StickyNode.tsx`, `StickyToolbar.tsx`.
- Effort: S

### UXP12 — Mini‑map: click to navigate, drag viewport rect
- n8n: клик в minimap центрирует viewport в этой точке; drag по viewport‑rectangle pan'ит главное окно.
- Сейчас: ReactFlow `<MiniMap>` поддерживает оба — но `pannable={false}` и `zoomable={false}` дефолтно.
- Target: установить `pannable zoomable` на `<MiniMap>`, проверить tokens на цвета.
- Files: `ui/src/graph/GcFlow.tsx`.
- Effort: S

### UXP13 — Mini‑map: highlight executing nodes
- n8n: во время run миниатюра ноды в minimap пульсирует тем же цветом, что и status (yellow→green→red).
- Сейчас: minimap нейтральный.
- Target: `nodeColor` callback в `<MiniMap>` использует `runStore.statusByNode[id]`.
- Files: `ui/src/graph/GcFlow.tsx`, `ui/src/graph/store.ts`.
- Effort: S

### UXP14 — Canvas controls: fit‑view, zoom +/-, lock, interactive, undo/redo
- n8n: bottom‑left vertical bar: ⊞ fit, + zoom, − zoom, 🔒 lock, ↶ undo, ↷ redo, грид toggle. Над bar — sticky‑note plus.
- Сейчас: только `<Controls>` дефолтные.
- Target: кастомный `CanvasControlsPanel.tsx`, replicating layout: fit, zoom in/out, lock interactive (read‑only mode), undo (delegate to `historyStore.undo`), redo, snap‑to‑grid toggle, sticky‑note button.
- Files: `ui/src/graph/CanvasControlsPanel.tsx`, `ui/src/graph/GcFlow.tsx`.
- Effort: M

### UXP15 — Snap‑to‑grid (toggle 16px)
- n8n: settings → snap включает 16px grid, дроп ноды снапит к ближайшему узлу.
- Сейчас: всегда без snap.
- Target: `snapToGrid` prop + `snapGrid={[16,16]}` на `<ReactFlow>`; toggle через `useEditorUiStore`.
- Files: `ui/src/graph/GcFlow.tsx`, `ui/src/app/stores/editorUiStore.ts`.
- Effort: S

### UXP16 — Lock canvas mode (interactive=false)
- n8n: lock toggle блокирует все edits (move, delete, connect), но позволяет navigate; красный border вокруг canvas.
- Сейчас: нет lock.
- Target: `editorUiStore.canvasLocked: boolean` → `<ReactFlow nodesDraggable={!locked} nodesConnectable={!locked} elementsSelectable={!locked}>`; визуально — outline через CSS.
- Files: те же.
- Effort: S

### UXP17 — Copy/paste nodes via keyboard (Ctrl+C / Ctrl+V) + системный clipboard
- n8n: copy selected nodes → JSON в system clipboard; paste из системного работает кросс‑таб (между двумя workflow tabs).
- Сейчас: clipboard‑store есть, но через системный clipboard не идёт.
- Target: на `Ctrl+C` сериализовать selected nodes+edges в `{nodes, connections}` JSON, `navigator.clipboard.writeText(JSON.stringify(...))`. На `Ctrl+V` парсить и инсертить с offset.
- Files: `ui/src/graph/hooks/useCanvasHotkeys.ts`, `ui/src/graph/store.ts`.
- Effort: M

### UXP18 — Duplicate (Ctrl+D)
- n8n: дублирует selected nodes со смещением +40,+40, edges между ними сохраняются.
- Сейчас: есть Ctrl+D в `keyboardShortcutsCatalog`, не подключён к canvas.
- Target: реализовать `duplicateSelection()` в `graphStore`; bind hotkey.
- Files: `ui/src/graph/store.ts`, `useCanvasHotkeys.ts`.
- Effort: S

### UXP19 — Auto‑layout button (dagre/elk)
- n8n: в settings tab «format» кнопка `Tidy up` запускает dagre auto‑layout (LR), все ноды переставляются.
- Сейчас: dagre/elkjs установлены, но не вызваны из UI.
- Target: меню в `CanvasControlsPanel` → «Tidy up workflow» (`Ctrl+Shift+F`), запускает `dagreLayout(nodes, edges)`, animate transition через 300 ms tween.
- Files: `ui/src/graph/layout/dagre.ts`, `CanvasControlsPanel.tsx`.
- Effort: M

### UXP20 — Execution flow animation (running edge highlight)
- n8n: во время run edge от выполненной ноды к следующей анимируется (animated dash pattern), статус ноды меняется: idle→running→success/error.
- Сейчас: `runStore` обновляет node status, но edge не анимируется.
- Target: на `runStore.currentEdge` ставить `animated: true` через ReactFlow edge prop; CSS class `edge-running`.
- Files: `ui/src/graph/edges/`, `ui/src/graph/store.ts`.
- Effort: M

### UXP21 — Node status icons (corner indicators)
- n8n: верхний‑правый угол ноды — иконка статуса: ✅ success, ❌ error, ⏵ running (spinner), 📌 pinned data, 🔇 muted.
- Сейчас: gcMuted/gcPinned/gcBypassed flags есть на ноде, но визуально только border‑color.
- Target: добавить slot в `GcFlowNode` для status‑icon, рендерить из приоритетного списка: error > running > pinned > muted > bypassed.
- Files: `ui/src/graph/nodes/GcFlowNode.tsx`.
- Effort: S

### UXP22 — Settings gear icon на каждой ноде
- n8n: в правом верхнем углу ноды (при hover) — gear icon, открывает NDV в режиме «Settings tab».
- Сейчас: открытие NDV — double‑click; settings tab — да, но из NDV.
- Target: gear icon в `NodeHoverToolbar` (UXP1) → `openNdv(nodeId, { tab: 'settings' })`.
- Files: `NodeHoverToolbar.tsx`, `ndvStore.ts`.
- Effort: S

### UXP23 — Disabled node visual (опustic + slash icon)
- n8n: disabled node — opacity 0.5 + диагональная полоса (CSS stripes) через background; edges, входящие в неё, серые.
- Сейчас: только border, нет opacity/stripes.
- Target: CSS modifier `.gc-node--muted { opacity: .5; background: repeating-linear-gradient(...); }`.
- Files: `ui/src/graph/nodes/GcFlowNode.tsx`, css.
- Effort: S

### UXP24 — Pin data overlay
- n8n: pinned node имеет 📌 badge + при наведении показывает popover с превью `pinData[0]`.
- Сейчас: флаг `gcPinned` есть, но без popover.
- Target: на hover pinned node — `<Popover>` с `<JsonView data={pinData[0]} maxRows={10}/>`.
- Files: `GcFlowNode.tsx`, `PinDataPreviewPopover.tsx`.
- Effort: M

### UXP25 — Node search popover (drag from sidebar / Tab / +button)
- n8n: открывается inline над canvas, fuzzy‑search по `displayName + alias + description + categories`, группировка по категориям (Action, Trigger, AI, Flow), keyboard nav.
- Сейчас: node panel слева, нет inline popover.
- Target: `NodeSearchPopover.tsx` reuses cmdk; index из `nodeRegistry.getAllNodes()`; группировка через `cmdk` `<CommandGroup>`.
- Files: `ui/src/components/node-search/NodeSearchPopover.tsx`, `nodeRegistry.ts`.
- Effort: L

### UXP26 — Drag‑and‑drop from sidebar to canvas
- n8n: nodes в sidebar drag → drop на canvas создаёт ноду в позиции drop'а, если drop на edge — splitEdge.
- Сейчас: есть drag‑and‑drop, но без splitEdge при drop on edge.
- Target: в `onDrop` проверить `getEdgesAtPoint(x, y)` → если нашлось — `splitEdgeWithNode`.
- Files: `ui/src/graph/GcFlow.tsx`, `ui/src/graph/store.ts`.
- Effort: S

### UXP27 — Connection types color coding
- n8n: edge color по типу: main=grey, ai_tool=purple, ai_memory=blue, ai_languageModel=orange, ai_outputParser=green.
- Сейчас: один цвет.
- Target: в `edgeStyle.stroke` смотреть на `data.type`; токены `--color--edge-{type}`.
- Files: `ui/src/graph/edges/`, `tokens.css`.
- Effort: S

### UXP28 — Viewport persistence per workflow
- n8n: при открытии workflow восстанавливается zoom+offset; сохраняется в localStorage `n8n-viewport-<wfId>`.
- Сейчас: viewport не сохраняется.
- Target: `useEffect` в `WorkflowEditor` — на mount читать `localStorage.getItem('gc.viewport.'+wfId)`, на `viewportchange` — debounced write.
- Files: `ui/src/pages/Workflow/WorkflowEditor.tsx`.
- Effort: S

---

# B. NDV mechanics — UXP29 – UXP60

### UXP29 — Drag‑from‑input‑panel to expression (data mapping)
- n8n: в Input panel каждый JSON ключ — draggable chip; drop в input‑поле параметра вставляет выражение `{{ $('Node Name').item.json.key }}`.
- Сейчас: Input panel показывает JSON, но не draggable.
- Target: `JsonView` рендерит каждый ключ как `<DraggableKey path="data.user.email" sourceNode="HTTP Request">`; обработчик `onDrop` в `ParameterInput` вставляет `{{ $('HTTP Request').item.json.data.user.email }}` в `cm.view.dispatch({ insert })`.
- Files: `ui/src/components/ndv/input/JsonView.tsx`, `DraggableKey.tsx`, `ui/src/components/ndv/parameters/ParameterInput.tsx`.
- Effort: L

### UXP30 — Expression hover highlight (mouseover на `{{ $expr }}` показывает resolved value)
- n8n: при hover на выражение внутри input → popover с резолвом по текущему input data: `{{ $json.name }}` → "John Doe".
- Сейчас: `InlineExpressionEditor` имеет syntax highlight, нет resolved‑popover.
- Target: CodeMirror tooltip plugin, listen on cursor over expression nodes (parse via lezer), evaluate через `evaluateExpression(text, inputItem)`.
- Files: `ui/src/components/ndv/expression/`, `expressionRunner.ts`.
- Effort: L

### UXP31 — Expression preview pane (toggle ⓘ под input field)
- n8n: под каждым expression‑полем (если значение содержит `{{}}`) — выпадающая полоса «Result: ...» серого фона.
- Сейчас: нет такого preview.
- Target: компонент `ExpressionResultStrip.tsx` — если text contains `{{`, run evaluator на current input row, show first 80 chars.
- Files: `ui/src/components/ndv/parameters/ParameterInput.tsx`, `ExpressionResultStrip.tsx`.
- Effort: M

### UXP32 — Fixed‑mode vs Expression‑mode toggle (значок ƒ справа от input)
- n8n: справа от каждого param input — иконка «=», клик переключает в expression‑mode (CodeMirror) и обратно в plain‑mode.
- Сейчас: режим только expression‑modal через кнопку.
- Target: добавить mode‑toggle button прямо в правом краю `Input`; state в `ndvStore.fieldMode[paramKey]`.
- Files: `ParameterInput.tsx`, `ndvStore.ts`.
- Effort: M

### UXP33 — ResourceLocator (RL) multi‑mode
- n8n: parameter type `resourceLocator` — 3 mode (list / id / url), drop‑down списка load через API; в "list" — searchable autocomplete, в "id" — plain text, в "url" — autoparse url→id.
- Сейчас: представлено как обычный select.
- Target: компонент `ResourceLocatorInput.tsx` с 3 sub‑modes, mode‑switcher chip слева.
- Files: `ui/src/components/ndv/parameters/ResourceLocatorInput.tsx`, schema поддержка типа `resourceLocator`.
- Effort: L

### UXP34 — Test step button (NDV header)
- n8n: NDV header кнопка `Test step` запускает выполнение ТОЛЬКО этой ноды на pinned/upstream data; результат заполняет Output panel.
- Сейчас: запускается весь workflow.
- Target: `runSingleNode(nodeId)` в run‑store + endpoint `/api/v1/runs/single-step`.
- Files: `ui/src/components/ndv/NDVHeader.tsx`, `runStore.ts`, backend route.
- Effort: M

### UXP35 — Input panel — Schema/Table/JSON tab toggle
- n8n: input panel имеет 3 view: Schema (key/type tree), Table (per‑item rows), JSON.
- Сейчас: только JSON.
- Target: `InputView.tsx` + 3 sub‑components; default — Schema.
- Files: `ui/src/components/ndv/input/`.
- Effort: M

### UXP36 — Output panel — те же 3 view + bin‑data preview
- n8n: output panel — 3 tabs + если item has `binary` — preview image/file.
- Сейчас: только JSON.
- Target: `OutputView.tsx`, mirror UXP35 + `BinaryPreview.tsx`.
- Files: `ui/src/components/ndv/output/`.
- Effort: M

### UXP37 — Pin data в output panel (clipboard icon)
- n8n: над output есть pin‑icon, клик сохраняет current output в `pinData`, при следующем run эта нода вернёт pinned (без выполнения).
- Сейчас: pin есть как флаг, нет UI с output side.
- Target: `OutputHeader.tsx` → `<IconButton icon="Pin"/>`.
- Files: `OutputHeader.tsx`, `runStore.ts`.
- Effort: S

### UXP38 — Item navigation (← →) в output / input
- n8n: если output array — стрелки `‹ 1/24 ›` сверху, можно nav между items.
- Сейчас: показывается только первый item.
- Target: `useItemIndex` hook + arrow controls; keyboard `[` / `]`.
- Files: `InputView.tsx`, `OutputView.tsx`.
- Effort: S

### UXP39 — Search в JSON view (Ctrl+F внутри NDV)
- n8n: Cmd+F внутри input/output → inline search bar, фильтрует keys.
- Сейчас: глобальный browser find.
- Target: `JsonViewSearchBar.tsx`, фильтр + highlight.
- Files: `JsonView.tsx`.
- Effort: M

### UXP40 — Parameter type: collection (динамические key‑value)
- n8n: type `collection` — add‑remove rows с opt fields per row; «Add field» dropdown с known keys.
- Сейчас: нет.
- Target: schema поддержка `type: 'collection'`, `ParameterCollection.tsx`.
- Files: `ui/src/components/ndv/parameters/ParameterCollection.tsx`, schema validator.
- Effort: M

### UXP41 — Parameter type: fixedCollection (multiple sub‑sections)
- n8n: `fixedCollection` — нескольких именованных секций, каждая со своим schema.
- Сейчас: нет.
- Target: `ParameterFixedCollection.tsx` с Accordion sections.
- Files: same dir.
- Effort: M

### UXP42 — Parameter type: multiOptions (chips multi‑select)
- n8n: `multiOptions` — chips с removable X.
- Сейчас: только `select` single.
- Target: `MultiOptionsInput.tsx`.
- Files: same.
- Effort: S

### UXP43 — Parameter type: dateTime (date picker)
- n8n: date+time picker, отдельно для type=`dateTime`.
- Сейчас: text input.
- Target: интеграция нативного `<input type="datetime-local">` или React DayPicker.
- Files: same.
- Effort: S

### UXP44 — Parameter type: filter (visual rule builder)
- n8n: trigger nodes — `filter` type рисует AND/OR группы rules.
- Сейчас: нет.
- Target: `FilterRuleBuilder.tsx`, render tree of conditions.
- Files: same.
- Effort: L

### UXP45 — Parameter type: assignmentCollection (rename/map keys)
- n8n: Edit Fields node — set/rename/keepOriginal toggles per assignment.
- Сейчас: нет (есть только base set fields).
- Target: `AssignmentCollection.tsx`.
- Files: same.
- Effort: M

### UXP46 — Parameter conditionalDisplay (showIf rules)
- n8n: каждый param имеет `displayOptions: { show: { mode: ['append'] } }` — если condition false, скрывается.
- Сейчас: schema не поддерживает `displayOptions`.
- Target: расширить parameter schema, в `ParameterInputList` фильтровать по `displayOptions`.
- Files: `ParameterInputList.tsx`, types.
- Effort: M

### UXP47 — Parameter required validation (красная подсветка на blur, message под input)
- n8n: required + empty → border красный + текст «This field is required».
- Сейчас: вычитка валидации только при save.
- Target: per‑field `<FormError>` под input; trigger on blur через `useFieldValidation` hook.
- Files: `ParameterInput.tsx`, `useFieldValidation.ts`.
- Effort: S

### UXP48 — Parameter help text (?) tooltip + docs link
- n8n: справа от label — `?` icon, hover → popover с description + link to docs.
- Сейчас: description выводится под input как plain text.
- Target: `<InfoTip>` рядом с label, link к `node.docsUrl + '#' + paramKey`.
- Files: `ParameterInputList.tsx`.
- Effort: S

### UXP49 — Notes editor (per‑node), доступен через Settings tab
- n8n: каждый node имеет note (markdown), отображается как 📝 badge.
- Сейчас: есть `data.note` поле в схеме, но нет UI.
- Target: в NDV settings tab — `<Textarea>` для notes; badge на ноде.
- Files: `NdvSettingsTab.tsx`, `GcFlowNode.tsx` badge.
- Effort: S

### UXP50 — NDV docs panel (right‑side help drawer)
- n8n: справа в NDV есть кнопка ❓ — открывает inline docs (markdown rendered) для текущей ноды.
- Сейчас: нет.
- Target: `NdvDocsPanel.tsx`, lazy‑load `node.docsMarkdown` или fetch from `/api/v1/nodes/:type/docs`.
- Files: same + backend.
- Effort: M

### UXP51 — Always‑output / continueOnFail / retryOnFail / executeOnce (settings tab)
- n8n: Settings tab имеет 4 switch'а: `Always Output Data`, `Execute Once`, `Retry On Fail` (+ tries, wait), `On Error Resume` (continueOnFail).
- Сейчас: часть есть в `NodeSettings`, но не все.
- Target: дополнить `NdvSettingsTab.tsx` всеми 4 секциями.
- Files: `NdvSettingsTab.tsx`.
- Effort: S

### UXP52 — Inline expression editor — keyboard nav (`Ctrl+Space` для autocomplete variables)
- n8n: внутри expression‑mode `Ctrl+Space` показывает autocomplete `$json`, `$node["..."]`, `$workflow`, `$env`, etc.
- Сейчас: CodeMirror без custom completion.
- Target: completion source plugin `expressionAutocomplete.ts` с predefined список + dynamic node names.
- Files: `ui/src/components/ndv/expression/completion.ts`.
- Effort: M

### UXP53 — Expression error inline indicator
- n8n: если выражение throw'ит — `Result: ⚠ TypeError: ...` красным под input.
- Сейчас: ошибка в evaluator silently.
- Target: `ExpressionResultStrip` (UXP31) показывает error class при throw.
- Files: `ExpressionResultStrip.tsx`.
- Effort: S

### UXP54 — Save/Close NDV (Esc, X, click outside) с dirty‑check
- n8n: если dirty и нажат Esc — confirm «Discard changes?» / «Save».
- Сейчас: закрывается без подтверждения.
- Target: `AlertDialog` при `Esc` если `dirty`.
- Files: `NDV.tsx`.
- Effort: S

### UXP55 — Resize panels (drag splitter)
- n8n: NDV — 3 панели с draggable resizer между ними; min‑widths.
- Сейчас: фиксированные width.
- Target: `<Splitter>` (custom) между Input/Params/Output; min‑width 120/368/120 (n8n).
- Files: `NDV.tsx`, `Splitter.tsx`.
- Effort: M

### UXP56 — Wide NDV mode (settings → wide → 640px main)
- n8n: gear icon в NDV → toggle wide mode (param panel = 640px).
- Сейчас: нет.
- Target: `ndvStore.wide: boolean`, persist `localStorage`.
- Files: `ndvStore.ts`, `NDV.tsx`.
- Effort: S

### UXP57 — NDV variant: AI Agent
- n8n: AI Agent node имеет special NDV с подключёнными sub‑connections (Tool/Memory/Model) визуально в header.
- Сейчас: одинаковый NDV.
- Target: `NdvAiAgent.tsx`, header с tabs по sub‑connections.
- Files: new + dispatch in `NDV.tsx` по `node.type`.
- Effort: L

### UXP58 — NDV variant: HTTP Request (curl import)
- n8n: HTTP Request NDV → меню «Import cURL»; парсит cURL → заполняет URL/method/headers/body.
- Сейчас: нет.
- Target: `CurlImportModal.tsx`, parser в `curlParser.ts`.
- Files: new.
- Effort: M

### UXP59 — Credentials select в NDV (custom select с «+ Create new»)
- n8n: dropdown показывает existing credentials of type + при пустом — «+ Create new credential» открывает modal.
- Сейчас: только select existing.
- Target: расширить `<Select>` или custom `CredentialPicker.tsx`.
- Files: `CredentialPicker.tsx`, `CredentialEditModal.tsx`.
- Effort: S

### UXP60 — Node version selector (typeVersion)
- n8n: dropdown в settings tab — выбор `typeVersion` (для бэкворд‑compat); upgrade prompt при новой версии.
- Сейчас: нет.
- Target: `NodeVersionPicker.tsx` в settings tab.
- Files: `NdvSettingsTab.tsx`.
- Effort: S

---

# C. Shell / header / sidebar / command bar / modals — UXP61 – UXP82

### UXP61 — MainSidebar collapsible (200–500px) + persist
- n8n: drag‑resize левого sidebar, ширина в localStorage `n8n-sidebar-width`.
- Сейчас: фикс 220px.
- Target: добавить splitter; min 200 max 500.
- Files: `MainSidebar.tsx`.
- Effort: S

### UXP62 — Sidebar workspace switcher (top of sidebar)
- n8n: верх sidebar — workspace dropdown (Personal / Project A / Project B), клик меняет route prefix.
- Сейчас: workspace store есть, switcher есть, но не в sidebar header.
- Target: `WorkspaceSwitcher.tsx` в top of MainSidebar.
- Files: `MainSidebar.tsx`.
- Effort: S

### UXP63 — Sidebar sub‑items expand
- n8n: «Settings» в sidebar разворачивается inline, не уводит в отдельный layout.
- Сейчас: settings — отдельная страница с sub‑sidebar.
- Target: оба варианта — inline accordion в sidebar + sub‑sidebar если route активен.
- Files: `MainSidebar.tsx`.
- Effort: M

### UXP64 — Sidebar bottom: user avatar + dropdown
- n8n: внизу sidebar — Avatar + дроп: Account, Sign out, theme switcher.
- Сейчас: avatar в AppHeader.
- Target: дублировать в sidebar bottom; theme switcher с tri‑state (system/light/dark).
- Files: `MainSidebar.tsx`.
- Effort: S

### UXP65 — Sidebar pin‑folder / starred workflows quick‑access
- n8n: pinned workflows показываются под «Workflows» как list.
- Сейчас: starred есть в store, не отображается.
- Target: `<SidebarSection title="Starred">` показывает starred wf'ы.
- Files: `MainSidebar.tsx`, `workflowStore.ts`.
- Effort: S

### UXP66 — AppHeader: per‑route title + actions
- n8n: header показывает workflow name (inline‑editable), tags, share, save, execute.
- Сейчас: только generic AppHeader.
- Target: per‑route slot `useHeaderSlot()` API; WorkflowEditor запушит свои controls.
- Files: `AppHeader.tsx`, `headerSlotStore.ts`.
- Effort: M

### UXP67 — Workflow header — inline rename
- n8n: клик по имени в header → input edit‑in‑place.
- Сейчас: rename только через actions menu.
- Target: `<InlineTextEdit>` в WorkflowHeader.
- Files: `WorkflowHeader.tsx`.
- Effort: S

### UXP68 — Workflow header — Active toggle (run/stop)
- n8n: справа от названия — Active toggle switch (enable/disable triggers).
- Сейчас: есть, но кнопкой.
- Target: replace на Switch с tooltip.
- Files: `WorkflowHeader.tsx`.
- Effort: S

### UXP69 — Workflow header — Tags chip с popover‑editor
- n8n: pill с тэгами, клик — popover с multi‑select tags.
- Сейчас: tags хранятся, но без UI.
- Target: `TagsPopover.tsx`.
- Files: new.
- Effort: S

### UXP70 — Workflow header — Share button → ShareModal
- n8n: share → modal с user invite, role select, link copy.
- Сейчас: ShareModal есть, но не подключён к header.
- Target: button в header.
- Files: `WorkflowHeader.tsx`.
- Effort: S

### UXP71 — Workflow header — Execute workflow button (yellow)
- n8n: prominent `Execute workflow` button с dropdown «Execute / Execute with pinned data».
- Сейчас: только Execute.
- Target: split button.
- Files: `WorkflowHeader.tsx`.
- Effort: S

### UXP72 — Activity feed (notification center)
- n8n: bell icon в header → popover со списком notification'ов; mark all as read.
- Сейчас: NotificationsStore есть, UI — toast only.
- Target: `NotificationsPopover.tsx` + bell.
- Files: `AppHeader.tsx`.
- Effort: M

### UXP73 — Command bar — расширение индекса до ~200 entries
- n8n: Cmd+K включает все routes, recent workflows, recent executions, settings sub‑pages, node creation actions.
- Сейчас: ~20 actions.
- Target: динамические providers: `routesProvider`, `recentWorkflowsProvider`, `actionsProvider`. ~150+ entries.
- Files: `AppCommandBar.tsx`, `commandBarProviders/*`.
- Effort: M

### UXP74 — Command bar — keyboard shortcuts hints (Cmd+K shows shortcuts)
- n8n: каждая команда показывает свой shortcut справа.
- Сейчас: KeyboardShortcut primitive есть, но не подключён.
- Target: `<KeyboardShortcut>` в item right slot.
- Files: `AppCommandBar.tsx`.
- Effort: S

### UXP75 — Banners (system messages)
- n8n: top‑of‑screen banner для trial expiry, version update, important notice.
- Сейчас: portal slot есть, нет UI.
- Target: `BannerHost.tsx` + `bannerStore`, типы: info/warning/error/promo.
- Files: new.
- Effort: M

### UXP76 — Toast variants + action button
- n8n: toast может иметь action (`Undo`, `View`); duration настраивается; типы success/info/warning/error.
- Сейчас: success/error/info, без action.
- Target: расширить `Toast` с `action?: { label, onClick }`.
- Files: `ToastProvider.tsx`, `Toast.tsx`.
- Effort: S

### UXP77 — Modals: WorkflowSettings (тэги, error workflow, timeout, save data, caller policy)
- n8n: при клике «Settings» в header — modal с timezone, error workflow select, save data flags.
- Сейчас: settings tab в NDV для node, нет workflow‑level.
- Target: `WorkflowSettingsModal.tsx`.
- Files: new.
- Effort: M

### UXP78 — Modal: Duplicate workflow (с tag/project выбором)
- n8n: при дубле — modal спрашивает name + project + tags.
- Сейчас: дублирование тихое.
- Target: `DuplicateWorkflowModal.tsx`.
- Files: new.
- Effort: S

### UXP79 — Modal: Move to folder/project
- n8n: workflow context menu → Move → modal с tree выбора.
- Сейчас: нет.
- Target: `MoveWorkflowModal.tsx`.
- Files: new.
- Effort: M

### UXP80 — Modal: Import (JSON / cURL / template URL)
- n8n: file picker + textarea для paste; auto‑detect формата.
- Сейчас: import есть, без авто‑детекта.
- Target: расширить `ImportModal`.
- Files: `ImportModal.tsx`.
- Effort: S

### UXP81 — Global hotkeys table (`?` opens KeyboardShortcutsModal)
- n8n: глобально `?` → modal со всеми shortcuts (categories).
- Сейчас: каталог есть в `keyboardShortcutsCatalog.ts`, нет modal.
- Target: `KeyboardShortcutsModal.tsx` с группировкой.
- Files: new.
- Effort: S

### UXP82 — AskAI / AI‑assistant panel (right drawer)
- n8n: Pro/Enterprise — справа panel «Ask AI», context‑aware (current node).
- Сейчас: нет.
- Target: stub UI (toggle, panel, input, disabled message «AI assistant requires Pro»).
- Files: `AiAssistantPanel.tsx`.
- Effort: M

---

# D. Pages — UXP83 – UXP110

### UXP83 — Workflows list — folders tree (left side)
- n8n: справа от list — folder tree (collapsible).
- Сейчас: FolderCard есть, нет tree.
- Target: `FolderTree.tsx`.
- Files: new + `Workflows.tsx`.
- Effort: M

### UXP84 — Workflows list — filters bar (status / tag / project)
- n8n: top bar — chips для фильтра.
- Сейчас: search есть, фильтр через select.
- Target: `WorkflowFiltersBar.tsx`.
- Files: `Workflows.tsx`.
- Effort: S

### UXP85 — Workflows list — sort by column (name/updated/created/active)
- n8n: header columns sortable.
- Сейчас: только updated desc.
- Target: `useSortState` + `SortDropdown`.
- Files: `Workflows.tsx`.
- Effort: S

### UXP86 — Workflows list — per‑row action menu (5+ items)
- n8n: ⋯ menu — Open, Share, Duplicate, Move, Export, Delete, Activate.
- Сейчас: 3 items.
- Target: расширить `WorkflowCard.actions`.
- Files: `WorkflowCard.tsx`.
- Effort: S

### UXP87 — Workflows list — bulk‑actions bar (на select)
- n8n: чекбоксы → bottom bar с Delete/Move/Archive/Activate.
- Сейчас: `BulkActionsBar` primitive есть.
- Target: подключить в `Workflows.tsx`.
- Files: same.
- Effort: S

### UXP88 — Workflows list — pagination + per‑page
- n8n: 50 per page default, page nav.
- Сейчас: infinite or full list.
- Target: `<Pagination>` primitive + url query `?page=&perPage=`.
- Files: `Workflows.tsx`.
- Effort: S

### UXP89 — Workflows list — archived view (отдельный tab)
- n8n: «Archived» tab.
- Сейчас: тесты есть `Workflows.archive.test.tsx`, UI частично.
- Target: ToggleTabs `All / Archived`.
- Files: `Workflows.tsx`.
- Effort: S

### UXP90 — Executions list — virtual scroll + filters (status / wf / time range)
- n8n: 100 per scroll, фильтр sidebar.
- Сейчас: список без виртуализации.
- Target: `<VirtualList>` via `@tanstack/react-virtual` (уже установлен).
- Files: `Executions.tsx`.
- Effort: M

### UXP91 — SingleExecution page — node‑by‑node breakdown (полная реализация)
- n8n: страница single execution = canvas в read‑only + clickable nodes → выводят input/output этой ноды; left sidebar — node list со статусами/duration.
- Сейчас: `SingleExecution.tsx` — стаб.
- Target: full implementation: read‑only canvas, node‑list, click → NDV‑Read mode.
- Files: `SingleExecution.tsx`, `ExecutionNodeList.tsx`, `NdvReadOnly.tsx`.
- Effort: L

### UXP92 — SingleExecution — retry / debug rerun
- n8n: header — `Retry` (full), `Retry from this node`, `Debug in editor` (loads pinned data into editor).
- Сейчас: нет.
- Target: actions menu в header.
- Files: `SingleExecution.tsx`, backend `/runs/:id/retry`.
- Effort: M

### UXP93 — SingleExecution — copy run JSON / view raw
- n8n: кнопка «Show raw» — modal с JSON всей run.
- Сейчас: нет.
- Target: `RawRunModal.tsx`.
- Files: new.
- Effort: S

### UXP94 — Credentials list — used by count
- n8n: каждая credential показывает «Used in 3 workflows» (link).
- Сейчас: нет счётчика.
- Target: backend join + frontend show; click → filter workflows by credential.
- Files: backend route, `Credentials.tsx`.
- Effort: M

### UXP95 — Credentials — sharing modal
- n8n: ⋯ → Share → invite users.
- Сейчас: share modal заглушка.
- Target: `CredentialShareModal.tsx`.
- Files: new.
- Effort: M

### UXP96 — Credentials — search + filter by type
- n8n: search bar + dropdown по типу.
- Сейчас: search только.
- Target: добавить filter.
- Files: `Credentials.tsx`.
- Effort: S

### UXP97 — Templates page — remote API fetch (api.n8n.io style)
- n8n: fetch'ит из template hub; sort by views/created.
- Сейчас: локальный cached список.
- Target: stub remote API client `templatesApi.ts`, fallback на local при offline.
- Files: `templatesApi.ts`, `TemplatesPage.tsx`.
- Effort: M

### UXP98 — Templates page — category facets
- n8n: левый sidebar — категории (AI, Marketing, IT Ops, etc.).
- Сейчас: filters без facets.
- Target: `CategorySidebar.tsx`.
- Files: same.
- Effort: S

### UXP99 — Template preview modal — node list + try button
- n8n: modal с canvas preview + список нод + Use template button.
- Сейчас: preview modal есть, неполный.
- Target: дополнить `TemplatePreviewModal`.
- Files: same.
- Effort: M

### UXP100 — Settings/Personal — full form (name/email/password/MFA)
- n8n: разделы Profile / Password / API tokens / MFA.
- Сейчас: Personal есть базовый.
- Target: расширить.
- Files: `Personal.tsx`.
- Effort: M

### UXP101 — Settings/Users — invite flow с роль‑selection
- n8n: invite users → email + role; pending invitations.
- Сейчас: `InviteUsersModal` есть.
- Target: добавить pending invitations list.
- Files: `Users.tsx`.
- Effort: S

### UXP102 — Settings/Variables — CRUD UI
- n8n: variables (k=v) list, add/edit/delete.
- Сейчас: stub.
- Target: full CRUD page.
- Files: новая `Variables.tsx`, backend store уже есть.
- Effort: M

### UXP103 — Settings/Environments — env switcher
- n8n: environments (dev/staging/prod) на enterprise.
- Сейчас: stub.
- Target: list + switcher; backend supports `environment` концепцию.
- Files: новая `Environments.tsx`.
- Effort: L

### UXP104 — Settings/SourceControl — full flow (connect repo, pull/push, status)
- n8n: GitHub OAuth → repo select → push/pull workflows.
- Сейчас: backend store есть, UI частичная.
- Target: расширить.
- Files: `SourceControl.tsx`.
- Effort: L

### UXP105 — Settings/SSO — SAML/OIDC config form
- n8n: SAML config UI.
- Сейчас: `Sso.tsx` есть, базовый.
- Target: добавить metadata upload, test SSO button.
- Files: `Sso.tsx`.
- Effort: M

### UXP106 — Settings/ApiKeys — list + create + revoke
- n8n: list, create modal, copy once, revoke.
- Сейчас: `ApiKeys.tsx` + `CreateApiKeyModal.tsx` есть.
- Target: добавить scopes UI на create.
- Files: same.
- Effort: S

### UXP107 — Settings/LogStreaming — destination config
- n8n: enterprise — log to Datadog/Splunk.
- Сейчас: stub.
- Target: stub page с info «Enterprise feature».
- Files: новая.
- Effort: S

### UXP108 — Settings/Worker view — list workers + heartbeats
- n8n: enterprise — health of workers.
- Сейчас: backend run broker heartbeat есть, UI — стаб.
- Target: page показывает workers list.
- Files: новая `WorkerView.tsx`.
- Effort: M

### UXP109 — Projects page — full project management (создать, members, settings)
- n8n: projects list + детали + members + folder structure.
- Сейчас: `ProjectDetails.tsx` есть.
- Target: дополнить members management.
- Files: `ProjectDetails.tsx`.
- Effort: M

### UXP110 — Auth/Setup wizard
- n8n: первый запуск → wizard (admin user + welcome + send telemetry).
- Сейчас: `Setup.tsx` есть, упрощённый.
- Target: multi‑step.
- Files: `Setup.tsx`.
- Effort: M

---

# E. System — UXP111 – UXP132

### UXP111 — Push connection (WS) — per‑node statuses real‑time
- n8n: WS события `nodeExecuteBefore`, `nodeExecuteAfter`, `executionFinished` обновляют canvas в реал‑тайм.
- Сейчас: ActivityFeed получает события, но не маппит в node status.
- Target: расширить `ActivityFeedBridge` — на `run.node.started/finished` обновлять `runStore.statusByNode`.
- Files: `App.tsx::ActivityFeedBridge`, `runStore.ts`, backend публиковать события.
- Effort: M

### UXP112 — Collaboration cursors на canvas (Y.js awareness)
- n8n: при collaboration видны cursors других user'ов.
- Сейчас: y.js awareness есть, render — нет.
- Target: `CollaboratorCursors.tsx` overlay над ReactFlow.
- Files: new + integration.
- Effort: M

### UXP113 — Presence avatars в header (active editors)
- n8n: стек avatar'ов в header — кто сейчас в этом workflow.
- Сейчас: PresenceStore есть.
- Target: `<AvatarStack>` (primitive есть) в WorkflowHeader.
- Files: `WorkflowHeader.tsx`.
- Effort: S

### UXP114 — Optimistic save с retry на 503
- n8n: save показывает spinner, при error — banner «Saving failed, retrying…».
- Сейчас: save не показывает state.
- Target: `useSaveWorkflow` hook с retry + UI feedback.
- Files: `useSaveWorkflow.ts`.
- Effort: M

### UXP115 — Autosave indicator (last saved X ago)
- n8n: header справа — «Saved 2 seconds ago».
- Сейчас: autosave работает, indicator — нет.
- Target: `AutosaveIndicator.tsx` в header.
- Files: same.
- Effort: S

### UXP116 — Undo/redo depth indicator (количество stack)
- n8n: undo button disabled когда stack пуст; tooltip показывает «Undo (Ctrl+Z)».
- Сейчас: history store есть, UI без disabled state.
- Target: связать `historyStore.canUndo/canRedo` с buttons.
- Files: `CanvasControlsPanel.tsx`.
- Effort: S

### UXP117 — Theme switcher (system/light/dark) + persist
- n8n: settings → theme.
- Сейчас: tokens есть, theme switcher — нет.
- Target: `ThemeProvider` контекст + Switcher в user menu.
- Files: `ThemeProvider.tsx`, `tokens.css` (dark vars).
- Effort: M

### UXP118 — Dark mode полный (audit + fix hardcoded colors)
- n8n: полная поддержка dark.
- Сейчас: токены есть, но ≥6 файлов hardcoded `#fff/#000`.
- Target: grep + replace на `var(--color-...)`.
- Files: множество.
- Effort: M

### UXP119 — Locale switcher — Settings/Language
- n8n: settings → language; reload UI.
- Сейчас: i18n инициализирован, switcher — нет.
- Target: dropdown.
- Files: `Personal.tsx`.
- Effort: S

### UXP120 — RBAC — UI gating по scopes
- n8n: показ/скрытие кнопок по scope (`workflow:write`, `credential:read`).
- Сейчас: backend scopes есть, UI без gating.
- Target: `<HasScope scope="workflow:write">` wrapper + `useScopes` hook.
- Files: `HasScope.tsx`, страницы.
- Effort: M

### UXP121 — Onboarding tooltips (first‑run tour)
- n8n: первый запуск — пошаговый tour с подсветкой элементов.
- Сейчас: нет.
- Target: `OnboardingTour.tsx` с stack tooltips.
- Files: new.
- Effort: L

### UXP122 — A11y audit (focus traps, ARIA, контраст)
- n8n: имеет средний уровень a11y.
- Сейчас: focus traps в Dialog есть.
- Target: axe‑core audit, fixes; aria‑label на icon‑buttons.
- Files: множество.
- Effort: L

### UXP123 — Keyboard navigation в node list / executions / credentials
- n8n: ↑↓ в списке, Enter — open, Space — select.
- Сейчас: только мышь.
- Target: `useListNav` hook.
- Files: lists.
- Effort: M

### UXP124 — Mobile responsiveness (read‑only mode)
- n8n: mobile — read‑only canvas, simplified header.
- Сейчас: viewport не покрыт.
- Target: media‑queries; mobile breakpoint < 768px — disable editing, simplify shell.
- Files: глобально.
- Effort: L

### UXP125 — Performance: lazy load nodes > 100
- n8n: при count > 200 ноды рендерятся через `onlyRenderVisibleElements`.
- Сейчас: всё рендерится.
- Target: `<ReactFlow onlyRenderVisibleElements>` + virtualization for properties.
- Files: `GcFlow.tsx`.
- Effort: M

### UXP126 — Performance: debounce save / autosave
- n8n: 2s debounce.
- Сейчас: autosave debounce 1s.
- Target: сверить, поднять до 2s, добавить throttle для huge workflows.
- Files: `useAutosave.ts`.
- Effort: S

### UXP127 — Telemetry / analytics hook points
- n8n: PostHog events.
- Сейчас: нет.
- Target: `telemetry.ts` с no‑op default + opt‑in toggle в settings.
- Files: new.
- Effort: M

### UXP128 — Error boundaries per route
- n8n: ErrorBoundary в App.vue.
- Сейчас: один глобальный.
- Target: per‑page boundary с retry button.
- Files: `ErrorBoundary.tsx`.
- Effort: S

### UXP129 — Empty states everywhere (executions/credentials/settings)
- n8n: каждая empty list имеет illustration + CTA.
- Сейчас: `EmptyState` primitive есть, не везде применён.
- Target: подключить в Executions, Credentials, Templates, Variables, Users.
- Files: страницы.
- Effort: S

### UXP130 — Loading skeletons на load
- n8n: per‑page skeleton.
- Сейчас: `Skeleton*` primitives есть.
- Target: подключить в Workflows/Executions/Credentials list.
- Files: страницы.
- Effort: S

### UXP131 — Tauri menubar (native menu integration)
- n8n не — но desktop variant имеет.
- Сейчас: Tauri build, нет native menu.
- Target: Rust `tauri::Menu` mirroring shortcuts + commands.
- Files: `src-tauri/src/menu.rs` (если нет).
- Effort: M

### UXP132 — Embed / iframe SDK
- n8n: embed via iframe.
- Сейчас: `ui/src/embed/index.ts` есть.
- Target: расширить SDK, добавить postMessage API.
- Files: `embed/`.
- Effort: M

---

## Priority blocks (порядок реализации)

**Block 1 — Canvas core (P0, ≈2 нед):**
UXP1 → UXP2 → UXP7 → UXP8 → UXP9 → UXP14 → UXP15 → UXP16 → UXP17 → UXP18 → UXP20 → UXP21 → UXP23 → UXP25 → UXP26 → UXP28
*(toolbar, edge UX, selection, controls, copy/paste, status icons, search popover, viewport persist)*

**Block 2 — Canvas advanced (P0, ≈1 нед):**
UXP3, UXP4, UXP5, UXP6, UXP10, UXP11, UXP12, UXP13, UXP19, UXP22, UXP24, UXP27
*(animations, sticky, mini‑map enhance, dagre, status overlays)*

**Block 3 — NDV core (P0, ≈2 нед):**
UXP29 → UXP30 → UXP31 → UXP32 → UXP34 → UXP35 → UXP36 → UXP37 → UXP38 → UXP46 → UXP47 → UXP48 → UXP54 → UXP55
*(mapping, expression UX, panels, validation, resize)*

**Block 4 — NDV advanced (P0, ≈2 нед):**
UXP33, UXP39 – UXP45, UXP49 – UXP53, UXP56 – UXP60
*(parameter types, docs panel, AI variant, version selector)*

**Block 5 — Shell & header (P1, ≈1 нед):**
UXP61 – UXP82

**Block 6 — Pages (P1, ≈2 нед):**
UXP83 – UXP110 (приоритет: UXP91, UXP92 — SingleExecution полностью)

**Block 7 — System (P2, ≈2 нед):**
UXP111 – UXP132 (приоритет: UXP111, UXP112, UXP117/118 — push, presence, dark mode)

---

## Соглашения, важные для всех маркеров

1. **Токены** — никаких `#fff/#000` или произвольных hex; только `var(--color-...)` и semantic aliases.
2. **i18n** — все user‑facing строки в `locales/en.json` + `ru.json`.
3. **Тесты** — каждый non‑trivial маркер ≥ 1 vitest + (если backend) ≥ 1 pytest.
4. **Никаких ID маркеров в коде** — комментарии «// UXP42» запрещены (CLAUDE.md).
5. **Никаких новых .md без явного запроса** — этот документ — последний; апдейты идут в него.

---

## Дальше

После одобрения плана — запускать блоки 1 → 7 параллельными агентами,
каждый блок дробится по маркеру‑на‑агента.
