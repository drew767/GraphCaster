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

## Сессия прогона в NDJSON (n8n `executionStarted` / `executionFinished`, один `runId`)

| Идея конкурента | Реализация GC |
|-----------------|---------------|
| Стабильный идентификатор исполнения на потоке событий | Поле **`runId`** (UUID) на всех событиях корневого прогона и вложенного `graph_ref` |
| Старт сессии: id, workflow/graph, время, режим, имя | **`run_started`**: `rootGraphId`, `startedAt`, **`mode`** (по умолчанию `manual`, `context["run_mode"]`), опционально **`graphTitle`** из `meta.title` |
| Завершение с явным статусом | **`run_finished`**: `status` (`success` \| `failed` \| `cancelled`), **`finishedAt`**; всегда последнее событие корневого кадра (`try`/`finally`) |
| Нормализация пустого / невалидного `run_id` из контекста | Пустое / `None` / пробелы → новый UUID; см. `_normalize_run_id_candidate` в `runner.py` |
| Ограничение размера `mode` в потоке | Обрезка до 128 символов |

Контракт: `schemas/run-event.schema.json`. Код: `python/graph_caster/runner.py` (`emit`, `run_from`, вложенный `GraphRunner(..., run_id=…)`).

**Намеренно не перенесено** (см. обсуждение в `COMPETITIVE_ANALYSIS.md` §3.2.1–§3.2.4): `ExecutionPushMessage` целиком, `pushRef`, WebSocket/SSE, redaction / `flattedRunData`, relay кадров.

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

**Сопоставление с §3.2 competitive doc (Dify / n8n):** срез **«команда abort / адресация исполнения по id»** сведён сюда (`CommandChannel` у Dify — полноценный pause/redis; у GC пока in-process + stdin). **`IRunExecutionData` / `executionId`** у n8n — частичный параллель: реестр **`RunSessionRegistry`** и стабильный **`runId`** на событиях; **без** очереди ready-nodes и **без** WebSocket **`pushRef`** (по-прежнему открыто в `COMPETITIVE_ANALYSIS.md` §3.2.1 / §39).

---

## Связанные артефакты run (уже было до жизненного цикла, уточнение слоя)

- Каталог run под корневым графом, событие **`run_root_ready`**, проброс **`root_run_artifact_dir`** во вложенные вызовы — `artifacts.py`, `runner.py` (см. также `DEVELOPMENT_PLAN.md` фаза 2).

---

*Обновляйте этот файл при закрытии новых пунктов из `COMPETITIVE_ANALYSIS.md`, чтобы не дублировать «сделано» в тексте про конкурентов.*
