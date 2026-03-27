# RunHostContext — явный контекст хоста (Python)

> **For agentic workers:** Use @superpowers:subagent-driven-development (recommended) or @superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Отделить инфраструктурные настройки запуска (**graphs root**, **artifacts base**) от словаря состояния прогона (`node_outputs`, `last_result`, `root_run_artifact_dir`, …), по аналогии с разделением документ / run state / host из `doc/COMPETITIVE_ANALYSIS.md` (n8n `additionalData`).

**Architecture:** Вводим неизменяемый по смыслу объект `RunHostContext` (dataclass), нормализующий `Path` при создании. `GraphRunner` хранит один экземпляр хоста и передаёт тот же объект во вложенные `GraphRunner` при `graph_ref`. Словарь `context` в `run` / `run_from` — только run state; ключи `graphs_root` и `artifacts_base` больше не записываются в него через `_prepare_context`. Обратная совместимость: параметр конструктора `graphs_root=` остаётся и сводится к `RunHostContext(graphs_root=...)`.

**Tech stack:** Python 3.11+, `dataclasses`, существующие модули `graph_caster.runner`, `graph_caster.__main__`, pytest.

**План сохранён:** `doc/plans/2026-03-27-run-host-context.md` (в graph-caster нет `docs/superpowers/plans/`; путь эквивалентен навыку writing-plans для этого репо).

---

## File map

| File | Responsibility |
|------|----------------|
| `python/graph_caster/host_context.py` | **`RunHostContext`**: поля `graphs_root`, `artifacts_base`; нормализация `Path.resolve()` |
| `python/graph_caster/runner.py` | `GraphRunner` держит `_host`; `_prepare_context` без host-ключей; `run_root_ready` из `host.artifacts_base`; `graph_ref` создаёт ребёнка с `host=self._host` |
| `python/graph_caster/__main__.py` | Сборка `RunHostContext` из CLI флагов, `GraphRunner(doc, sink, host=...)` |
| `python/graph_caster/__init__.py` | Экспорт `RunHostContext` в `__all__` |
| `python/tests/test_host_context.py` | Новые unit/integration тесты на границу host vs run dict |
| `python/tests/test_process_task.py` | Замена `context={"artifacts_base": ...}` на `host=RunHostContext(artifacts_base=...)` |
| `python/tests/test_graph_ref_nested.py` | Вызовы с **`host=RunHostContext(graphs_root=…)`** |
| `python/tests/test_artifacts_root_run.py` | **`host=`** вместо **`artifacts_base`** в **`context`** |
| `python/tests/test_cli_main.py` | Тест **`run`** с **`--artifacts-base`** |

**Не трогаем:** `schemas/run-event.schema.json`, `ui/`, `workspace.py` (логика индекса без изменений).

---

### Task 1: `RunHostContext` + нормализация путей

**Files:**
- Create: `python/graph_caster/host_context.py`
- Modify: `python/graph_caster/__init__.py`
- Test: `python/tests/test_host_context.py`

- [x] **Step 1: Failing test — пути нормализуются**

```python
from pathlib import Path

from graph_caster.host_context import RunHostContext


def test_run_host_context_resolves_paths(tmp_path: Path) -> None:
    sub = tmp_path / "graphs"
    sub.mkdir()
    host = RunHostContext(graphs_root=sub)
    assert host.graphs_root is not None
    assert host.graphs_root == sub.resolve()
    assert host.artifacts_base is None
```

Run: `cd python && pytest tests/test_host_context.py::test_run_host_context_resolves_paths -v`  
Expected: **FAIL** (`ModuleNotFoundError` or `RunHostContext` missing)

- [x] **Step 2: Minimal implementation**

`host_context.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RunHostContext:
    graphs_root: Path | None = None
    artifacts_base: Path | None = None

    def __post_init__(self) -> None:
        gr = Path(self.graphs_root).resolve() if self.graphs_root is not None else None
        ab = Path(self.artifacts_base).resolve() if self.artifacts_base is not None else None
        object.__setattr__(self, "graphs_root", gr)
        object.__setattr__(self, "artifacts_base", ab)
```

Export in `__init__.py`: add import and `"RunHostContext"` to `__all__`.

Run: same pytest command → **PASS**

- [ ] **Step 3: Commit** — входит в единый блок **§ Git** в конце файла *(три отдельных коммита из плана при чистом дереве; при смешанных правках — один коммит по списку путей)*.

---

### Task 2: `GraphRunner` использует `_host`, `_prepare_context` без host-ключей

**Files:**
- Modify: `python/graph_caster/runner.py`
- Modify: `python/tests/test_host_context.py`
- Modify: `python/tests/test_process_task.py`
- Modify: `python/tests/test_graph_ref_nested.py` (если нужно для единообразия)

- [x] **Step 1: Failing integration test**

Проверка без приватных полей: линейный start→exit, `host=RunHostContext(artifacts_base=tmp_path)`, событие `run_root_ready`, каталог артефакта под базой.

```python
import json
from pathlib import Path

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner


def _minimal_linear_doc(graph_id: str) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": "x"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
                "condition": None,
            }
        ],
    }


def test_linear_run_with_host_artifacts_base_emits_run_root_ready(tmp_path: Path) -> None:
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    doc = GraphDocument.from_dict(_minimal_linear_doc(gid))
    events: list = []
    GraphRunner(
        doc,
        sink=lambda e: events.append(e),
        host=RunHostContext(artifacts_base=tmp_path),
    ).run(context={"last_result": True})
    ready = [e for e in events if e.get("type") == "run_root_ready"]
    assert len(ready) == 1
    rrd = Path(ready[0]["rootRunArtifactDir"])
    assert rrd.is_dir()
    assert rrd.resolve().is_relative_to(tmp_path.resolve())
```

Run: `cd python && pytest tests/test_host_context.py::test_linear_run_with_host_artifacts_base_emits_run_root_ready -v`  
Expected: **FAIL** (`GraphRunner` без аргумента `host=` или `run_root_ready` не появляется)

- [x] **Step 2: Рефакторинг `GraphRunner`**

1. Импорт `RunHostContext`.
2. `__init__(self, document, sink=None, *, host: RunHostContext | None = None, graphs_root: Path | None = None)`:
   - если переданы и `host`, и `graphs_root` — `ValueError("pass only one of host= or graphs_root=")`.
   - если `host is None`: `host = RunHostContext(graphs_root=graphs_root)`.
   - `self._host = host` (уже с resolve в `__post_init__`).
3. Удалить `self._graphs_root`; везде `self._host.graphs_root`.
4. `_prepare_context(ctx)` — без `host`; устаревшие ключи **`graphs_root`** / **`artifacts_base`** в переданном **`ctx`** удаляются (**`pop`**), затем defaults: `nesting_depth`, `node_outputs`, `max_nesting_depth`, `last_result`.
5. В `run_from`: для корневого `run_root_ready` брать `ab = self._host.artifacts_base` вместо `ctx.get("artifacts_base")`.
6. `roots = self._host.graphs_root` — убрать ветку `ctx.get("graphs_root")`.
7. `_execute_graph_ref`: `root = self._host.graphs_root` (параметр `graphs_root` метода убрать или игнорировать).
8. `child = GraphRunner(nested, self._sink, host=self._host)`.

- [x] **Step 3: Обновить вызовы в тестах** (включая **`test_artifacts_root_run.py`**, тест **`GraphRunner`** при одновременных **`host=`** и **`graphs_root=`**)

- `test_process_task.py`: строка с `artifacts_base` в `context` → `host=RunHostContext(artifacts_base=tmp_path)`.
- `test_graph_ref_nested.py`: можно оставить `graphs_root=tmp_path` (сахар) или перейти на `host=RunHostContext(graphs_root=tmp_path)`.

- [x] **Step 4: Запустить весь пакет тестов**

Run: `cd python && pytest -q`  
Expected: **PASS**

- [ ] **Step 5: Commit** — см. **§ Git** в конце файла.

---

### Task 3: CLI собирает `RunHostContext`

**Files:**
- Modify: `python/graph_caster/__main__.py`
- Test: `python/tests/test_cli_main.py` (добавить один тест с `--artifacts-base` и проверкой события в stdout, если ещё нет)

- [x] **Step 1: Реализация `_cmd_run`**

```python
from graph_caster.host_context import RunHostContext

def _cmd_run(args: argparse.Namespace) -> int:
    ...
    graphs_root = Path(args.graphs_dir).resolve() if args.graphs_dir is not None else None
    artifacts_base = Path(args.artifacts_base).resolve() if args.artifacts_base is not None else None
    host = RunHostContext(graphs_root=graphs_root, artifacts_base=artifacts_base)
    runner = GraphRunner(doc, sink=sink, host=host)
    ctx = {"last_result": True}
    ...
```

Удалить из `ctx` присвоения `graphs_root` / `artifacts_base`.

- [x] **Step 2: Тест CLI с `--artifacts-base`**

```python
def test_main_run_with_artifacts_base_emits_run_root_ready(capsys, tmp_path: Path) -> None:
    gid = "77777777-7777-4777-8777-777777777777"
    p = tmp_path / "g.json"
    p.write_text(json.dumps(_minimal_valid_doc(gid)), encoding="utf-8")
    base = tmp_path / "ws"
    base.mkdir()
    assert main(["run", "-d", str(p), "--artifacts-base", str(base)]) == 0
    assert "run_root_ready" in capsys.readouterr().out
```

Run: `pytest tests/test_cli_main.py::test_main_run_with_artifacts_base_emits_run_root_ready -v`  
Expected: **PASS**

- [ ] **Step 3: Commit** — см. **§ Git** в конце файла.

---

## Verification

```bash
cd third_party/graph-caster/python
pip install -e ".[dev]"
pytest -q
```

Expected: все тесты зелёные; `npm test` / UI не трогались. Дополнительно зафиксировано: **`python/README.md`** — раздел про **`RunHostContext`**.

---

## Git — закрыть оставшиеся пункты Commit (Task 1–3)

Выполнить из корня репозитория **graph-caster**. Только пути фичи **`RunHostContext`** (остальные изменённые файлы в ветке не трогаем):

```bash
git add python/graph_caster/host_context.py \
  python/graph_caster/__init__.py \
  python/graph_caster/__main__.py \
  python/graph_caster/runner.py \
  python/tests/test_host_context.py \
  python/tests/test_process_task.py \
  python/tests/test_graph_ref_nested.py \
  python/tests/test_artifacts_root_run.py \
  python/tests/test_cli_main.py \
  python/README.md \
  doc/plans/2026-03-27-run-host-context.md
```

**PowerShell (одной строкой):**

```powershell
git add python/graph_caster/host_context.py python/graph_caster/__init__.py python/graph_caster/__main__.py python/graph_caster/runner.py python/tests/test_host_context.py python/tests/test_process_task.py python/tests/test_graph_ref_nested.py python/tests/test_artifacts_root_run.py python/tests/test_cli_main.py python/README.md doc/plans/2026-03-27-run-host-context.md
```

```bash
git commit -m "[REPO] graph-caster RunHostContext; runner and CLI host separation"
```

После коммита отметьте в этом документе три чекбокса **Step 3/5/3: Commit** как выполненные (`[x]`).

---

## Optional review

После реализации имеет смысл прогнать @superpowers:plan-document-reviewer на этом файле и плане; либо короткое человеческое ревью границы `RunHostContext` перед следующим эпиком (фаза 8).

---

## Execution handoff

**План сохранён:** `doc/plans/2026-03-27-run-host-context.md`.

**Статус:** код, тесты (**69 passed**), **`python/README.md`** — готово. Не закрыто только **git commit**: см. **§ Git** выше *(агент не выполняет `git commit` без явного запроса «commit» / «закоммить» по политике репозитория)*. Опциональный **plan-document-reviewer** — по желанию.
