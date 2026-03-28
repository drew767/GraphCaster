# GraphCaster UI

SPA-редактор: Vite, React 18, TypeScript. Полотно **@xyflow/react**; стартовый документ — пример из **`@schemas/`**; **Открыть** / **Сохранить** (в **`graphs/`** после **привязки папки проекта** в Chromium, иначе скачивание `.json`) / **Новый**; инспектор ноды/ребра, консоль-заглушка — см. `doc/DEVELOPMENT_PLAN.md`.

## Команды

```bash
npm install
npm run dev          # окно приложения (Tauri) + Vite на 127.0.0.1:5173; нужен Rust (см. tauri.app)
npm run dev:web      # только Vite, без автозапуска браузера
npm run build        # SPA → dist/
npm run build:desktop  # tauri build: .exe + MSI/NSIS в src-tauri/target/release/bundle/
npm run preview:web  # превью dist/ на 127.0.0.1:4173
npm test
```

Сборка пишет артефакты в **`dist/`** (в git не коммитится — см. корневой `.gitignore`).

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

Статическая сборка из `dist/` для WebView / iframe; обмен с Python-runner по плану продукта (WebSocket / `postMessage` / Tauri). Для ежедневной работы в отдельном окне используйте **`npm run dev`** (оболочка Tauri в `src-tauri/`).
