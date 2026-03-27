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

- **`run`:** **`-g` / `--graphs-dir`** — каталог с `*.json` для нод **`graph_ref`**; **`--artifacts-base`** — корень воркспейса с **`runs/<graphId>/…`** и **`root_run_artifact_dir`** в контексте; **`--track-session`** — регистрировать корневой прогон в процессном **`RunSessionRegistry`**; **`--control-stdin`** (только с **`--track-session`**) — читать из stdin команды **`{"type":"cancel_run","runId":"…"}`**; **`--run-id`** — зафиксировать **`runId`** корневого прогона (удобно для отмены с другой консоли). **`--until-node <id>`** — остановка после успешного завершения этой ноды: обход как обычно от документного **`start`**, в **`run_finished`** уходит **`status: "partial"`** (отладочный режим как «дойти до шага» у Dify/Langflow). **`--until-node`** и **`--start`** вместе: точка входа всё равно **`start`**, **`--start`** игнорируется (предупреждение в stderr). **`--context-json <path>`** — JSON-объект с полем **`node_outputs`**: значения мержатся в контекст до прогона (пиннутые выходы предков при **`--start`** с середины графа, по смыслу **`flattedRunData`** / partial run у n8n).

  **Межпрогонный кэш шагов (F17):** **`--step-cache`** требует **`--artifacts-base`**. Кэшируются только **`task`** с **`data.stepCache`**: ключ SHA-256 от **`graph_document_revision`**, **`graphId`**, id ноды, канонического **`data`** (без **`stepCache`**) и **SHA-256-отпечатка** канонического среза **`node_outputs`** предков по рёбрам не из **`out_error`** (полный срез в материал ключа не сериализуется); файлы в **`runs/<graphId>/step-cache/v1/`**; в потоке — **`node_cache_hit`** / **`node_cache_miss`** с **`keyPrefix`** (16 hex). **`--step-cache-dirty id1,id2`** — без чтения кэша для этих нод (как **dirty** у n8n); после успешного прогона запись обновляется.

**Граничные случаи `--until-node` / `GraphRunner(..., stop_after_node_id=…)`:** **`id`** — только нода **текущего корневого** JSON; вложенный **`graph_ref`** выполняется **до конца** (вложенный раннер без stop-after). Если целевая нода **не достигнута** (ветки, условия, более ранняя ошибка), **`run_finished`** будет **`failed`**, не **`partial`**. Если **`id`** — нода **`exit`**, итог **`success`**, не **`partial`**. Нода **`comment`** посещается как обычно — остановка на ней даёт **`partial`**, если это выбранный **`id`**.

- **`artifacts-size`:** вывод суммарного размера в байтах (**`runs/`** целиком или **`--graph-id`**).
- **`artifacts-clear`:** **`--all`** или **`--graph-id`** — удаление дерева артефактов.

**Структура графа:** перед прогоном **`GraphRunner`** проверяет **`validate_graph_structure`** (один **`start`**, без входящих в него, валидный **`graphId`**, **совместимость ручек** **`source_handle`/`target_handle`** с типом ноды — как у коннекторов n8n / проверки рёбер в Langflow/Dify; см. **`find_handle_compatibility_violations`**). **`find_unreachable_non_comment_nodes`** в **`graph_caster.validate`** — тот же статический снимок «ноды вне обхода от `start`», что предупреждение в UI (все рёбра считаются проходимыми). **`run` и раннер не отклоняют** документ **только** из‑за недостижимых нод; это намеренно (совет, а не жёсткая ошибка).

**`RunHostContext`** (`graph_caster.host_context`): каталог **`graphs_root`** для **`graph_ref`** и **`artifacts_base`** для **`runs/<graphId>/…`**. Передаётся в **`GraphRunner(..., host=…)`**; устаревший сахар **`graphs_root=`** на конструкторе сводится к тому же. Словарь **`run` / `run_from` `context`** — только состояние прогона (**`node_outputs`**, **`last_result`**, **`root_run_artifact_dir`**, …). Ключи **`graphs_root`** и **`artifacts_base`** в **`context`** игнорируются (**удаляются при старте прогона**); задавайте их только через **`host=`**.

**Архитектура раннера (срез F6, без worker pool):** события прогона уходят только через **`RunEventSink`** (`graph_caster.run_event_sink`): **`emit(event: RunEventDict)`** (`dict[str, Any]`; без thread-safety по умолчанию) — как **Langflow** `EventManager` / очередь перед HTTP, но без `asyncio`. CLI по умолчанию использует **`NdjsonStdoutSink`**. Обход графа — **FIFO очередь** следующих визитов нод (**`StepQueue`**, **`ExecutionFrame`**) в одном потоке; отмена **между шагами** опрашивается в начале каждой итерации. Вложенный **`graph_ref`** по-прежнему через дочерний **`GraphRunner`** с тем же sink.

Корневой прогон (**`nesting_depth == 0`**) фиксирует **`runId`**: можно передать **`context["run_id"]`**; значения **`None`**, пустая строка или только пробелы заменяются на новый UUID. Далее шлёт **`run_started`** (**`startedAt`**, **`mode`** — по умолчанию **`manual`**, задайте **`run_mode`** в **`context`** как у n8n execution mode, опционально **`graphTitle`** из **`meta.title`**) и **`run_finished`** с **`status`** ∈ **`success`** \| **`failed`** \| **`cancelled`** \| **`partial`**, **`finishedAt`**. **`partial`** — ранний выход по **`stop_after_node_id`** / **`--until-node`**, когда остановка реально произошла на корневом пути (см. граничные случаи выше). То же **`runId`** на всех строках NDJSON, включая вложенный **`graph_ref`**. При ветвлении после узла (как явные «ветки» в логе n8n): перед **`edge_traverse`** возможны **`branch_skipped`** (`reason`: **`condition_false`**) и **`branch_taken`** (с **`graphId`**), см. схему. Для потребителей потока: факт перехода по ребру по-прежнему задаёт **`edge_traverse`**; **`branch_taken`** / **`branch_skipped`** — семантика ветвления (можно не дублировать обработку, если достаточно **`edge_traverse`**). Контракт: **`schemas/run-event.schema.json`**.

**Условия на рёбрах (ветвление, как IF/Switch у n8n/Dify, без произвольного кода):** исходящие рёбра перебираются **в порядке массива `edges`**; пустое или отсутствующее **`condition`** — безусловный переход (**первое** такое ребро выбирается сразу).

Порядок разбора строки условия (**`graph_caster.edge_conditions.eval_edge_condition`**, после **`strip()`**):

1. Если длина > **`MAX_EDGE_CONDITION_CHARS`** (**65536**) — условие **ложно**.
2. Если строка — литерал **`true`** / **`false`** / **`1`** / **`0`** / **`yes`** / **`no`** (без JSON, регистронезависимо) — вернуть соответствующий булев результат.
3. Если строка **начинается** с **`{{`** — режим **шаблонов** (mustache-пути по публичному контексту).
4. Иначе если **первый символ** **`{`**, но не **`{{`** — одна корневая операция **подмножества JSON Logic** над публичным контекстом (из **`context`** для предиката убираются только **корневые** ключи с префиксом **`_`**).
5. Иначе если строка **содержит** **`{{`** — снова режим **шаблонов**.
6. Иначе — **`bool(context["last_result"])`** (ранний режим GC).

**Шаблоны** (как `{{$json…}}` у n8n, без VM): только целая строка вида **`{{ dotted.path }}`** (truthiness) или **`{{ dotted.path }}`** + оператор **`==` `!=` `<` `<=` `>` `>=`** + литерал (число, `true`/`false`, строка в кавычках). Сегменты пути — **`[a-zA-Z_][a-zA-Z0-9_]*`** через точку; не более **32** подстановок **`{{…}}`**; для **`==`/`!=`** строковые числа и числа приводятся как в **`_coerce_num`**. Регекс сравнения **без** «многострочного» литерала (нет флага DOTALL): хвост после перевода строки в литерале не подтягивается.

**Truthiness** результата правила (в т.ч. JSON Logic): ложь для **`None`**, **`False`**, **`0`**, **`""`**, пустых **`list`** / **`dict`**; иначе истина (не полный паритет с каноническим JSON Logic). Поддерживаемые операторы JSON Logic: **`==`**, **`!=`**, **`>`**, **`>=`**, **`<`**, **`<=`**, **`!`**, **`!!`**, **`and`**, **`or`**, **`if`**, **`var`**, **`in`**, **`max`**, **`min`**, **`%`**, **`cat`**. Примеры:

- После успешного шага (флаг успеха subprocess): `{"==":[{"var":"last_result"},true]}`
- По коду выхода ноды **`t1`**: `{"==":[{"var":"node_outputs.t1.processResult.exitCode"},0]}`
- Тот же смысл шаблоном: `{{node_outputs.t1.processResult.exitCode}} == 0`

**Ветка после ошибки (`sourceHandle` → `out_error`, аналог FAIL_BRANCH у Dify):** при неуспехе **`task`** после исчерпания ретраев или при неуспешном **`graph_ref`** (без отмены) раннер сначала обрабатывает только рёбра с **`out_error`**; порядок и условия — как у обычного ветвления. Рёбра с любым другим **`sourceHandle`** (в т.ч. **`out_default`**) используются на **успешном** выходе из ноды. В **`branch_taken`** / **`edge_traverse`** для такого перехода задаётся **`route":"error"`**. **Отмена** (**`cancel_requested`**, флаг процесса) **не** направляет по **`out_error`**.

После каждого завершения попытки **`task`** с подпроцессом в **`node_outputs[nodeId].processResult`** пишутся **`exitCode`**, **`success`**, **`timedOut`**, **`cancelled`**, объёмы stdout/stderr (в символах), в том числе при финальной ошибке или **`spawn_error`** (**`exitCode`**: **`-1`**).

**Сессии и отмена:** передайте **`session_registry=RunSessionRegistry()`** или **`get_default_run_registry()`** в **`GraphRunner`**. Методы реестра: **`register`** / **`complete`** (вызывается раннером), **`get`**, **`request_cancel`**, **`running_sessions`**. При отмене между шагами эмитится **`run_end`** с **`reason`** **`cancel_requested`**, затем **`run_finished`** с **`status: "cancelled"`**.

Из кода (для UI / обслуживания): **`artifacts_tree_bytes_for_graph`**, **`artifacts_runs_total_bytes`**, **`clear_artifacts_for_graph`**, **`clear_all_artifact_runs`**, **`tree_bytes`** — см. пакет **`graph_caster.artifacts`**.

**Нода `task` с подпроцессом:** в **`data`** задайте **`command`** (строка или список аргументов) или **`argv`**. Опционально: **`cwd`**, **`env`** (объект строк — дополняет **`os.environ`**), **`successMode`** (`exit_code` / `stdout` / `marker_file`), **`timeoutSec`**, **`retryCount`**, **`retryBackoffSec`**. Логика в **`graph_caster.process_exec`**. Если отмена сработала **до** **`process_spawn`**, событий **`process_*`** для этой попытки нет — корректный итог по-прежнему **`run_finished`** / **`run_end`** с отменой.

**Отладка `control-stdin`:** переменная окружения **`GC_CONTROL_STDIN_DEBUG=1`** — в **stderr** печатаются строки stdin с ошибкой разбора JSON.

**Сброс глобального реестра (тесты):** **`reset_default_run_registry()`** обнуляет синглтон от **`get_default_run_registry()`**.

**Встроенный Run в десктопном UI (GraphCaster / Tauri):** дочерний процесс вызывает тот же CLI:  
`run -d <path/to/temp.json> --track-session --control-stdin --run-id <uuid>`  
плюс при необходимости **`-g` / `--graphs-dir`** (каталог `graphs/` на диске для **`graph_ref`**) и **`--artifacts-base`** (корень воркспейса, где создаётся **`runs/<graphId>/…`**); опционально **`--until-node`** / **`--context-json`** (см. выше). STDOUT процесса — **NDJSON по строкам**; в STDIN хост пишет **`{"type":"cancel_run","runId":"<uuid>"}`** для отмены (один канал stdin, поэтому документ графа передаётся только через **`-d`**, не через stdin). Переменные окружения для поиска интерпретатора и пакета: **`GC_PYTHON`**, **`GC_GRAPH_CASTER_PACKAGE_ROOT`** (добавляется в **`PYTHONPATH`** при проверке импорта и при spawn).

Полная документация репозитория: [../README.md](../README.md).
