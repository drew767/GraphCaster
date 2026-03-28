# План: живые логи `task` и ограниченный буфер run-event (§13.3 / §39.2)

> **For agentic workers:** следовать **executing-plans** (agent-queue) по задачам. Шаги с `- [ ]`.

**Goal:** Достичь поведения уровня **n8n / Dify / Flowise / Comfy**: **инкрементальный** вывод подпроцесса в консоли наблюдения во время длинного `task`, без раздувания памяти при медленном клиенте — за счёт **разделения** потока исполнения и транспорта и **явной политики** при переполнении буфера. Контракт ядра остаётся **NDJSON `run-event`** с полем **`runId`** на каждой строке ([`doc/COMPETITIVE_ANALYSIS.md`](../COMPETITIVE_ANALYSIS.md) §3.7, §13.3, §39.2).

**Architecture:**

1. **Ядро (Python):** раннер эмитит события **`process_output`** (чанки stdout/stderr) из [`python/graph_caster/process_exec.py`](../python/graph_caster/process_exec.py); очередь между **читателями пайпов** и **потоком**, вызывающим `emit`, — **ограниченная** `queue.Queue(maxsize=…)`, чтобы быстрый процесс не съел RAM, если sink/stdout тормозит.
2. **Транспорт (веб):** [`python/graph_caster/run_broker/broadcaster.py`](../python/graph_caster/run_broker/broadcaster.py) сегодня использует **`queue.Queue()` без лимита** — тот же класс проблем, что у Comfy **`PromptServer.messages`** ([`doc/COMPETITIVE_ANALYSIS.md`](../COMPETITIVE_ANALYSIS.md) §13.3). Заменить на **bounded** подписочные очереди + политика: **блокирующий put с таймаутом** (backpressure на продюсера) или **сброс/прореживание** только некритичных кадров (`process_output` оставить сжимаемыми при необходимости).
3. **Транспорт (десктоп):** [`ui/src-tauri/src/run_bridge.rs`](../../ui/src-tauri/src/run_bridge.rs) читает stdout построчно и шлёт **`gc-run-event`**; при всплеске частоты событий полагаться на **UI-cap** ([`ui/src/run/runSessionStore.ts`](../../ui/src/run/runSessionStore.ts): `MAX_LINES_PER_RUN`) и при необходимости добавить **агрегацию** высокочастотных `process_output` на фронте (после парсинга JSON-строки).
4. **Граница контракта:** схема [`schemas/run-event.schema.json`](../../schemas/run-event.schema.json), тесты [`python/tests/test_run_event_schema.py`](../../python/tests/test_run_event_schema.py).

**Tech Stack:** Python 3.11+, `threading`, `queue`, JSON Schema; Rust (Tauri) при доработке моста; TypeScript (`useRunBridge`, `runEventSideEffects`, `parseRunEventLine`).

**Почему этот приоритет (решение без вопросов):**

| Источник | Факт |
|----------|------|
| [`doc/COMPETITIVE_ANALYSIS.md`](../COMPETITIVE_ANALYSIS.md) слой **D / G** | Полный **F6** (воркер-пул, параллельные ветки в одном прогоне) явно **вне MVP**; зато **§13.3** и **§39.2** прямо требуют спроектировать **буфер к транспорту** и backpressure — иначе при появлении частых событий (стрим логов) повторяется риск **неограниченной** очереди. |
| [`doc/DEVELOPMENT_PLAN.md`](../DEVELOPMENT_PLAN.md) фаза **9** | MVP «Cursor CLI» предполагает **долгие** `task`; без инкрементального вывода UX хуже эталонов (**§27**, F7). |
| Конкуренты | **Dify:** `Queue*` → `StreamResponse` (**§3.6**). **Comfy:** две очереди — исполнение vs WebSocket (**§13.3**). **Flowise:** Redis между воркером и SSE (**§3.3.1**). **n8n:** relay и отдельные кадры метаданных/тела (**§3.2.1–§3.2.2**). **Лучший переносимый минимум для GC:** не Redis и не второй протокол, а **тот же NDJSON** + **bounded queues** на границах процесса. |

**База `process_output`:** реализовано; реестр фактов — [`doc/IMPLEMENTED_FEATURES.md`](../IMPLEMENTED_FEATURES.md) (раздел «Инкрементальный вывод подпроцесса **task**»). Ниже — **надстройка** по архитектуре буферов и порядок слияния фаз (брокер, Tauri).

---

## Карта файлов (что трогать)

| Путь | Роль |
|------|------|
| `schemas/run-event.schema.json` | Тип **`process_output`**, поля `stream`, `text`, `seq`, … |
| `python/graph_caster/process_exec.py` | Потоковое чтение stdout/stderr → `emit` |
| `python/graph_caster/run_broker/broadcaster.py` | **Bounded** очереди подписчиков, политика `broadcast` |
| `python/graph_caster/run_broker/app.py` | Подключение спавна CLI к broadcaster (если логика там) |
| `ui/src/run/useRunBridge.ts` | Разбор строки: stderr с префиксом только если не `process_output` (уже частично) |
| `ui/src/run/runEventSideEffects.ts` | Аппенд чанков в консоль, side effects по типам |
| `ui/src/run/runSessionStore.ts` | При необходимости — отдельный счётчик/сжатие для `process_output` при сохранении лимита строк |
| `doc/IMPLEMENTED_FEATURES.md` | Факт: стрим + буфер |
| `doc/COMPETITIVE_ANALYSIS.md` | Сузить формулировки пробела по §3.7 / §39.2 после поставки |

---

## Фаза A — Контракт и ядро: `process_output` (обязательная база)

Критерии фазы A: зелёные **`test_process_exec_streaming.py`**, схема и UI — как в [`../IMPLEMENTED_FEATURES.md`](../IMPLEMENTED_FEATURES.md) (тот же раздел).

Критерий готовности фазы A: **выполнено** в продуктивном дереве (`pytest` / `npm test` по затронутым модулям).

Команды проверки:

```bash
cd python && pip install -e ".[dev]" && pytest -q
cd ../ui && npm test && npm run build
```

---

## Фаза B — Ограниченная очередь в `process_exec` (backpressure ядра)

**Статус:** реализовано — **`maxsize`**, читатели блокируются на **`put`**, главный цикл **`get(timeout)`**; см. [`../IMPLEMENTED_FEATURES.md`](../IMPLEMENTED_FEATURES.md).

- [ ] (опционально) Явная заметка в `python/README.md`.
- [ ] (опционально) Тест с искусственно медленным `emit`.

```bash
cd python && pytest -q tests/test_process_exec_streaming.py
```

---

## Фаза C — Run broker (dev web): bounded `RunBroadcaster`

**Контекст:** [`RunBroadcaster.subscribe`](../../python/graph_caster/run_broker/broadcaster.py) создаёт `queue.Queue()` без лимита; `broadcast` делает `put` без блокировки — при медленном SSE клиенте память растёт.

- [ ] Заменить на `queue.Queue(maxsize=N)` (константа в модуле, например `GC_RUN_BROKER_SUB_QUEUE_MAX`, читаемая из env в `app.py` при необходимости).
- [ ] В `broadcast`: при полной очереди — **либо** `put(..., timeout=…)` с логом **drop** для подписчика (и метрика счётчика), **либо** отключение «отстающего» подписчика после K дропов (простая защита).
- [ ] Интеграционный тест: mock медленного consumer + flood сообщений → не превышает ожидаемый порог объектов в памяти (или счётчик дропов срабатывает).

Файлы: `python/graph_caster/run_broker/broadcaster.py`, при необходимости `app.py`.

```bash
cd python && pytest -q tests/test_run_broker*.py
```

(если тестов нет — создать `tests/test_run_broker_backpressure.py`).

---

## Фаза D — Десктоп (Tauri): осознанный лимит на частоту `emit`

**Контекст:** [`run_bridge.rs`](../../ui/src-tauri/src/run_bridge.rs) эмитит каждую строку stdout; после фазы A одна логическая «строка NDJSON» может дробиться на много `process_output` — частота выше.

- [ ] Измерить/зафиксировать: при нагрузочном тесте (скрипт печатает быстро) UI остаётся отзывчивым; если нет — ввести **coalesce** в Rust (буфер на `runId` + flush по таймеру 50–100 ms) **или** только в TS (`runSessionAppendLineForRun` батчит текст для одного `runId`/`seq`).
- [ ] Минимальная правка: документировать в плане/ README, что **`MAX_LINES_PER_RUN`** режет хвост; для чисто бинарного/объёмного stdout пользователь смотрит артефакты или файл.

```bash
cd ui && npm test && npm run build
cd src-tauri && cargo check
```

---

## Фаза E — Документация и конкурентный статус

- [ ] [`doc/IMPLEMENTED_FEATURES.md`](../IMPLEMENTED_FEATURES.md): подраздел «Потоковый вывод `task` + буферы» — ссылки на схему, `process_exec`, broker, лимит строк UI.
- [ ] [`doc/COMPETITIVE_ANALYSIS.md`](../COMPETITIVE_ANALYSIS.md): в §3.7 / §39.2 убрать или сузить формулировку «нет потоковой разбивки», добавить **Evidence** на план и пути.

---

## Что сознательно не входит в этот план

- **Полный F6:** параллельное исполнение веток в одном процессе, Redis, n8n queue-mode — см. [`doc/COMPETITIVE_ANALYSIS.md`](../COMPETITIVE_ANALYSIS.md) §13.1.
- **WebSocket + `ExecutionPushMessage` уровня n8n** — отдельная тема **§39** для Aura/прод; здесь только **file-first** и dev **SSE**.
- **Redaction / двухкадровая доставка** как n8n `nodeExecuteAfter` / `nodeExecuteAfterData` — при появлении секретов в событиях (**§3.2.2**), не в этой фазе.

---

## Self-review

- Пути относительно корня graph-caster; тестовые команды указаны.
- Фаза A делегирует детали существующему плану стриминга — без дублирования длинных блоков кода.
- Граница «ядро NDJSON не размывать» (цитата §13.2 competitive) соблюдена: меняются буферы и политики, не семантика типов событий.

**Сохранено:** `doc/plans/2026-03-28-architecture-live-logs-and-transport-backpressure.md`
