# Graph Caster — file-size refactor (**pending only**)

**Goal:** Shrink monolithic files by extracting hooks/helpers without changing behavior.

**What is already extracted** is in the repo and in [`doc/ARCHITECTURE_OUTLINE.md`](../ARCHITECTURE_OUTLINE.md) (not replayed here).

**Agents:** `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`.

**Verify:** `cd ui && npm run build`; `cd ui && npm test -- --run`; `cd python && python -m pytest tests/ -v --tb=short`.

**Navigation:** [`2026-03-29-modular-architecture-scaffold.md`](./2026-03-29-modular-architecture-scaffold.md).

---

## Metrics (approximate)

| File | ~lines | Notes |
|------|--------|-------|
| `ui/src/layout/AppShell.tsx` | ~1215 | Still composition-heavy |
| `ui/src/components/InspectorPanel.tsx` | ~1640 | Dispatcher + JSX |
| `ui/src/components/GraphCanvas.tsx` | ~1090 | Connections + node/edge remove guards in `canvas/hooks/useGraphCanvas*.ts`; more splits (sync effect, selection, LOD) still useful |
| `ui/src/run/runSessionStore.ts` | ~702 | Optional actions/selectors split later |
| `python/graph_caster/runner.py` | ~1791 | Task 5 |
| `python/graph_caster/process_exec.py` | ~1094 | Future split |
| `python/graph_caster/run_broker/app.py` | ~374 | Task 8 |

---

## Task 5: Python `runner.py` executors — **PENDING**

- [ ] Introduce `python/graph_caster/runner/` package (executors + shared step-cache/stub helpers as needed).
- [ ] Carve node-kind visit logic out of `runner.py` incrementally; keep `pytest` green.
- [ ] Avoid duplicating step-cache logic — shared helper module or mixin as appropriate.

---

## Task 6: GraphCanvas — **PARTIAL**

- [ ] Next target: largest remaining block (e.g. document/run overlay sync `useEffect`, `onSelectionChange`, viewport/LOD cluster).
- [ ] Extract to `components/canvas/hooks/*.ts` or `graph/*.ts`; keep import paths stable.
- [ ] `npm run build` + `npm test -- --run`.

---

## Task 8: `run_broker` routes — **PENDING**

- [ ] Add `python/graph_caster/run_broker/routes/` (`http`, `ws`, `sse` or equivalent split).
- [ ] Keep `create_app` factory; register routers; run full `pytest`.

---

North star: thin `AppShell.tsx`, `GraphCanvas` + hooks, dispatch-only `InspectorPanel`; Python `runner/` + slim `app.py`. Large files today are **expected** until the checklists above are done.
