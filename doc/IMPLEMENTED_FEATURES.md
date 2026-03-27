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
| Завершение с явным статусом | **`run_finished`**: `status` (`success` \| `failed`), **`finishedAt`**; всегда последнее событие корневого кадра (`try`/`finally`) |
| Нормализация пустого / невалидного `run_id` из контекста | Пустое / `None` / пробелы → новый UUID; см. `_normalize_run_id_candidate` в `runner.py` |
| Ограничение размера `mode` в потоке | Обрезка до 128 символов |

Контракт: `schemas/run-event.schema.json`. Код: `python/graph_caster/runner.py` (`emit`, `run_from`, вложенный `GraphRunner(..., run_id=…)`).

**Намеренно не перенесено** (см. обсуждение в `COMPETITIVE_ANALYSIS.md` §3.2.1–§3.2.4): `ExecutionPushMessage` целиком, `pushRef`, WebSocket/SSE, redaction / `flattedRunData`, relay кадров.

---

## Связанные артефакты run (уже было до жизненного цикла, уточнение слоя)

- Каталог run под корневым графом, событие **`run_root_ready`**, проброс **`root_run_artifact_dir`** во вложенные вызовы — `artifacts.py`, `runner.py` (см. также `DEVELOPMENT_PLAN.md` фаза 2).

---

*Обновляйте этот файл при закрытии новых пунктов из `COMPETITIVE_ANALYSIS.md`, чтобы не дублировать «сделано» в тексте про конкурентов.*
