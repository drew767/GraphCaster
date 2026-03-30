# GraphCaster — canvas performance utilities

Helpers for large graphs (facts: **`doc/IMPLEMENTED_FEATURES.md`** — раздел «Large graph performance» / F1). The main editor uses React Flow with `onlyRenderVisibleElements`, LOD, and viewport tiers (`GraphCanvas`, `canvasLod.ts`, `viewportNodeTier.ts`).

## Hooks and modules

| Path | Role |
|------|------|
| `hooks/useViewportCulling.ts` | Bounding-box cull of nodes against a viewport (tests / tooling). |
| `hooks/useLODLevel.ts` | Zoom bucket to LOD level (see also app-wide `canvasLod.ts`). |
| `hooks/useAsyncLayout.ts` | Layered layout; **browser** uses `workers/layoutWorker.ts`, **Vitest** uses sync `graph/layeredLayout.ts`. Disable worker: `VITE_GC_LAYOUT_WORKER=0`. |
| `LODNodeRenderer.tsx` | Reference / test LOD rendering. |
| `MemoizedNode.tsx` | `memo` + shallow `data` compare for custom node types. |
| `../../utils/performanceMonitor.ts` | FPS / render counters for debugging. |

## Tests

`ui/src/tests/performance/` — Vitest for culling, LOD, memo, async layout, monitor.
