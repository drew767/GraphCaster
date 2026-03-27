# GraphCaster

Легковесный редактор и рантайм для сценариев в виде направленных графов: UI (веб / встраивание) и движок выполнения на Python. Репозиторий может жить **отдельно** и подключаться в монорепо как **git submodule**.

## Структура

| Путь | Назначение |
|------|------------|
| `python/` | Пакет `graph_caster`: загрузка JSON, обход графа, события выполнения |
| `ui/` | Vite + React + TS: каркас меню / полотно / инспектор / консоль (см. `ui/README.md`) |
| `schemas/` | **JSON Schema** контракта v1 и пример документа |
| `doc/` | Продуктовый дизайн, план, сравнение с конкурентами; реестр **[реализованных фич](doc/IMPLEMENTED_FEATURES.md)** |

## Клонирование

**Только GraphCaster:**

```bash
git clone https://github.com/drew767/GraphCaster.git
cd GraphCaster
```

**Монорепо Aura / messenger-backend** (субмодуль уже в `.gitmodules`):

```bash
git submodule update --init --recursive third_party/graph-caster
```

Обновить субмодуль до последнего `main` на GitHub:

```bash
cd third_party/graph-caster
git fetch origin
git checkout main
git pull
cd ../..
git add third_party/graph-caster
git commit -m "Bump graph-caster submodule"
```

## Быстрый старт (Python)

Из каталога `python/`:

```bash
cd python
pip install -e .
python -m graph_caster --help
python -m graph_caster run -d ../schemas/graph-document.example.json -s start1
```

События выполнения печатаются **по одному JSON на строку** (удобно для пайпов и UI).

### Разработка и тесты

```bash
cd python
pip install -e ".[dev]"
pytest -q
```

## Контракт данных (v1)

- Черновик схемы: [`schemas/graph-document.schema.json`](schemas/graph-document.schema.json)
- Пример: [`schemas/graph-document.example.json`](schemas/graph-document.example.json)
- **Пины:** в данных редактора используйте согласованные handle, напр. `in_default` / `out_default`; альтернативные имена `source_handle` / `target_handle` поддерживаются загрузчиком Python для совместимости.
- **Pin вывода task (`gcPin`):** в `task.data` опционально `gcPin` (n8n pinData-style) — см. `$defs.gcPin` в схеме графа и `python/README.md`.
- **Кэш шагов task (F17):** `task.data.stepCache` и десктопная панель Run (чекбокс «Step cache», очередь **dirty** → `--step-cache` / `--step-cache-dirty`) — `doc/IMPLEMENTED_FEATURES.md`.
- **Несколько исходящих рёбер из одной ноды:** раннер выбирает **первое** ребро с пустым условием или с условием, оценённым как истина. Для **параллельного fan-out** в одном процессе используйте ноду **`fork`** (все безусловные исходы ставятся в очередь), затем **`merge`** с **`data.mode`** **`barrier`** для join (ожидание всех веток), см. `python/README.md` и `doc/IMPLEMENTED_FEATURES.md`.

Актуальные продуктовые решения (Start/Exit, папка **`graphs/`** + **`runs/`**, уникальный `graphId`, артефакты корневого Run, Cursor CLI как цель MVP) — в [`doc/PRODUCT_DESIGNE.md`](doc/PRODUCT_DESIGNE.md).

## Что делать дальше (чеклист)

Канонический порядок фич и зависимостей — [`doc/DEVELOPMENT_PLAN.md`](doc/DEVELOPMENT_PLAN.md). Кратко:

| Шаг | Действие |
|-----|----------|
| 1 | Довести JSON Schema и политику условий / множественных выходов; при смене схемы поднять `schemaVersion`. |
| 2 | Усилить раннер (DSL или JSONLogic для условий, `graph_ref`, анти-циклы). |
| 3 | Поднять `ui/`: Vite + React + TS, каркас меню / канвас / инспектор / консоль — **частично сделано**; нативное окно: `npm run dev` (Tauri), веб-режим: `npm run dev:web`, артефакт: `npm run build`. |
| 4 | React Flow: ноды, пины, валидация соединений — **частично** (полотно + пример графа + инспектор выбора ноды). |
| 5 | Инспектор свойств и редактор условия на ребре. |
| 6 | Workspace: автоскан **`graphs/`**, автосохранение без диалога, открыть из меню и инспектора. |
| 7 | Run: мост к Python (NDJSON/WebSocket) или воспроизведение лога в чистом браузере. |
| 8 | Полировка UX, встраивание NPM/`dist` в десктоп. |

Поведение и внешний вид — [`doc/PRODUCT_DESIGNE.md`](doc/PRODUCT_DESIGNE.md).

## UI (`ui/`)

### Для пользователей Windows (без Rust и без командной строки)

1. Получите готовый установщик: файл вида **`GraphCaster_*_x64-setup.exe`** (сборка из исходников описана ниже) или артефакт **`graph-caster-windows-installers`** из GitHub Actions (**Actions → GraphCaster desktop → последний запуск → Artifacts**).
2. Запустите `.exe`, следуйте шагам мастера (установка **для текущего пользователя**, обычно без прав администратора).
3. При необходимости установщик **сам подтянет WebView2** (компонент отображения окна, как у многих современных приложений).
4. Запуск: **Пуск → GraphCaster** или ярлык на рабочем столе, если вы отметите этот пункт в установщике. В конце мастера можно включить **«Запустить приложение»** (если предложено).

Если Windows покажет **«Защита Windows»** (неподписанная сборка), откройте **«Подробнее»** и **«Выполнить в любом случае»**. Для корпоративного раздачи имеет смысл **подписать** установщик код-подписью.

Отдельно ставить Rust, MSVC, Node или Tauri **не нужно** — это только для тех, кто **собирает** программу из кода.

### Для разработчиков

Из каталога `ui/`: **`npm install`**. Разработка: **`npm run dev`** — окно Tauri + Vite (нужны [зависимости Tauri под Windows](https://tauri.app/start/prerequisites/): Rust, MSVC и т.д.). Только веб: **`npm run dev:web`**. Сборка SPA: **`npm run build`**. Сборка установщиков Windows: **`npm run build:desktop`** → `ui/src-tauri/target/release/bundle/nsis/` и `.../msi/`. Детали: [`ui/README.md`](ui/README.md).

Автосборка установщика в CI: workflow [`.github/workflows/graph-caster-desktop.yml`](../../.github/workflows/graph-caster-desktop.yml) (ручной запуск **Run workflow**).

## Лицензирование

Код в этом репозитории помечен как проприетарный (`pyproject.toml`); уточните лицензию у владельца продукта перед внешним распространением.
