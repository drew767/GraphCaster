# graph-caster (Python)

Интерпретатор графа: JSON-документ → обход → пошаговое выполнение с колбеками/стримом событий.

Установка из этой папки:

```bash
pip install -e .
pip install -e ".[dev]"
pytest -q
```

Запуск CLI:

```bash
python -m graph_caster --help
python -m graph_caster run -d ../schemas/graph-document.example.json -s start1
python -m graph_caster -d ../schemas/graph-document.example.json -s start1
python -m graph_caster run -d graph.json -g ./graphs --artifacts-base .
python -m graph_caster run -d graph.json --track-session
python -m graph_caster run -d graph.json --track-session --control-stdin --run-id 550e8400-e29b-41d4-a716-446655440000
python -m graph_caster artifacts-size --base .
python -m graph_caster artifacts-size --base . --graph-id '<uuid>'
python -m graph_caster artifacts-clear --base . --all
python -m graph_caster artifacts-clear --base . --graph-id '<uuid>'
```

Старый вызов **`python -m graph_caster -d …`** по-прежнему работает (автоматически трактуется как подкоманда **`run`**).

- **`run`:** **`-g` / `--graphs-dir`** — каталог с `*.json` для нод **`graph_ref`**; **`--artifacts-base`** — корень воркспейса с **`runs/<graphId>/…`** и **`root_run_artifact_dir`** в контексте; **`--track-session`** — регистрировать корневой прогон в процессном **`RunSessionRegistry`**; **`--control-stdin`** (только с **`--track-session`**) — читать из stdin команды **`{"type":"cancel_run","runId":"…"}`**; **`--run-id`** — зафиксировать **`runId`** корневого прогона (удобно для отмены с другой консоли).
- **`artifacts-size`:** вывод суммарного размера в байтах (**`runs/`** целиком или **`--graph-id`**).
- **`artifacts-clear`:** **`--all`** или **`--graph-id`** — удаление дерева артефактов.

**`RunHostContext`** (`graph_caster.host_context`): каталог **`graphs_root`** для **`graph_ref`** и **`artifacts_base`** для **`runs/<graphId>/…`**. Передаётся в **`GraphRunner(..., host=…)`**; устаревший сахар **`graphs_root=`** на конструкторе сводится к тому же. Словарь **`run` / `run_from` `context`** — только состояние прогона (**`node_outputs`**, **`last_result`**, **`root_run_artifact_dir`**, …). Ключи **`graphs_root`** и **`artifacts_base`** в **`context`** игнорируются (**удаляются при старте прогона**); задавайте их только через **`host=`**.

Корневой прогон (**`nesting_depth == 0`**) фиксирует **`runId`**: можно передать **`context["run_id"]`**; значения **`None`**, пустая строка или только пробелы заменяются на новый UUID. Далее шлёт **`run_started`** (**`startedAt`**, **`mode`** — по умолчанию **`manual`**, задайте **`run_mode`** в **`context`** как у n8n execution mode, опционально **`graphTitle`** из **`meta.title`**) и **`run_finished`** с **`status`** ∈ **`success`** \| **`failed`** \| **`cancelled`**, **`finishedAt`**. То же **`runId`** на всех строках NDJSON, включая вложенный **`graph_ref`**. Контракт: **`schemas/run-event.schema.json`**.

**Сессии и отмена:** передайте **`session_registry=RunSessionRegistry()`** или **`get_default_run_registry()`** в **`GraphRunner`**. Методы реестра: **`register`** / **`complete`** (вызывается раннером), **`get`**, **`request_cancel`**, **`running_sessions`**. При отмене между шагами эмитится **`run_end`** с **`reason`** **`cancel_requested`**, затем **`run_finished`** с **`status: "cancelled"`**.

Из кода (для UI / обслуживания): **`artifacts_tree_bytes_for_graph`**, **`artifacts_runs_total_bytes`**, **`clear_artifacts_for_graph`**, **`clear_all_artifact_runs`**, **`tree_bytes`** — см. пакет **`graph_caster.artifacts`**.

**Нода `task` с подпроцессом:** в **`data`** задайте **`command`** (строка или список аргументов) или **`argv`**. Опционально: **`cwd`**, **`env`** (объект строк — дополняет **`os.environ`**), **`successMode`** (`exit_code` / `stdout` / `marker_file`), **`timeoutSec`**, **`retryCount`**, **`retryBackoffSec`**. Логика в **`graph_caster.process_exec`**. Если отмена сработала **до** **`process_spawn`**, событий **`process_*`** для этой попытки нет — корректный итог по-прежнему **`run_finished`** / **`run_end`** с отменой.

**Отладка `control-stdin`:** переменная окружения **`GC_CONTROL_STDIN_DEBUG=1`** — в **stderr** печатаются строки stdin с ошибкой разбора JSON.

**Сброс глобального реестра (тесты):** **`reset_default_run_registry()`** обнуляет синглтон от **`get_default_run_registry()`**.

**Встроенный Run в десктопном UI (GraphCaster / Tauri):** дочерний процесс вызывает тот же CLI:  
`run -d <path/to/temp.json> --track-session --control-stdin --run-id <uuid>`  
плюс при необходимости **`-g` / `--graphs-dir`** (каталог `graphs/` на диске для **`graph_ref`**) и **`--artifacts-base`** (корень воркспейса, где создаётся **`runs/<graphId>/…`**). STDOUT процесса — **NDJSON по строкам**; в STDIN хост пишет **`{"type":"cancel_run","runId":"<uuid>"}`** для отмены (один канал stdin, поэтому документ графа передаётся только через **`-d`**, не через stdin). Переменные окружения для поиска интерпретатора и пакета: **`GC_PYTHON`**, **`GC_GRAPH_CASTER_PACKAGE_ROOT`** (добавляется в **`PYTHONPATH`** при проверке импорта и при spawn).

Полная документация репозитория: [../README.md](../README.md).
