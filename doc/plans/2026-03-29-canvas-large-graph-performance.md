# Canvas performance for large graphs (§28.2 / F1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use **superpowers:subagent-driven-development** (recommended) or **superpowers:executing-plans** to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Закрыть единственный явно открытый UX-разрыв слоя **B** в таблице **F1** для GraphCaster: **производительность очень больших графов** — в терминах [`doc/COMPETITIVE_ANALYSIS.md`](../COMPETITIVE_ANALYSIS.md) это **§28.2** п.4 (**виртуализация** / **lazy**-подграфы после профилирования) и связанная строка «**GraphCaster** | частично» в каталоге **F1** (та же ссылка + **§15** как отдельный эпик).

**Architecture:** Оставаться на **одном** движке графа (**@xyflow/react**), без второго canvas-слоя ([`doc/COMPETITIVE_ANALYSIS.md`](../COMPETITIVE_ANALYSIS.md) §28, предупреждение **F1**). Сначала **измерение и низкий риск** (встроенные опции React Flow + дешёвые оптимизации оверлея Run), затем при необходимости — **селективный рендер** (только видимая область / упрощённые ноды вне вьюпорта), в духе того, как масштабируются **Flowise** / **Langflow** (React Flow) и как **n8n** держит отзывчивость при сотнях нод (собственный Vue-canvas + UX-паттерны «не рисовать лишнее»).

**Tech Stack:** React 18, TypeScript, **@xyflow/react** v12, Vitest, существующие модули `ui/src/components/GraphCanvas.tsx`, `ui/src/run/nodeRunOverlay.ts`, `doc/IMPLEMENTED_FEATURES.md` для фиксации факта после merge.

**Источник приоритета:** [`doc/COMPETITIVE_ANALYSIS.md`](../COMPETITIVE_ANALYSIS.md) **§28.2** п.4; **F1** — строка **GraphCaster**; [`doc/DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md) фаза 4 — большинство пунктов закрыты, **не** закрыт явный gap по **очень большим** графам.

---

## Карта файлов (границы изменений)

| Путь | Роль |
|------|------|
| `ui/src/components/GraphCanvas.tsx` | `<ReactFlow …>`: включить **`onlyRenderVisibleElements`** (и при необходимости связанные пропы), не сломать **MiniMap** / выделение / экспорт документа |
| `ui/src/components/nodes/GcFlowNode.tsx` | Опционально: облегчённый режим отрисовки (меньше DOM/теней) при «далёком» zoom или для невидимых нод — только после профиля |
| `ui/src/run/nodeRunOverlay.ts` + потребители в `GraphCanvas.tsx` / `AppShell.tsx` | Снизить частоту полного пересчёта классов/оверлея при потоке событий Run на больших графах (батчинг, сравнение по ссылке/dirty-set) |
| `ui/src/**/*.test.ts` | Регрессии: экспорт **`GraphDocumentJson`**, выбор нод, предупреждения рёбер — без изменения семантики |
| `doc/IMPLEMENTED_FEATURES.md` | Короткая строка-факт: закрыт срез **§28.2** п.4 (или «частично: onlyRenderVisible + …») |
| `doc/COMPETITIVE_ANALYSIS.md` | Только если команда договорится обновить формулировку «открыто» → «частично/да» в строке F1 (минимальный diff) |

**Вне scope первой волны:** полная **§15** (типизация пинов) — отдельный план; **lazy-подграфы** как отдельные сущности в **A**-схеме — только если появится `parentGraph` / group в `graph-document.schema.json` (сейчас **§28.2** п.7: группы «только если в схеме»).

---

## Как у конкурентов (архитектурно и технически)

| Продукт | Слой B | Идея для GC |
|---------|--------|-------------|
| **Flowise** | React + **React Flow** в `packages/ui` | Полагаться на viewport-движок RF: отключать тяжёлое DOM вне кадра, не держать тысячи интерактивных узлов в одном слое без виртуализации |
| **Langflow** | React SPA + RF-подобное полотно | То же: батчить обновления визуального статуса при стриме шагов, не перерисовывать весь граф на каждое событие |
| **n8n** | **Vue 3** `editor-ui`, свой canvas | Не рендерить «дорогой» хром ноды, пока она вне видимой области или сильно уменьшена; sticky notes отдельным слоем |
| **Dify** | React **Graphon** | Граф как модель + лёгкие представления узлов; тяжёлые редакторы — лениво по фокусу |
| **GraphCaster (сейчас)** | **`GraphCanvas.tsx`** | Все ноды в состоянии RF; оверлей Run маппит **все** `base.nodes` в **`useEffect`** ([`GraphCanvas.tsx`](../../ui/src/components/GraphCanvas.tsx) ~461–491) — на **N > 500** это CPU-bound при частых событиях |

**Вывод:** Параллель «как у конкурентов» = **(1)** не платить за полный рендер невидимых элементов, **(2)** не делать O(N) обход всего документа на каждое мелкое run-событие без необходимости.

---

### Task 1: Baseline — профиль и критерий «большой граф»

**Files:**

- Create (локально, не обязательно в git): заметки профиля или скрин Chrome Performance
- Read: `ui/src/components/GraphCanvas.tsx`

- [ ] **Step 1:** Сгенерировать тестовый JSON с **~300–800** нодами (скрипт в `ui/` или фикстура под `schemas/test-fixtures/`, не коммитить 2MB файл без нужды — можно генератор одноразовый).

- [ ] **Step 2:** В Chrome DevTools: **Performance** — pan/zoom + открытие инспектора + во время Run (если есть стрим) — зафиксировать долю **Script / Layout** и узкие функции (ожидаемо `useEffect` в `GraphCanvas`, reconciliation нод).

- [ ] **Step 3:** Записать порог: например «**цель:** pan 60fps при 500 нодах на машине разработчика» или «нет фриза >200ms при одном NDJSON-событии».

---

### Task 2: Включить встроенную виртуализацию React Flow

**Files:**

- Modify: `ui/src/components/GraphCanvas.tsx` (блок `<ReactFlow` ~625–651)
- Test: ручной прогон + `npm run build` в `ui/`

- [ ] **Step 1:** Добавить на `<ReactFlow>` проп **`onlyRenderVisibleElements={true}`** (или аналог из документации версии **@xyflow/react** в `package.json` — проверить точное имя пропа в типах `node_modules/@xyflow/react`).

- [ ] **Step 2:** Прогнать сценарии: **MiniMap** клик/пан, **fitView**, **мультивыбор** рамкой, **соединение рёбер**, **экспорт** (весь документ должен остаться полным — виртуализация не должна отрезать ноды из модели).

- [ ] **Step 3:** `cd ui && npm run build` — ожидается **exit 0**.

- [ ] **Step 4:** Commit (по запросу разработчика):

```bash
git add ui/src/components/GraphCanvas.tsx
git commit -m "[GraphCaster] enable RF onlyRenderVisibleElements for large canvas"
```

---

### Task 3: Оптимизация оверлея Run (O(N) → затронутые id)

**Files:**

- Modify: `ui/src/components/GraphCanvas.tsx` (effect ~461–491, зависимости)
- Modify: `ui/src/run/nodeRunOverlay.ts` (если нужен hook `applyRunEvent` / батч)
- Read: `ui/src/layout/AppShell.tsx` (источник `nodeRunOverlayById`)

- [ ] **Step 1:** Зафиксировать текущее поведение тестом или чеклистом: при новом `nodeRunOverlayById` не пересоздавать объекты `data` для нод, **id** которых не меняли фазу.

- [ ] **Step 2:** Реализовать **shallow compare** или обновление только **`changedIds`** из последнего run-события (паттерн: `overlayRevision` + map, либо `immer`-подобный patch — YAGNI: минимальный дифф).

- [ ] **Step 3:** Vitest: новый файл `ui/src/run/nodeRunOverlayBatch.test.ts` — «два события подряд для одной ноды → одна логическая фаза; карта не триггерит лишних копий для прочих нод» (уточнить реализацией).

- [ ] **Step 4:** `cd ui && npm test` — ожидается **PASS** для новых и существующих тестов.

---

### Task 4: Документация факта (Evidence)

**Files:**

- Modify: `doc/IMPLEMENTED_FEATURES.md` — подраздел у **F1** / canvas или новый короткий подпункт «§28.2 п.4 — производительность больших графов»
- Опционально: одна строка в `doc/COMPETITIVE_ANALYSIS.md` таблица **F1** «GraphCaster» (если формулировка «открыто» больше не верна)

- [ ] **Step 1:** Описать **что** включено (например `onlyRenderVisibleElements` + батч оверлея), **ограничения** (lazy подграфы в схеме **A** — не сделано).

- [ ] **Step 2:** Ссылка на коммит/PR по согласованию команды.

---

## Верификация (после всех задач)

```bash
cd third_party/graph-caster/ui && npm ci && npm test && npm run build
```

Ожидается: **exit 0**; вручную — pan/zoom на большом сгенерированном графе без заметных фризов.

---

## Execution handoff

План сохранён: **`doc/plans/2026-03-29-canvas-large-graph-performance.md`**.

**Варианты исполнения:**

1. **Subagent-Driven (рекомендуется)** — отдельный субагент на задачу, ревью между задачами.  
2. **Inline Execution** — выполнение в одной сессии по **executing-plans** с чекпоинтами.

**Какой вариант выбираете?**

Ревью цикла по навыку: один проход **plan-document-reviewer** по этому файлу и [`doc/COMPETITIVE_ANALYSIS.md`](../COMPETITIVE_ANALYSIS.md) §28 — перед стартом кода (если доступен субагент).
