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
python -m graph_caster artifacts-size --base .
python -m graph_caster artifacts-size --base . --graph-id '<uuid>'
python -m graph_caster artifacts-clear --base . --all
python -m graph_caster artifacts-clear --base . --graph-id '<uuid>'
```

Старый вызов **`python -m graph_caster -d …`** по-прежнему работает (автоматически трактуется как подкоманда **`run`**).

- **`run`:** **`-g` / `--graphs-dir`** — каталог с `*.json` для нод **`graph_ref`**; **`--artifacts-base`** — корень воркспейса с **`runs/<graphId>/…`** и **`root_run_artifact_dir`** в контексте.
- **`artifacts-size`:** вывод суммарного размера в байтах (**`runs/`** целиком или **`--graph-id`**).
- **`artifacts-clear`:** **`--all`** или **`--graph-id`** — удаление дерева артефактов.

**`RunHostContext`** (`graph_caster.host_context`): каталог **`graphs_root`** для **`graph_ref`** и **`artifacts_base`** для **`runs/<graphId>/…`**. Передаётся в **`GraphRunner(..., host=…)`**; устаревший сахар **`graphs_root=`** на конструкторе сводится к тому же. Словарь **`run` / `run_from` `context`** — только состояние прогона (**`node_outputs`**, **`last_result`**, **`root_run_artifact_dir`**, …). Ключи **`graphs_root`** и **`artifacts_base`** в **`context`** игнорируются (**удаляются при старте прогона**); задавайте их только через **`host=`**.

Из кода (для UI / обслуживания): **`artifacts_tree_bytes_for_graph`**, **`artifacts_runs_total_bytes`**, **`clear_artifacts_for_graph`**, **`clear_all_artifact_runs`**, **`tree_bytes`** — см. пакет **`graph_caster.artifacts`**.

**Нода `task` с подпроцессом:** в **`data`** задайте **`command`** (строка или список аргументов) или **`argv`**. Опционально: **`cwd`**, **`env`** (объект строк — дополняет **`os.environ`**), **`successMode`** (`exit_code` / `stdout` / `marker_file`), **`timeoutSec`**, **`retryCount`**, **`retryBackoffSec`**. Логика в **`graph_caster.process_exec`**.

Полная документация репозитория: [../README.md](../README.md).
