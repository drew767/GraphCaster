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

**Структура графа:** перед прогоном **`GraphRunner`** проверяет **`validate_graph_structure`** (один **`start`**, без входящих в него, валидный **`graphId`**, **совместимость ручек** **`source_handle`/`target_handle`** с типом ноды — как у коннекторов n8n / проверки рёбер в Langflow/Dify; см. **`find_handle_compatibility_violations`**). **`find_unreachable_non_comment_nodes`** в **`graph_caster.validate`** — тот же статический снимок «ноды вне обхода от `start`», что предупреждение в UI (все рёбра считаются проходимыми). **`run` и раннер не отклоняют** документ **только** из‑за недостижимых нод; это намеренно (совет, а не жёсткая ошибка).

**`RunHostContext`** (`graph_caster.host_context`): каталог **`graphs_root`** для **`graph_ref`** и **`artifacts_base`** для **`runs/<graphId>/…`**. Передаётся в **`GraphRunner(..., host=…)`**; устаревший сахар **`graphs_root=`** на конструкторе сводится к тому же. Словарь **`run` / `run_from` `context`** — только состояние прогона (**`node_outputs`**, **`last_result`**, **`root_run_artifact_dir`**, …). Ключи **`graphs_root`** и **`artifacts_base`** в **`context`** игнорируются (**удаляются при старте прогона**); задавайте их только через **`host=`**.

Корневой прогон (**`nesting_depth == 0`**) фиксирует **`runId`**: можно передать **`context["run_id"]`**; значения **`None`**, пустая строка или только пробелы заменяются на новый UUID. Далее шлёт **`run_started`** (**`startedAt`**, **`mode`** — по умолчанию **`manual`**, задайте **`run_mode`** в **`context`** как у n8n execution mode, опционально **`graphTitle`** из **`meta.title`**) и **`run_finished`** с **`status`** ∈ **`success`** \| **`failed`** \| **`cancelled`**, **`finishedAt`**. То же **`runId`** на всех строках NDJSON, включая вложенный **`graph_ref`**. При ветвлении после узла (как явные «ветки» в логе n8n): перед **`edge_traverse`** возможны **`branch_skipped`** (`reason`: **`condition_false`**) и **`branch_taken`** (с **`graphId`**), см. схему. Для потребителей потока: факт перехода по ребру по-прежнему задаёт **`edge_traverse`**; **`branch_taken`** / **`branch_skipped`** — семантика ветвления (можно не дублировать обработку, если достаточно **`edge_traverse`**). Контракт: **`schemas/run-event.schema.json`**.

**Условия на рёбрах (ветвление, как IF/Switch у n8n/Dify, без произвольного кода):** исходящие рёбра перебираются **в порядке массива `edges` в документе**; пустое или отсутствующее **`condition`** — безусловный переход (**первое** такое ребро выбирается сразу). Литералы **`true`** / **`false`** / **`1`** / **`0`** / **`yes`** / **`no`** (без JSON) — как есть. Любая другая строка, **не** начинающаяся с **`{`**, трактуется как **`bool(context["last_result"])`** (как в ранних версиях GC). Если строка — JSON-**объект** с **одной** корневой операцией, выполняется **подмножество JSON Logic** над **публичным** контекстом: из **`context`** для предиката убираются только **корневые** ключи с префиксом **`_`** (вложенные ключи внутри **`node_outputs`** / **`var`** по точкам **не** маскируются). Значения по ссылкам, как и словарь раннера: без глубокого копирования. **Truthiness GC** (итог ребра после вычисления правила): ложь для **`None`**, **`False`**, **`0`**, **`""`**, пустых **`list`** / **`dict`**; иначе истина — не полный паритет с каноническим JSON Logic. **`edge_conditions.MAX_EDGE_CONDITION_CHARS`** (**65536**): если длина строки после **`strip()`** больше, условие считается **ложным** (защита от чрезмерно длинных выражений / парсинга). Поддерживаемые операторы: **`==`**, **`!=`**, **`>`**, **`>=`**, **`<`**, **`<=`**, **`!`**, **`!!`**, **`and`**, **`or`**, **`if`**, **`var`**, **`in`**, **`max`**, **`min`**, **`%`**, **`cat`**. Реализация: **`graph_caster.edge_conditions`**. Примеры:

- После успешного шага (флаг успеха subprocess): `{"==":[{"var":"last_result"},true]}`
- По коду выхода ноды **`t1`**: `{"==":[{"var":"node_outputs.t1.processResult.exitCode"},0]}`

**Ветка после ошибки (`sourceHandle` → `out_error`, аналог FAIL_BRANCH у Dify):** при неуспехе **`task`** после исчерпания ретраев или при неуспешном **`graph_ref`** (без отмены) раннер сначала обрабатывает только рёбра с **`out_error`**; порядок и условия — как у обычного ветвления. Рёбра с любым другим **`sourceHandle`** (в т.ч. **`out_default`**) используются на **успешном** выходе из ноды. В **`branch_taken`** / **`edge_traverse`** для такого перехода задаётся **`route":"error"`**. **Отмена** (**`cancel_requested`**, флаг процесса) **не** направляет по **`out_error`**.

После каждого завершения попытки **`task`** с подпроцессом в **`node_outputs[nodeId].processResult`** пишутся **`exitCode`**, **`success`**, **`timedOut`**, **`cancelled`**, объёмы stdout/stderr (в символах), в том числе при финальной ошибке или **`spawn_error`** (**`exitCode`**: **`-1`**).

**Сессии и отмена:** передайте **`session_registry=RunSessionRegistry()`** или **`get_default_run_registry()`** в **`GraphRunner`**. Методы реестра: **`register`** / **`complete`** (вызывается раннером), **`get`**, **`request_cancel`**, **`running_sessions`**. При отмене между шагами эмитится **`run_end`** с **`reason`** **`cancel_requested`**, затем **`run_finished`** с **`status: "cancelled"`**.

Из кода (для UI / обслуживания): **`artifacts_tree_bytes_for_graph`**, **`artifacts_runs_total_bytes`**, **`clear_artifacts_for_graph`**, **`clear_all_artifact_runs`**, **`tree_bytes`** — см. пакет **`graph_caster.artifacts`**.

**Нода `task` с подпроцессом:** в **`data`** задайте **`command`** (строка или список аргументов) или **`argv`**. Опционально: **`cwd`**, **`env`** (объект строк — дополняет **`os.environ`**), **`successMode`** (`exit_code` / `stdout` / `marker_file`), **`timeoutSec`**, **`retryCount`**, **`retryBackoffSec`**. Логика в **`graph_caster.process_exec`**. Если отмена сработала **до** **`process_spawn`**, событий **`process_*`** для этой попытки нет — корректный итог по-прежнему **`run_finished`** / **`run_end`** с отменой.

**Отладка `control-stdin`:** переменная окружения **`GC_CONTROL_STDIN_DEBUG=1`** — в **stderr** печатаются строки stdin с ошибкой разбора JSON.

**Сброс глобального реестра (тесты):** **`reset_default_run_registry()`** обнуляет синглтон от **`get_default_run_registry()`**.

**Встроенный Run в десктопном UI (GraphCaster / Tauri):** дочерний процесс вызывает тот же CLI:  
`run -d <path/to/temp.json> --track-session --control-stdin --run-id <uuid>`  
плюс при необходимости **`-g` / `--graphs-dir`** (каталог `graphs/` на диске для **`graph_ref`**) и **`--artifacts-base`** (корень воркспейса, где создаётся **`runs/<graphId>/…`**). STDOUT процесса — **NDJSON по строкам**; в STDIN хост пишет **`{"type":"cancel_run","runId":"<uuid>"}`** для отмены (один канал stdin, поэтому документ графа передаётся только через **`-d`**, не через stdin). Переменные окружения для поиска интерпретатора и пакета: **`GC_PYTHON`**, **`GC_GRAPH_CASTER_PACKAGE_ROOT`** (добавляется в **`PYTHONPATH`** при проверке импорта и при spawn).

Полная документация репозитория: [../README.md](../README.md).
