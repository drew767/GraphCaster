# GraphCaster

Легковесный редактор и рантайм для сценариев в виде направленных графов: UI (веб / встраивание) и движок выполнения на Python. Репозиторий может жить **отдельно** и подключаться в монорепо как **git submodule**.

## Структура

| Путь | Назначение |
|------|------------|
| `python/` | Пакет `graph_caster`: загрузка JSON, обход графа, события выполнения |
| `ui/` | Заготовка фронтенда (далее Vite + React + полотно нод) |
| `schemas/` | **JSON Schema** контракта v1 и пример документа |
| `doc/` | Продуктовый дизайн и поэтапный план |

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
python -m graph_caster -d ../schemas/graph-document.example.json -s n1
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
- **Несколько исходящих рёбер из одной ноды:** раннер выбирает **первое** ребро с пустым условием или с условием, оценённым как истина (подробнее в `doc/DEVELOPMENT_PLAN.md`, фаза 2).

## Что делать дальше (чеклист)

Канонический порядок фич и зависимостей — [`doc/DEVELOPMENT_PLAN.md`](doc/DEVELOPMENT_PLAN.md). Кратко:

| Шаг | Действие |
|-----|----------|
| 1 | Довести JSON Schema и политику условий / множественных выходов; при смене схемы поднять `schemaVersion`. |
| 2 | Усилить раннер (DSL или JSONLogic для условий, `graph_ref`, анти-циклы). |
| 3 | Поднять `ui/`: Vite + React + TS, каркас меню / канвас / инспектор / консоль. |
| 4 | React Flow (или аналог): ноды, пины, валидация соединений in↔out. |
| 5 | Инспектор свойств и редактор условия на ребре. |
| 6 | Файлы: новый / открыть / сохранить (FS API или мост хоста). |
| 7 | Run: мост к Python (NDJSON/WebSocket) или воспроизведение лога в чистом браузере. |
| 8 | Полировка UX, встраивание NPM/`dist` в десктоп. |

Поведение и внешний вид — [`doc/PRODUCT_DESIGNE.md`](doc/PRODUCT_DESIGNE.md).

## UI (`ui/`)

Пока заглушки npm-скриптов. После инициализации Vite замените `dev` / `build` в `ui/package.json`. Детали: [`ui/README.md`](ui/README.md).

## Лицензирование

Код в этом репозитории помечен как проприетарный (`pyproject.toml`); уточните лицензию у владельца продукта перед внешним распространением.
