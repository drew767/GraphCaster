# Ограничение буфера исполнение → транспорт (backpressure §39.2) — план реализации

> **For agentic workers:** следовать **executing-plans** очереди; шаги с `- [ ]`.

**Goal:** Зафиксировать в коде GraphCaster тот же архитектурный принцип, что у зрелых оркестраторов: **раннер не должен накапливать неограниченную память**, если клиент (браузер EventSource, Tauri IPC) читает события медленнее, чем `task` или CLI пишут в stdout. После появления высокочастотных **`process_output`** NDJSON-строк это становится критическим узким местом.

**Architecture:** Разделить **(1)** производство нормализованных строк NDJSON (`graph_caster run`, `process_exec`) и **(2)** **транспорт** до UI (`run_broker.RunBroadcaster`, SSE `StreamingResponse`, Tauri `gc-run-event`). Ввести **явную политику переполнения** на границе (2): ограниченные очереди, учёт дропа, без изменения семантики успешного завершения прогона (итоговые `process_complete` / `run_finished` остаются валидными).

**Tech stack:** Python 3.11 (`queue.Queue`, `threading`), Starlette SSE, Rust Tauri bridge (по необходимости пакетирование), существующий контракт `schemas/run-event.schema.json`.

**Связь с другими планами:** инкрементальная эмиссия из ноды **`task`** (**`process_output`**) — [`doc/IMPLEMENTED_FEATURES.md`](../IMPLEMENTED_FEATURES.md). Этот документ закрывает **транспортный** слой (брокер / подписчики), без которого высокий поток событий всё ещё рискован для памяти на границе SSE.

---

## Почему этот пункт приоритетен (архитектура + функционал)

1. **Конкуренты:** у **n8n** при relay крупных payload действует явный порог (~5 MiB) и отказ ретрансляции с опорой UI на метаданные (**§3.2.1** `COMPETITIVE_ANALYSIS.md`). У **ComfyUI** доставка в WebSocket идёт через `asyncio.Queue` без жёсткого cap — в документе зафиксирован риск роста памяти при медленном клиенте (**§13.3**). У **Dify** очередь между GraphEngine и HTTP/SSE — стандартный паттерн «не блокировать движок» (**§3.6**). **GraphCaster** уже разделяет уровни концептуально, но **`RunBroadcaster.broadcast` → `queue.Queue()` без `maxsize`** для каждого подписчика SSE — потенциально **неограниченный** буфер (`run_broker/broadcaster.py`, `registry.py` `pump_out`/`pump_err`).

2. **Наилучший вариант для GC (не копировать n8n целиком):**  
   - Сохранить **один канал на `runId`** и плоские NDJSON-строки (**§3.7**).  
   - На границе **брокер → SSE** ввести **`maxsize` > 0** и политику **drop-newest** или **coalesce** для шумных потоков: при переполнении либо отбрасывать хвост с **счётчиком** (одна служебная строка/событие), либо агрегировать мелкие куски (батч в отдельном потоке).  
   - Аналог **n8n** «сначала метаданные, тело опционально» для GC = **обязательные** граничные события (`run_started`, `run_finished`, `process_complete`) не дропать; **опционально** дропать/сжимать промежуточные **`process_output`** с явным счётчиком **`stream_dropped_chunks`** в новом поле или отдельном типе события (минимальное расширение схемы).

3. **Ограничение области:** не внедрять Redis/pub-sub (**§39** «полный паритет») в субмодуле; только **in-process** backpressure для dev-брокера и зеркала поведения для Tauri.

---

## Карта файлов (до задач)

| Путь | Роль |
|------|------|
| `python/graph_caster/run_broker/broadcaster.py` | Сейчас: неограниченные `queue.Queue`; заменить на bounded + политика. |
| `python/graph_caster/run_broker/registry.py` | Потоки `pump_out` / `pump_err`: при необходимости не блокировать навечно на `put` (таймаут/дроп). |
| `python/graph_caster/run_broker/app.py` | SSE: опционально заголовки/heartbeat; без смены URL. |
| `schemas/run-event.schema.json` | Опционально: `stream_throttle` или поля в `process_output` для `droppedChunks` — только если выбрана видимость в UI. |
| `ui/src/run/useRunBridge.ts` / `webRunBroker.ts` | Отображение предупреждения «часть вывода отброшена» при наличии поля. |
| `ui/src-tauri/` | При нагрузочном тесте: батчирование `emit` (отдельный подпункт). |
| `doc/IMPLEMENTED_FEATURES.md` | Зафиксировать политику буфера. |
| `doc/COMPETITIVE_ANALYSIS.md` | §39.2 — отметить закрытый срез или «частично». |

---

## Эталон поведения (acceptance)

1. Синтетический тест: дочерний процесс печатает **> N** строк/сек в stdout; один медленный SSE-клиент (читает с `sleep`); **RSS процесса брокера** не растёт без верхней границы (порог задать в тесте эвристически, например стабилизация после первых M секунд).  
2. После завершения прогона в буфере UI либо полный лог (если политика успела), либо лог + **явная пометка** о дропе.  
3. Отмена Run и **`run_finished`** остаются корректными; нет дедлока между `pump_*` и медленным подписчиком.

---

## Задачи

### Task 1 — Контракт дропа (минимальный)

- [ ] Решение: **вариант A** — новый тип **`stream_backpressure`** в `run-event.schema.json` (`runId`, `nodeId` опционально, `droppedChunks`, `reason`: `sse_slow` | `queue_full`) **или** **вариант B** — только расширение **`process_output`** полем `droppedBefore` ( cumulative). Зафиксировать один вариант в ADR-комментарии в начале PR-описания.
- [ ] Тест схемы: `python/tests/test_run_event_schema.py`.

### Task 2 — `RunBroadcaster`

- [ ] Ввести `RunBroadcasterConfig` (`max_queue_depth: int`, `policy: literal["drop_oldest", "drop_newest"]` — выбрать одну по умолчанию, согласованную с UX).
- [ ] `subscribe()` создаёт `queue.Queue(maxsize=config.max_queue_depth)`.
- [ ] `broadcast`: при полной очереди — инкремент счётчика дропа на **RegisteredRun** или на **FanOutMsg** метаданные; периодически (не чаще 1 раз в 100 ms на run) эмитить агрегированное предупреждение в поток **out** как валидную NDJSON-строку (если выбран вариант события из Task 1).
- [ ] Юнит-тесты: `python/tests/test_run_broker_backpressure.py` (без сети: mock consumer медленный).

### Task 3 — Интеграция с `registry.py`

- [ ] Убедиться, что **`pump_out`** не блокирует бесконечно: если `broadcast` использует блокирующий `put`, заменить на `put_nowait` + учёт дропа согласованно с Task 2.
- [ ] Поток `waiter` корректно завершает подписчиков при `exit`.

### Task 4 — UI

- [ ] Если в поток попала строка типа `stream_backpressure` / расширенный `process_output` — одна строка в консоли с i18n ключом **`app.run.console.outputTruncated`** (en/ru).
- [ ] Vitest: парсер + side effect.

### Task 5 — Документация

- [ ] `doc/IMPLEMENTED_FEATURES.md` — подраздел «Транспорт Run / backpressure».
- [ ] `doc/COMPETITIVE_ANALYSIS.md` — §39.2: ссылка на реализацию.

### Task 6 — Проверки

```bash
cd python
pip install -e ".[dev]"
pytest -q tests/test_run_broker_backpressure.py tests/test_run_event_schema.py
```

```bash
cd ui
npm test
npm run build
```

Ожидаемо: exit 0.

---

## Review (self-check)

- Пути относительно корня репозитория graph-caster указаны.
- Зависимость от **`process_output`** в раннере учтена; без bounded transport высокочастотный вывод остаётся опасным.
- Redis/мульти-инстанс вне scope — соответствует **§13** «хост Aura».

**Сохранено:** `doc/plans/2026-03-28-execution-transport-backpressure.md`
