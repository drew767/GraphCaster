# GraphCaster UI

SPA-редактор: Vite, React 18, TypeScript. Полотно **@xyflow/react**; стартовый документ — пример из **`@schemas/`**; **Открыть** / **Сохранить** (в **`graphs/`** после **привязки папки проекта** в Chromium, иначе скачивание `.json`) / **Новый**; инспектор ноды/ребра; **группировка** в меню **Правка** или **Ctrl+G** (обернуть ≥2 выбранных исполняемых нод в рамку **`group`**) и **Ctrl+Shift+G** (разгруппировать при выделенной рамке **`group`**). Консоль-заглушка — см. `doc/DEVELOPMENT_PLAN.md`.

## Команды

```bash
npm install
npm run dev          # окно приложения (Tauri) + Vite на 127.0.0.1:5173; нужен Rust (см. tauri.app)
npm run dev:web      # только Vite, без автозапуска браузера
npm run build        # SPA → dist/
npm run build:desktop  # tauri build: .exe + MSI/NSIS в src-tauri/target/release/bundle/
npm run preview:web  # превью dist/ на 127.0.0.1:4173
npm test
npm run fixture:large-graph   # stdout: JSON линейного графа; аргумент — число нод (по умолчанию 500), см. ниже
```

Сборка пишет артефакты в **`dist/`** (в git не коммитится — см. корневой `.gitignore`).

## Большой граф: фикстура и baseline (F1 / §28.2 п.4)

**Фикстура без коммита тяжёлых JSON:** из каталога **`ui/`** сохраните вывод в файл и откройте через **Файл → Открыть** (или вложите в `graphs/`):

```bash
npm run fixture:large-graph 600 > ..\..\temp-large-graph.json
```

**Chrome DevTools — Performance (Task 1 план):**

1. Открыть приложение (`npm run dev` или `dev:web`), загрузить фикстурный граф (**~500–800** нод).
2. **Performance** → Record → **10–15 с**: pan колёсиком/жестом, zoom, перетаскивание полотна, клик по **MiniMap**, **fit view** из панели, выделение рамкой части нод, открыть инспектор по ноде/ребру.
3. При наличии прогона: повторить запись на **10–15 с** во время стрима NDJSON (оверлей нод).
4. Остановить запись; в **Bottom-Up** / **Call Tree** оценить долю **Script** vs **Layout**; типичные узкие места — React commit фазы, обработчики `useEffect` канваса, стиль **Layout** при массовых нодах.

**Целевые пороги (инженерные, для машины разработчика; не CI):**

| Критерий | Цель |
|----------|------|
| Pan / zoom на **~500** нодах в линейной цепочке | Визуально плавно, без «залипаний» **> ~200 ms** подряд при обычных жестах |
| Одно событие прогона (**NDJSON** → оверлей одной ноды) на большом графе | Нет заметного фриза **> ~200 ms** только из-за этого события (остальное — сеть/Python) |
| Экспорт документа | Полный **`GraphDocumentJson`** независимо от виртуализации DOM; проверять выборкой нод/рёбер вне текущего вьюпорта |

Детали реализации ( **`onlyRenderVisibleElements`**, оверлей, рёбра) — [`doc/IMPLEMENTED_FEATURES.md`](../doc/IMPLEMENTED_FEATURES.md) раздел **«Canvas: большие графы»**.

**Кастомные `nodeTypes` на полотне:** суммарный уровень — **`useGcEffectiveNodeTier()`** в `src/graph/useGcEffectiveNodeTier.ts`: **LOD по zoom** (`useGcCanvasLod()`, провайдер `GcCanvasLodContext` в `GraphCanvas`) плюс опциональный **ghost** для нод **вне** вьюпорта (padding в flow-координатах; выбранные ноды остаются **full**). Переключатель в шапке рядом со **snap grid**; ключ `localStorage` — `src/graph/canvasGhostOffViewport.ts`. **Подписи на рёбрах** (условия F4 / описания веток `ai_route`): чекбокс в шапке, ключ `src/graph/canvasEdgeLabels.ts` (**по умолчанию вкл.**); в LOD **compact** подписи скрываются. Вне провайдера LOD в dev — предупреждение, режим **full**. Пороги LOD — `src/graph/canvasLod.ts`; вьюпорт vs off-screen — `src/graph/viewportNodeTier.ts`.

### Распространение для пользователей без сборки

После **`npm run build:desktop`** отдайте конечным пользователям **`…/bundle/nsis/*-setup.exe`** (мастер установки). Им не нужны Node, Rust и Dev-пакеты Windows; при отсутствии WebView2 установщик может поставить его автоматически. В монорепозитории тот же артефикт можно получить из GitHub Actions: workflow **GraphCaster desktop (Windows installer)** → **Artifacts**.

## Стек

- **Vite** + **React** + **TypeScript**
- **@xyflow/react** (React Flow 12) + **i18next** — **en** / **ru**
- **graphs/:** File System Access API (привязка корня → каталог **`graphs/`**, скан, автосохранение с debounce)

## Run (Python)

**Tauri** (`npm run dev` / установщик): дочерний процесс `python -m graph_caster run`, NDJSON в stdout, отмена через stdin — см. `python/README.md`.

**Только веб** (`npm run dev:web`): Vite проксирует **`/gc-run-broker/*`** на **`http://127.0.0.1:9847`** (или **`VITE_GC_RUN_BROKER_TARGET`** в `.env`). Во втором терминале из каталога **`python/`**:

```bash
pip install -e ".[broker]"
python -m graph_caster serve
```

Тот же контракт событий, что у CLI: по умолчанию **SSE** (**`EventSource`**) вместо сырого stdout; опционально **WebSocket** — **`VITE_GC_RUN_TRANSPORT=ws`** в **`.env`** (кадры и **`viewerToken`** — **`doc/RUN_EVENT_TRANSPORT.md`**). При остановленном брокере в консоли показывается подсказка (i18n **`app.run.brokerMissing`**). Если заданы **`GC_RUN_BROKER_TOKEN`** и **`VITE_GC_RUN_BROKER_TOKEN`**, `fetch` идёт с заголовком **`X-GC-Dev-Token`**, а **SSE** / **WS** (без кастомных заголовков на **`EventSource`**) получают тот же секрет в query **`?token=...`** на **`/health`**, **`/runs/.../stream`** и **`/runs/.../ws`**.

Переменные окружения при разработке (опционально):

- **`GC_PYTHON`** — путь к интерпретатору (иначе `python` на Windows / `python3` на Unix).
- **`GC_GRAPH_CASTER_PACKAGE_ROOT`** — каталог пакета `python/` репозитория GraphCaster; добавляется в **`PYTHONPATH`** при проверке импорта и при spawn.

Поля **graphs/** и **workspace root** в шапке — пути на диске для `-g` и `--artifacts-base` (для `graph_ref` и каталога `runs/`). Сохраняются в `localStorage`.

Несколько корневых прогонов (как очередь исполнений у n8n): до **`gc.run.maxConcurrent`** (1–32 в `localStorage`, по умолчанию 2, в одном диапазоне с **`GC_*_MAX_RUNS`**) процессов параллельно; следующие старты ставятся в FIFO в UI. Селектор **сфокусированного** `runId` в шапке при 2+ живых прогонах; **Stop** отменяет сфокусированный. На брокере выровняйте потолок с UI: **`GC_RUN_BROKER_MAX_RUNS`**. В Tauri: **`GC_TAURI_MAX_RUNS`** (по умолчанию 2).

## Встраивание

Статическая сборка из **`dist/`** (**`npm run build`**) для WebView / iframe; обмен с Python-runner по плану продукта (WebSocket / `postMessage` / Tauri). Для ежедневной работы в отдельном окне используйте **`npm run dev`** (оболочка Tauri в `src-tauri/`).

**Хост как BFF:** стабильный HTTP-контракт старта/статуса/отмены прогона и реплея сохранённых событий (**`GET /api/v1/runs/{runId}/events`**) — см. **`GET /api/v1/openapi.json`** на брокере (OpenAPI 3.0.3; версия документа — **`GC_API_V1_OPENAPI_DOCUMENT_VERSION`** в **`python/graph_caster/run_broker/routes/api_v1_openapi.py`**). Пакет **`graph-caster-ui`** в репозитории помечен **`private`**; для интеграции хост забирает **`dist/`** (git submodule, CI-артефакт или **`npm pack`** после **`npm run build`**).

**Embed (граф JSON в хосте):** исходный вход **`graph-caster-ui/embed`** → **`src/embed/index.ts`**: **`GraphCasterEmbed.loadGraph(string | unknown)`** / **`loadGraph`** — обёртка над **`parseGraphDocumentJsonResult`** (ошибка **`invalid_json`** для битой строки). Типы для IDE: **`src/embed/graphCasterEmbed.d.ts`**.
