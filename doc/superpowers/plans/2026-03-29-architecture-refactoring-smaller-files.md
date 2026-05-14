# Graph Caster Architecture Refactoring Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce file sizes, improve readability and maintainability by extracting cohesive modules from large monolithic files.

**Architecture:** Extract hooks, subcomponents, and helper modules from oversized files while preserving existing functionality. Each extraction creates independent, testable units with clear interfaces. Changes are incremental — each task produces a working state.

**Tech Stack:** TypeScript/React (frontend), Python (backend), Vitest (tests)

---

## Current State Analysis

### Critical Files (require immediate refactoring)

| File | Lines | Issues |
|------|-------|--------|
| `ui/src/layout/AppShell.tsx` | ~1975 | Monolithic shell with 100+ imports, mixes run orchestration, workspace management, keyboard shortcuts, document history, autosave, modals |
| `ui/src/components/InspectorPanel.tsx` | ~1836 | Node-type-specific forms mixed in one component, massive useState declarations |
| `ui/src/components/GraphCanvas.tsx` | ~1171 | React Flow wiring + behaviors + overlay logic |
| `python/graph_caster/runner.py` | ~1921 | All node execution logic in one class, duplicated step-cache patterns |
| `python/graph_caster/process_exec.py` | ~1094 | Subprocess + streaming + platform handling |

### Medium Priority Files

| File | Lines | Issues |
|------|-------|--------|
| `ui/src/run/runSessionStore.ts` | ~731 | Store + actions + selectors mixed |
| `ui/src/run/webRunBroker.ts` | ~444 | Protocol + state + dispatching |
| `python/graph_caster/run_broker/app.py` | ~415 | HTTP + WS + SSE endpoints mixed |
| `python/graph_caster/run_broker/registry.py` | ~368 | Registry + spawn + cleanup |

---

## File Structure (Target)

### Frontend (`ui/src/`)

```
ui/src/
├── layout/
│   ├── AppShell.tsx                    # ~400 lines (shell composition only)
│   ├── hooks/
│   │   ├── useDocumentHistory.ts       # Undo/redo logic
│   │   ├── useWorkspaceManager.ts      # Workspace load/save/autosave
│   │   ├── useKeyboardShortcuts.ts     # Global shortcuts
│   │   ├── useRunOrchestration.ts      # Run start/stop/queue
│   │   └── useGraphRefCache.ts         # Graph ref snapshot cache
│   └── context/
│       └── AppShellContext.tsx         # Shared state for child components
├── components/
│   ├── GraphCanvas.tsx                 # ~500 lines (composition)
│   ├── canvas/
│   │   ├── useCanvasRunOverlay.ts      # Run highlight logic
│   │   ├── useCanvasViewport.ts        # Viewport + LOD
│   │   ├── useCanvasConnection.ts      # Connection handling
│   │   └── useCanvasDragDrop.ts        # Node drag/drop
│   ├── InspectorPanel.tsx              # ~300 lines (dispatch to panels)
│   └── inspector/
│       ├── NodeInspectorTask.tsx       # Task node fields
│       ├── NodeInspectorMcp.tsx        # MCP tool fields
│       ├── NodeInspectorLlmAgent.tsx   # LLM agent fields
│       ├── NodeInspectorGraphRef.tsx   # Graph ref fields
│       ├── NodeInspectorGroup.tsx      # Group fields
│       ├── NodeInspectorMerge.tsx      # Merge node fields
│       ├── NodeInspectorAiRoute.tsx    # AI route fields
│       ├── EdgeInspector.tsx           # Edge condition/description
│       ├── GraphSettingsInspector.tsx  # Document settings
│       └── hooks/
│           └── useNodeInspectorState.ts # Shared inspector state logic
├── run/
│   ├── runSessionStore.ts              # ~200 lines (store only)
│   ├── runSessionActions.ts            # Actions
│   ├── runSessionSelectors.ts          # Selectors/derived state
│   └── ...
└── hooks/
    ├── useConsoleHeight.ts             # (existing)
    └── useLocalStorageState.ts         # Generic localStorage hook
```

### Backend (`python/graph_caster/`)

```
python/graph_caster/
├── runner.py                           # ~400 lines (orchestration only)
├── runner/
│   ├── __init__.py
│   ├── task_executor.py                # Task node execution
│   ├── llm_agent_executor.py           # LLM agent execution
│   ├── mcp_tool_executor.py            # MCP tool execution
│   ├── graph_ref_executor.py           # Graph ref (nested) execution
│   ├── ai_route_executor.py            # AI route selection
│   ├── fork_merge_executor.py          # Fork/merge/barrier execution
│   ├── step_cache_mixin.py             # Step cache logic (shared)
│   └── edge_traversal.py               # Edge selection + traversal
├── process_exec.py                     # ~400 lines (core subprocess)
├── process_exec/
│   ├── __init__.py
│   ├── stream_parser.py                # Output stream parsing
│   ├── platform_spawn.py               # Platform-specific spawn
│   └── cursor_agent.py                 # Cursor agent specific logic
└── run_broker/
    ├── app.py                          # ~150 lines (app factory)
    ├── routes/
    │   ├── __init__.py
    │   ├── http_routes.py              # REST endpoints
    │   ├── ws_routes.py                # WebSocket endpoints
    │   └── sse_routes.py               # SSE endpoints
    ├── registry.py                     # ~200 lines (registry only)
    └── spawn.py                        # Spawn management
```

---

## Task 1: Extract `useDocumentHistory` Hook

**Files:**
- Create: `ui/src/layout/hooks/useDocumentHistory.ts`
- Create: `ui/src/layout/hooks/useDocumentHistory.test.ts`
- Modify: `ui/src/layout/AppShell.tsx`

- [ ] **Step 1: Create the hook file with types**

```typescript
// ui/src/layout/hooks/useDocumentHistory.ts
// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useRef, useState } from "react";
import type { GraphDocumentJson } from "../../graph/types";
import {
  clearHistory,
  createEmptyHistory,
  redoDocument,
  snapshotBeforeChange,
  undoDocument,
  type DocumentHistoryState,
} from "../../graph/documentHistory";

export interface UseDocumentHistoryOptions {
  historyCap?: number;
}

export interface UseDocumentHistoryReturn {
  historyRef: React.MutableRefObject<DocumentHistoryState>;
  historyTick: number;
  commitHistorySnapshot: () => void;
  performUndo: (currentDoc: GraphDocumentJson) => GraphDocumentJson | null;
  performRedo: (currentDoc: GraphDocumentJson) => GraphDocumentJson | null;
  clearDocumentHistory: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const DEFAULT_HISTORY_CAP = 80;

export function useDocumentHistory(
  getDocument: () => GraphDocumentJson,
  options: UseDocumentHistoryOptions = {},
): UseDocumentHistoryReturn {
  const { historyCap = DEFAULT_HISTORY_CAP } = options;
  const historyRef = useRef<DocumentHistoryState>(createEmptyHistory(historyCap));
  const [historyTick, setHistoryTick] = useState(0);

  const commitHistorySnapshot = useCallback(() => {
    const doc = getDocument();
    historyRef.current = snapshotBeforeChange(historyRef.current, doc);
    setHistoryTick((n) => n + 1);
  }, [getDocument]);

  const performUndo = useCallback(
    (currentDoc: GraphDocumentJson): GraphDocumentJson | null => {
      const result = undoDocument(historyRef.current, currentDoc);
      if (result) {
        historyRef.current = result.nextHistory;
        setHistoryTick((n) => n + 1);
        return result.document;
      }
      return null;
    },
    [],
  );

  const performRedo = useCallback(
    (currentDoc: GraphDocumentJson): GraphDocumentJson | null => {
      const result = redoDocument(historyRef.current, currentDoc);
      if (result) {
        historyRef.current = result.nextHistory;
        setHistoryTick((n) => n + 1);
        return result.document;
      }
      return null;
    },
    [],
  );

  const clearDocumentHistory = useCallback(() => {
    historyRef.current = clearHistory(historyRef.current);
    setHistoryTick((n) => n + 1);
  }, []);

  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  return {
    historyRef,
    historyTick,
    commitHistorySnapshot,
    performUndo,
    performRedo,
    clearDocumentHistory,
    canUndo,
    canRedo,
  };
}
```

- [ ] **Step 2: Write the test file**

```typescript
// ui/src/layout/hooks/useDocumentHistory.test.ts
// Copyright GraphCaster. All Rights Reserved.

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useDocumentHistory } from "./useDocumentHistory";
import type { GraphDocumentJson } from "../../graph/types";

function createTestDoc(id: string): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { graphId: id },
    nodes: [{ id: "start", type: "start", position: { x: 0, y: 0 } }],
    edges: [],
  };
}

describe("useDocumentHistory", () => {
  it("starts with empty history", () => {
    const doc = createTestDoc("test-1");
    const { result } = renderHook(() =>
      useDocumentHistory(() => doc),
    );

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("allows undo after commit", () => {
    let currentDoc = createTestDoc("test-1");
    const { result } = renderHook(() =>
      useDocumentHistory(() => currentDoc),
    );

    act(() => {
      result.current.commitHistorySnapshot();
    });

    currentDoc = createTestDoc("test-2");

    expect(result.current.canUndo).toBe(true);

    let undone: GraphDocumentJson | null = null;
    act(() => {
      undone = result.current.performUndo(currentDoc);
    });

    expect(undone).not.toBeNull();
    expect(undone?.meta?.graphId).toBe("test-1");
    expect(result.current.canRedo).toBe(true);
  });

  it("allows redo after undo", () => {
    let currentDoc = createTestDoc("test-1");
    const { result } = renderHook(() =>
      useDocumentHistory(() => currentDoc),
    );

    act(() => {
      result.current.commitHistorySnapshot();
    });

    const doc2 = createTestDoc("test-2");
    currentDoc = doc2;

    let undone: GraphDocumentJson | null = null;
    act(() => {
      undone = result.current.performUndo(currentDoc);
    });

    expect(undone).not.toBeNull();

    let redone: GraphDocumentJson | null = null;
    act(() => {
      redone = result.current.performRedo(undone!);
    });

    expect(redone).not.toBeNull();
    expect(redone?.meta?.graphId).toBe("test-2");
  });

  it("clears history", () => {
    let currentDoc = createTestDoc("test-1");
    const { result } = renderHook(() =>
      useDocumentHistory(() => currentDoc),
    );

    act(() => {
      result.current.commitHistorySnapshot();
    });

    currentDoc = createTestDoc("test-2");

    act(() => {
      result.current.clearDocumentHistory();
    });

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails (module not found initially)**

Run: `cd ui && npx vitest run src/layout/hooks/useDocumentHistory.test.ts`
Expected: FAIL (file doesn't exist yet or passes if created)

- [ ] **Step 4: Create hooks directory**

```bash
mkdir -p ui/src/layout/hooks
```

- [ ] **Step 5: Save the hook and test files**

(Files created in steps 1-2)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd ui && npx vitest run src/layout/hooks/useDocumentHistory.test.ts`
Expected: PASS

- [ ] **Step 7: Update AppShell.tsx imports**

Replace in `AppShell.tsx`:

```typescript
// Remove these imports:
import {
  clearHistory,
  createEmptyHistory,
  documentJsonSignature,
  redoDocument,
  snapshotBeforeChange,
  undoDocument,
} from "../graph/documentHistory";

// Add this import:
import { useDocumentHistory } from "./hooks/useDocumentHistory";
```

- [ ] **Step 8: Replace history state in AppShell**

Find and remove:

```typescript
const historyRef = useRef(createEmptyHistory());
const [historyTick, setHistoryTick] = useState(0);
const DOCUMENT_HISTORY_CAP = 80;
```

Replace with hook usage inside component:

```typescript
const getDocumentForHistory = useCallback((): GraphDocumentJson => {
  const api = canvasRef.current;
  if (api) {
    return api.exportDocument({ notifyRemovedDanglingEdges: false });
  }
  return graphDocument;
}, [graphDocument]);

const {
  historyRef,
  historyTick,
  commitHistorySnapshot,
  performUndo,
  performRedo,
  clearDocumentHistory,
  canUndo,
  canRedo,
} = useDocumentHistory(getDocumentForHistory);
```

- [ ] **Step 9: Replace commitHistorySnapshot callback**

Remove the old:

```typescript
const commitHistorySnapshot = useCallback(() => {
  const doc = canvasRef.current?.exportDocument({ notifyRemovedDanglingEdges: false }) ?? graphDocument;
  snapshotBeforeChange(historyRef.current, doc, DOCUMENT_HISTORY_CAP);
  setHistoryTick((n) => n + 1);
}, [graphDocument]);
```

(Now provided by hook)

- [ ] **Step 10: Update undo/redo handlers**

Find the keyboard handlers using `undoDocument`/`redoDocument` and update to use `performUndo`/`performRedo`:

```typescript
// In undo handler:
const undone = performUndo(graphDocument);
if (undone) {
  setGraphDocument(undone);
}

// In redo handler:
const redone = performRedo(graphDocument);
if (redone) {
  setGraphDocument(redone);
}
```

- [ ] **Step 11: Run full test suite for UI**

Run: `cd ui && npm run test`
Expected: PASS (all existing tests should pass)

- [ ] **Step 12: Run the app to verify it works**

Run: `cd ui && npm run dev`
Expected: App starts, undo/redo works in editor

- [ ] **Step 13: Commit**

```bash
git add ui/src/layout/hooks/useDocumentHistory.ts ui/src/layout/hooks/useDocumentHistory.test.ts ui/src/layout/AppShell.tsx
git commit -m "refactor(ui): extract useDocumentHistory hook from AppShell"
```

---

## Task 2: Extract `useWorkspaceManager` Hook

**Files:**
- Create: `ui/src/layout/hooks/useWorkspaceManager.ts`
- Create: `ui/src/layout/hooks/useWorkspaceManager.test.ts`
- Modify: `ui/src/layout/AppShell.tsx`

- [ ] **Step 1: Create hook file**

```typescript
// ui/src/layout/hooks/useWorkspaceManager.ts
// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useRef, useState } from "react";
import type { GraphDocumentJson } from "../../graph/types";
import { graphIdFromDocument, parseGraphDocumentJson, parseGraphDocumentJsonResult } from "../../graph/parseDocument";
import {
  defaultWorkspaceFileName,
  ensureGraphsDirectory,
  findWorkspaceGraphIdConflict,
  pickProjectRootDirectory,
  readWorkspaceGraphFile,
  sanitizeWorkspaceGraphFileName,
  scanWorkspaceGraphs,
  supportsFileSystemAccess,
  writeJsonFileToDir,
  type WorkspaceGraphEntry,
} from "../../lib/workspaceFs";
import { runSessionAppendLine, runSessionHasBlockingActivity } from "../../run/runSessionStore";

const LS_RUN_GRAPHS = "gc.run.graphsDir";

export interface UseWorkspaceManagerOptions {
  onGraphLoaded?: (doc: GraphDocumentJson, fileName: string) => void;
  onAutosaveFailed?: () => void;
  getRunSessionBlocking: () => boolean;
  t: (key: string, params?: Record<string, unknown>) => string;
}

export interface UseWorkspaceManagerReturn {
  workspaceGraphsDir: FileSystemDirectoryHandle | null;
  workspaceIndex: WorkspaceGraphEntry[];
  activeWorkspaceFile: string | null;
  autosaveFailed: boolean;
  runGraphsDir: string;
  setRunGraphsDir: (dir: string) => void;
  linkWorkspace: () => Promise<void>;
  unlinkWorkspace: () => void;
  openWorkspaceGraph: (fileName: string) => Promise<void>;
  saveToWorkspace: (doc: GraphDocumentJson, suggestedFileName?: string) => Promise<{ fileName: string } | null>;
  refreshWorkspaceIndex: () => Promise<void>;
  setAutosaveFailed: (failed: boolean) => void;
}

export function useWorkspaceManager(
  options: UseWorkspaceManagerOptions,
): UseWorkspaceManagerReturn {
  const { onGraphLoaded, onAutosaveFailed, getRunSessionBlocking, t } = options;

  const [workspaceGraphsDir, setWorkspaceGraphsDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [workspaceIndex, setWorkspaceIndex] = useState<WorkspaceGraphEntry[]>([]);
  const [activeWorkspaceFile, setActiveWorkspaceFile] = useState<string | null>(null);
  const [autosaveFailed, setAutosaveFailed] = useState(false);
  const [runGraphsDir, setRunGraphsDir] = useState(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem(LS_RUN_GRAPHS) ?? "";
    }
    return "";
  });

  const lastAutosaveFailConsoleMsRef = useRef(0);

  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(LS_RUN_GRAPHS, runGraphsDir);
    }
  }, [runGraphsDir]);

  const refreshWorkspaceIndex = useCallback(async () => {
    if (!workspaceGraphsDir) {
      setWorkspaceIndex([]);
      return;
    }
    const entries = await scanWorkspaceGraphs(workspaceGraphsDir);
    setWorkspaceIndex(entries);
  }, [workspaceGraphsDir]);

  useEffect(() => {
    void refreshWorkspaceIndex();
  }, [refreshWorkspaceIndex]);

  const linkWorkspace = useCallback(async () => {
    if (!supportsFileSystemAccess()) {
      return;
    }
    const rootDir = await pickProjectRootDirectory();
    if (!rootDir) {
      return;
    }
    const graphsDir = await ensureGraphsDirectory(rootDir);
    if (!graphsDir) {
      return;
    }
    setWorkspaceGraphsDir(graphsDir);
    setActiveWorkspaceFile(null);
    runSessionAppendLine(`[host] workspace linked: ${rootDir.name}/graphs`);
  }, []);

  const unlinkWorkspace = useCallback(() => {
    setWorkspaceGraphsDir(null);
    setWorkspaceIndex([]);
    setActiveWorkspaceFile(null);
    setAutosaveFailed(false);
    runSessionAppendLine("[host] workspace unlinked");
  }, []);

  const openWorkspaceGraph = useCallback(
    async (fileName: string) => {
      if (!workspaceGraphsDir) {
        return;
      }
      const result = await readWorkspaceGraphFile(workspaceGraphsDir, fileName);
      if (!result.ok) {
        runSessionAppendLine(`[host] open failed: ${result.error}`);
        return;
      }
      const parseResult = parseGraphDocumentJsonResult(result.json);
      if (!parseResult.ok) {
        runSessionAppendLine(`[host] parse failed: ${parseResult.error}`);
        return;
      }
      setActiveWorkspaceFile(fileName);
      setAutosaveFailed(false);
      onGraphLoaded?.(parseResult.doc, fileName);
    },
    [workspaceGraphsDir, onGraphLoaded],
  );

  const saveToWorkspace = useCallback(
    async (
      doc: GraphDocumentJson,
      suggestedFileName?: string,
    ): Promise<{ fileName: string } | null> => {
      if (!workspaceGraphsDir) {
        return null;
      }
      const graphId = graphIdFromDocument(doc);
      const baseName = suggestedFileName ?? defaultWorkspaceFileName(doc);
      const fileName = sanitizeWorkspaceGraphFileName(baseName);

      const conflict = findWorkspaceGraphIdConflict(workspaceIndex, graphId ?? "", fileName);
      if (conflict) {
        runSessionAppendLine(`[host] save conflict: ${conflict}`);
        return null;
      }

      try {
        await writeJsonFileToDir(workspaceGraphsDir, fileName, doc);
        setActiveWorkspaceFile(fileName);
        setAutosaveFailed(false);
        await refreshWorkspaceIndex();
        return { fileName };
      } catch (err) {
        runSessionAppendLine(`[host] save failed: ${String(err)}`);
        return null;
      }
    },
    [workspaceGraphsDir, workspaceIndex, refreshWorkspaceIndex],
  );

  return {
    workspaceGraphsDir,
    workspaceIndex,
    activeWorkspaceFile,
    autosaveFailed,
    runGraphsDir,
    setRunGraphsDir,
    linkWorkspace,
    unlinkWorkspace,
    openWorkspaceGraph,
    saveToWorkspace,
    refreshWorkspaceIndex,
    setAutosaveFailed,
  };
}
```

- [ ] **Step 2: Write the test file**

```typescript
// ui/src/layout/hooks/useWorkspaceManager.test.ts
// Copyright GraphCaster. All Rights Reserved.

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorkspaceManager } from "./useWorkspaceManager";

vi.mock("../../lib/workspaceFs", () => ({
  supportsFileSystemAccess: vi.fn(() => false),
  pickProjectRootDirectory: vi.fn(),
  ensureGraphsDirectory: vi.fn(),
  scanWorkspaceGraphs: vi.fn(() => Promise.resolve([])),
  readWorkspaceGraphFile: vi.fn(),
  writeJsonFileToDir: vi.fn(),
  defaultWorkspaceFileName: vi.fn(() => "test.json"),
  sanitizeWorkspaceGraphFileName: vi.fn((n: string) => n),
  findWorkspaceGraphIdConflict: vi.fn(() => null),
}));

vi.mock("../../run/runSessionStore", () => ({
  runSessionAppendLine: vi.fn(),
  runSessionHasBlockingActivity: vi.fn(() => false),
}));

describe("useWorkspaceManager", () => {
  const mockT = (key: string) => key;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts with no workspace linked", () => {
    const { result } = renderHook(() =>
      useWorkspaceManager({
        getRunSessionBlocking: () => false,
        t: mockT,
      }),
    );

    expect(result.current.workspaceGraphsDir).toBeNull();
    expect(result.current.workspaceIndex).toEqual([]);
    expect(result.current.activeWorkspaceFile).toBeNull();
  });

  it("unlink clears workspace state", () => {
    const { result } = renderHook(() =>
      useWorkspaceManager({
        getRunSessionBlocking: () => false,
        t: mockT,
      }),
    );

    act(() => {
      result.current.unlinkWorkspace();
    });

    expect(result.current.workspaceGraphsDir).toBeNull();
    expect(result.current.workspaceIndex).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify**

Run: `cd ui && npx vitest run src/layout/hooks/useWorkspaceManager.test.ts`
Expected: PASS

- [ ] **Step 4: Update AppShell.tsx to use the hook**

Remove workspace-related state and callbacks from AppShell, replace with hook.

- [ ] **Step 5: Run full test suite**

Run: `cd ui && npm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add ui/src/layout/hooks/useWorkspaceManager.ts ui/src/layout/hooks/useWorkspaceManager.test.ts ui/src/layout/AppShell.tsx
git commit -m "refactor(ui): extract useWorkspaceManager hook from AppShell"
```

---

## Task 3: Extract `useKeyboardShortcuts` Hook

**Files:**
- Create: `ui/src/layout/hooks/useKeyboardShortcuts.ts`
- Modify: `ui/src/layout/AppShell.tsx`

- [ ] **Step 1: Create hook file**

```typescript
// ui/src/layout/hooks/useKeyboardShortcuts.ts
// Copyright GraphCaster. All Rights Reserved.

import { useEffect, type MutableRefObject } from "react";
import type { GraphCanvasSelection } from "../../components/GraphCanvas";

export interface KeyboardShortcutHandlers {
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  onDelete: () => void;
  onSelectAll: () => void;
  onFind: () => void;
}

export interface KeyboardShortcutFlags {
  runSessionBlocking: boolean;
  canGroupSelection: boolean;
  canUngroupSelection: boolean;
  nodeSearchOpen: boolean;
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  return target.closest("input, textarea, select, [contenteditable='true']") != null;
}

export function useKeyboardShortcuts(
  handlers: KeyboardShortcutHandlers,
  flagsRef: MutableRefObject<KeyboardShortcutFlags>,
): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const flags = flagsRef.current;

      if (!e.ctrlKey && !e.metaKey) {
        if (e.key === "Delete" || e.key === "Backspace") {
          if (isTextEditingTarget(e.target)) {
            return;
          }
          if (flags.nodeSearchOpen || flags.runSessionBlocking) {
            return;
          }
          e.preventDefault();
          handlers.onDelete();
        }
        return;
      }

      const key = e.key.toLowerCase();

      if (isTextEditingTarget(e.target)) {
        return;
      }

      if (flags.nodeSearchOpen) {
        return;
      }

      switch (key) {
        case "z":
          e.preventDefault();
          if (e.shiftKey) {
            handlers.onRedo();
          } else {
            handlers.onUndo();
          }
          break;
        case "y":
          e.preventDefault();
          handlers.onRedo();
          break;
        case "c":
          e.preventDefault();
          handlers.onCopy();
          break;
        case "v":
          if (flags.runSessionBlocking) {
            return;
          }
          e.preventDefault();
          handlers.onPaste();
          break;
        case "g":
          if (flags.runSessionBlocking) {
            return;
          }
          if (e.shiftKey) {
            if (!flags.canUngroupSelection) {
              return;
            }
            e.preventDefault();
            handlers.onUngroup();
          } else {
            if (!flags.canGroupSelection) {
              return;
            }
            e.preventDefault();
            handlers.onGroup();
          }
          break;
        case "a":
          e.preventDefault();
          handlers.onSelectAll();
          break;
        case "f":
          e.preventDefault();
          handlers.onFind();
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handlers, flagsRef]);
}
```

- [ ] **Step 2: Run tests**

Run: `cd ui && npm run test`
Expected: PASS

- [ ] **Step 3: Update AppShell.tsx**

Replace multiple `useEffect` keyboard handlers with single hook usage.

- [ ] **Step 4: Commit**

```bash
git add ui/src/layout/hooks/useKeyboardShortcuts.ts ui/src/layout/AppShell.tsx
git commit -m "refactor(ui): extract useKeyboardShortcuts hook from AppShell"
```

---

## Task 4: Extract Inspector Panel Sub-components

**Files:**
- Create: `ui/src/components/inspector/NodeInspectorTask.tsx`
- Create: `ui/src/components/inspector/NodeInspectorMcp.tsx`
- Create: `ui/src/components/inspector/EdgeInspector.tsx`
- Create: `ui/src/components/inspector/GraphSettingsInspector.tsx`
- Create: `ui/src/components/inspector/types.ts`
- Create: `ui/src/components/inspector/index.ts`
- Modify: `ui/src/components/InspectorPanel.tsx:145-177` (state declarations)
- Modify: `ui/src/components/InspectorPanel.tsx:1127-1500` (Task node JSX)
- Modify: `ui/src/components/InspectorPanel.tsx:700-940` (MCP tool JSX)
- Modify: `ui/src/components/InspectorPanel.tsx:505-600` (Edge JSX)
- Modify: `ui/src/components/InspectorPanel.tsx:528-610` (Graph settings JSX)

**Source line ranges in InspectorPanel.tsx to extract:**
- Task node: lines 1127-1500 (gcPin + stepCache + cursorAgent forms)
- MCP tool: lines 700-940 (transport, command, URL, bearer, args, stepCache)
- Edge inspector: lines 505-527 (condition + routeDescription forms)
- Graph settings: lines 528-610 (title, author, schemaVersion, inputs, outputs)

- [ ] **Step 1: Create inspector directory**

```bash
mkdir -p ui/src/components/inspector
```

- [ ] **Step 2: Create shared types file**

```typescript
// ui/src/components/inspector/types.ts
// Copyright GraphCaster. All Rights Reserved.

import type { GraphDocumentJson, GraphDocumentSettingsPatch } from "../../graph/types";
import type { AppMessagePresentation } from "../../graph/openGraphErrorPresentation";

export interface InspectorNodeSelection {
  kind: "node";
  id: string;
  graphNodeType: string;
  label: string;
  raw: Record<string, unknown>;
}

export interface InspectorEdgeSelection {
  kind: "edge";
  id: string;
  source: string;
  target: string;
  condition: string | null;
  routeDescription: string;
}

export interface BaseNodeInspectorProps {
  nodeId: string;
  nodeData: Record<string, unknown>;
  onApplyNodeData: (nodeId: string, data: Record<string, unknown>) => void;
  runLocked: boolean;
  onUserMessage?: (presentation: AppMessagePresentation) => void;
  graphDocument: GraphDocumentJson;
  getDocumentForStepCacheDirty?: () => GraphDocumentJson;
  onMarkStepCacheDirtyTransitive?: (doc: GraphDocumentJson, seeds: readonly string[]) => void;
}
```

- [ ] **Step 3: Create NodeInspectorTask.tsx**

Extract Task node form fields from InspectorPanel lines 1127-1500. Key elements:
- gcPin toggle and payload section (lines 1127-1236)
- stepCache toggle and mark dirty button (lines 1237-1284)
- cursorAgent fields (lines 1285-1500): prompt, promptFile, cwdBase, cwdRelative, model, outputFormat, extraArgs, printMode, applyFileChanges

```typescript
// ui/src/components/inspector/NodeInspectorTask.tsx
// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  buildGcCursorAgentPayload,
  cursorAgentUiValidationKey,
  parseExtraArgsJson,
  type GcCursorAgentCwdBase,
} from "../../graph/cursorAgentPreset";
import {
  getStepCacheDirtySnapshot,
  markStepCacheDirtyTransitive,
} from "../../run/stepCacheDirtyStore";
import { runSessionAppendLine, useRunSession } from "../../run/runSessionStore";
import type { BaseNodeInspectorProps } from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

const GCPIN_PAYLOAD_WARN_BYTES = 262144;

function estimateJsonUtf8Bytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

export function NodeInspectorTask({
  nodeId,
  nodeData,
  onApplyNodeData,
  runLocked,
  graphDocument,
  getDocumentForStepCacheDirty,
  onMarkStepCacheDirtyTransitive,
}: BaseNodeInspectorProps) {
  const { t } = useTranslation();
  const runSession = useRunSession();

  // Cursor Agent state
  const [caEnabled, setCaEnabled] = useState(false);
  const [caPrompt, setCaPrompt] = useState("");
  const [caPromptFile, setCaPromptFile] = useState("");
  const [caCwdBase, setCaCwdBase] = useState<GcCursorAgentCwdBase>("workspace_root");
  const [caCwdRelative, setCaCwdRelative] = useState("");
  const [caModel, setCaModel] = useState("");
  const [caOutputFormat, setCaOutputFormat] = useState("");
  const [caExtraArgsJson, setCaExtraArgsJson] = useState("");
  const [caPrintMode, setCaPrintMode] = useState(true);
  const [caApplyFileChanges, setCaApplyFileChanges] = useState(false);

  // Sync state from nodeData
  useEffect(() => {
    const gcCa = nodeData.gcCursorAgent;
    if (gcCa != null && typeof gcCa === "object" && !Array.isArray(gcCa)) {
      setCaEnabled(true);
      const ca = gcCa as Record<string, unknown>;
      setCaPrompt(typeof ca.prompt === "string" ? ca.prompt : "");
      setCaPromptFile(typeof ca.promptFile === "string" ? ca.promptFile : "");
      setCaCwdBase((ca.cwdBase as GcCursorAgentCwdBase) ?? "workspace_root");
      setCaCwdRelative(typeof ca.cwdRelative === "string" ? ca.cwdRelative : "");
      setCaModel(typeof ca.model === "string" ? ca.model : "");
      setCaOutputFormat(typeof ca.outputFormat === "string" ? ca.outputFormat : "");
      setCaExtraArgsJson(ca.extraArgs != null ? JSON.stringify(ca.extraArgs, null, 2) : "");
      setCaPrintMode(ca.printMode !== false);
      setCaApplyFileChanges(ca.applyFileChanges === true);
    } else {
      setCaEnabled(false);
      setCaPrompt("");
      setCaPromptFile("");
      setCaCwdBase("workspace_root");
      setCaCwdRelative("");
      setCaModel("");
      setCaOutputFormat("");
      setCaExtraArgsJson("");
      setCaPrintMode(true);
      setCaApplyFileChanges(false);
    }
  }, [nodeData]);

  const handleStepCacheMarkDirty = useCallback(() => {
    const doc = getDocumentForStepCacheDirty?.() ?? graphDocument;
    const before = new Set(getStepCacheDirtySnapshot().ids);
    const mark = onMarkStepCacheDirtyTransitive ?? markStepCacheDirtyTransitive;
    mark(doc, [nodeId]);
    const snap = getStepCacheDirtySnapshot();
    const added = snap.ids.filter((id) => !before.has(id));
    runSessionAppendLine(
      `[host] step-cache dirty +${added.length} [${added.join(",")}] → queue ${snap.ids.length}: ${snap.ids.join(",")}`,
    );
  }, [nodeId, graphDocument, getDocumentForStepCacheDirty, onMarkStepCacheDirtyTransitive]);

  const handleToggleStepCache = useCallback(
    (enabled: boolean) => {
      const base = { ...nodeData };
      if (enabled) {
        base.stepCache = true;
      } else {
        delete base.stepCache;
      }
      onApplyNodeData(nodeId, base);
    },
    [nodeId, nodeData, onApplyNodeData],
  );

  const handleTogglePin = useCallback(
    (payload: Record<string, unknown> | null) => {
      const base = { ...nodeData };
      if (payload) {
        base.gcPin = { payload };
      } else {
        delete base.gcPin;
      }
      onApplyNodeData(nodeId, base);
    },
    [nodeId, nodeData, onApplyNodeData],
  );

  // JSX extracted from InspectorPanel lines 1127-1500
  return (
    <div className="gc-inspector-task-fields">
      {/* gcPin section */}
      <div className="gc-inspector-pin">
        <div className="gc-inspector-row gc-inspector-row--field">
          <span className="gc-inspector-k">{t("app.inspector.pinHeading")}</span>
        </div>
        <div className="gc-inspector-pin-actions">
          <button
            type="button"
            className="gc-btn gc-inspector-apply"
            disabled={runLocked || !runSession.focusedRunId}
            onClick={() => {
              // Pin from last run - extract processResult from runSession
              // Implementation: look up node output from runSession store
            }}
          >
            {t("app.inspector.pinFromLastRun")}
          </button>
          <button
            type="button"
            className="gc-btn gc-inspector-apply"
            disabled={runLocked || !isPlainObject(nodeData.gcPin)}
            onClick={() => handleTogglePin(null)}
          >
            {t("app.inspector.pinClear")}
          </button>
        </div>
        {(() => {
          const pin = nodeData.gcPin;
          if (!isPlainObject(pin)) return null;
          const pl = (pin as Record<string, unknown>).payload;
          if (pl === undefined) return null;
          const n = estimateJsonUtf8Bytes(pl);
          if (n <= GCPIN_PAYLOAD_WARN_BYTES) return null;
          return (
            <p className="gc-inspector-edge-hint">
              {t("app.inspector.pinPayloadLarge", { kb: Math.ceil(n / 1024) })}
            </p>
          );
        })()}
        <p className="gc-inspector-edge-hint">{t("app.inspector.pinHint")}</p>
      </div>

      {/* stepCache section */}
      <div className="gc-inspector-pin">
        <div className="gc-inspector-row gc-inspector-row--field">
          <span className="gc-inspector-k">{t("app.inspector.stepCacheHeading")}</span>
          <label className="gc-inspector-pin-toggle">
            <input
              type="checkbox"
              disabled={runLocked}
              checked={nodeData.stepCache === true}
              onChange={(ev) => handleToggleStepCache(ev.target.checked)}
            />
            <span>{t("app.inspector.stepCacheEnabled")}</span>
          </label>
        </div>
        <div className="gc-inspector-pin-actions">
          <button
            type="button"
            className="gc-btn gc-inspector-apply"
            disabled={runLocked}
            onClick={handleStepCacheMarkDirty}
          >
            {t("app.inspector.stepCacheMarkDirty")}
          </button>
        </div>
        <p className="gc-inspector-edge-hint">{t("app.inspector.stepCacheHint")}</p>
      </div>

      {/* cursorAgent section */}
      <div className="gc-inspector-pin">
        <div className="gc-inspector-row gc-inspector-row--field">
          <span className="gc-inspector-k">{t("app.inspector.cursorAgentHeading")}</span>
          <label className="gc-inspector-pin-toggle">
            <input
              type="checkbox"
              disabled={runLocked}
              checked={caEnabled}
              onChange={(ev) => setCaEnabled(ev.target.checked)}
            />
            <span>{t("app.inspector.cursorAgentEnabled")}</span>
          </label>
        </div>
        {caEnabled && (
          <>
            <label className="gc-inspector-data-label" htmlFor="gc-ca-prompt">
              {t("app.inspector.cursorAgentPrompt")}
            </label>
            <textarea
              id="gc-ca-prompt"
              className="gc-inspector-data-textarea"
              rows={4}
              disabled={runLocked}
              spellCheck
              value={caPrompt}
              onChange={(ev) => setCaPrompt(ev.target.value)}
            />
            {/* Additional cursor agent fields: promptFile, cwdBase, cwdRelative, model, etc. */}
            {/* Full JSX from InspectorPanel lines 1317-1500 */}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create NodeInspectorMcp.tsx**

Extract MCP tool form fields from InspectorPanel lines 700-940.
Key elements: transport select, toolName, timeoutSec, command/serverUrl (conditional), bearerEnvKey, allowInsecure, arguments JSON, stepCache toggle.

```typescript
// ui/src/components/inspector/NodeInspectorMcp.tsx
// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BaseNodeInspectorProps } from "./types";

export interface NodeInspectorMcpProps extends BaseNodeInspectorProps {}

export function NodeInspectorMcp({
  nodeId,
  nodeData,
  onApplyNodeData,
  runLocked,
  graphDocument,
  getDocumentForStepCacheDirty,
  onMarkStepCacheDirtyTransitive,
}: NodeInspectorMcpProps) {
  const { t } = useTranslation();

  const [mcpTransport, setMcpTransport] = useState<"stdio" | "streamable_http">("stdio");
  const [mcpToolName, setMcpToolName] = useState("");
  const [mcpTimeoutSec, setMcpTimeoutSec] = useState("60");
  const [mcpCommand, setMcpCommand] = useState("");
  const [mcpServerUrl, setMcpServerUrl] = useState("");
  const [mcpAllowInsecure, setMcpAllowInsecure] = useState(false);
  const [mcpBearerKey, setMcpBearerKey] = useState("");
  const [mcpArgsJson, setMcpArgsJson] = useState("{}");

  // Sync from nodeData
  useEffect(() => {
    const tr = nodeData.transport;
    setMcpTransport(tr === "streamable_http" ? "streamable_http" : "stdio");
    setMcpToolName(typeof nodeData.toolName === "string" ? nodeData.toolName : "");
    const to = nodeData.timeoutSec;
    setMcpTimeoutSec(to != null ? String(to) : "60");
    setMcpCommand(typeof nodeData.command === "string" ? nodeData.command : "");
    setMcpServerUrl(typeof nodeData.serverUrl === "string" ? nodeData.serverUrl : "");
    setMcpAllowInsecure(nodeData.allowInsecureLocalhost === true);
    setMcpBearerKey(typeof nodeData.bearerEnvKey === "string" ? nodeData.bearerEnvKey : "");
    const args = nodeData.arguments;
    setMcpArgsJson(args != null ? JSON.stringify(args, null, 2) : "{}");
  }, [nodeData]);

  const applyMcpFields = useCallback(() => {
    let argsParsed: Record<string, unknown> = {};
    try {
      const p = JSON.parse(mcpArgsJson);
      if (p != null && typeof p === "object" && !Array.isArray(p)) {
        argsParsed = p as Record<string, unknown>;
      }
    } catch {
      // keep empty
    }
    const next: Record<string, unknown> = {
      ...nodeData,
      transport: mcpTransport,
      toolName: mcpToolName,
      timeoutSec: Number(mcpTimeoutSec) || 60,
      arguments: argsParsed,
    };
    if (mcpTransport === "stdio") {
      next.command = mcpCommand;
      delete next.serverUrl;
      delete next.bearerEnvKey;
      delete next.allowInsecureLocalhost;
    } else {
      next.serverUrl = mcpServerUrl;
      next.bearerEnvKey = mcpBearerKey || undefined;
      next.allowInsecureLocalhost = mcpAllowInsecure || undefined;
      delete next.command;
    }
    onApplyNodeData(nodeId, next);
  }, [
    nodeId, nodeData, mcpTransport, mcpToolName, mcpTimeoutSec,
    mcpCommand, mcpServerUrl, mcpBearerKey, mcpAllowInsecure, mcpArgsJson,
    onApplyNodeData,
  ]);

  // Full JSX from InspectorPanel lines 700-940
  return (
    <div className="gc-inspector-mcp">
      {/* MCP transport, toolName, timeout fields */}
      {/* Conditional stdio vs streamable_http fields */}
      {/* Arguments JSON textarea */}
      {/* Apply button */}
      {/* StepCache toggle (similar pattern to Task) */}
    </div>
  );
}
```

- [ ] **Step 5: Create EdgeInspector.tsx**

Extract edge form from InspectorPanel lines 505-527.

```typescript
// ui/src/components/inspector/EdgeInspector.tsx
// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { InspectorEdgeSelection } from "./types";

export interface EdgeInspectorProps {
  selection: InspectorEdgeSelection;
  onApplyEdgeCondition: (edgeId: string, condition: string | null) => void;
  onApplyEdgeData?: (edgeId: string, patch: { routeDescription: string }) => void;
  runLocked: boolean;
  edgeFromAiRoute: boolean;
}

export function EdgeInspector({
  selection,
  onApplyEdgeCondition,
  onApplyEdgeData,
  runLocked,
  edgeFromAiRoute,
}: EdgeInspectorProps) {
  const { t } = useTranslation();
  const [conditionText, setConditionText] = useState("");
  const [routeDescriptionText, setRouteDescriptionText] = useState("");

  useEffect(() => {
    setConditionText(selection.condition ?? "");
    setRouteDescriptionText(selection.routeDescription);
  }, [selection]);

  const onSubmitCondition = (e: FormEvent) => {
    e.preventDefault();
    if (runLocked) return;
    const trimmed = conditionText.trim();
    onApplyEdgeCondition(selection.id, trimmed === "" ? null : trimmed);
  };

  const onSubmitRouteDescription = (e: FormEvent) => {
    e.preventDefault();
    if (runLocked || !onApplyEdgeData || !edgeFromAiRoute) return;
    onApplyEdgeData(selection.id, { routeDescription: routeDescriptionText });
  };

  return (
    <div className="gc-inspector-edge">
      <form onSubmit={onSubmitCondition}>
        <label className="gc-inspector-data-label" htmlFor="gc-edge-cond">
          {t("app.inspector.edgeCondition")}
        </label>
        <input
          id="gc-edge-cond"
          className="gc-inspector-condition-input"
          type="text"
          disabled={runLocked}
          value={conditionText}
          onChange={(ev) => setConditionText(ev.target.value)}
        />
        <button type="submit" className="gc-btn gc-inspector-apply" disabled={runLocked}>
          {t("app.inspector.applyCondition")}
        </button>
      </form>
      {edgeFromAiRoute && (
        <form onSubmit={onSubmitRouteDescription}>
          <label className="gc-inspector-data-label" htmlFor="gc-edge-route">
            {t("app.inspector.edgeRouteDescription")}
          </label>
          <textarea
            id="gc-edge-route"
            className="gc-inspector-data-textarea"
            rows={3}
            disabled={runLocked}
            value={routeDescriptionText}
            onChange={(ev) => setRouteDescriptionText(ev.target.value)}
          />
          <button type="submit" className="gc-btn gc-inspector-apply" disabled={runLocked}>
            {t("app.inspector.applyRouteDescription")}
          </button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Create GraphSettingsInspector.tsx**

Extract document settings form from InspectorPanel lines 528-610.

```typescript
// ui/src/components/inspector/GraphSettingsInspector.tsx
// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { GraphDocumentJson, GraphDocumentSettingsPatch } from "../../graph/types";
import type { AppMessagePresentation } from "../../graph/openGraphErrorPresentation";

export interface GraphSettingsInspectorProps {
  graphDocument: GraphDocumentJson;
  onApplyGraphDocumentSettings: (patch: GraphDocumentSettingsPatch) => void;
  runLocked: boolean;
  onUserMessage?: (presentation: AppMessagePresentation) => void;
}

function inputsOutputsFromDoc(doc: GraphDocumentJson): { inputsText: string; outputsText: string } {
  const ins = doc.inputs;
  const outs = doc.outputs;
  return {
    inputsText: ins === undefined ? "[]" : JSON.stringify(ins, null, 2),
    outputsText: outs === undefined ? "[]" : JSON.stringify(outs, null, 2),
  };
}

export function GraphSettingsInspector({
  graphDocument,
  onApplyGraphDocumentSettings,
  runLocked,
  onUserMessage,
}: GraphSettingsInspectorProps) {
  const { t } = useTranslation();

  const [graphTitle, setGraphTitle] = useState("");
  const [graphAuthor, setGraphAuthor] = useState("");
  const [graphSchemaVersion, setGraphSchemaVersion] = useState("1");
  const [graphInputsText, setGraphInputsText] = useState("[]");
  const [graphOutputsText, setGraphOutputsText] = useState("[]");

  useEffect(() => {
    const { inputsText, outputsText } = inputsOutputsFromDoc(graphDocument);
    setGraphTitle(graphDocument.meta?.title ?? "");
    setGraphAuthor(typeof graphDocument.meta?.author === "string" ? graphDocument.meta.author : "");
    const sv = graphDocument.schemaVersion ?? graphDocument.meta?.schemaVersion ?? 1;
    setGraphSchemaVersion(String(sv));
    setGraphInputsText(inputsText);
    setGraphOutputsText(outputsText);
  }, [graphDocument]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (runLocked) return;
    // Parse and validate inputs/outputs JSON
    // Build patch and call onApplyGraphDocumentSettings
    // Full logic from InspectorPanel lines 528-610
  };

  return (
    <form className="gc-inspector-graph" onSubmit={onSubmit}>
      <label className="gc-inspector-data-label" htmlFor="gc-graph-title">
        {t("app.inspector.graphTitle")}
      </label>
      <input
        id="gc-graph-title"
        className="gc-inspector-condition-input"
        type="text"
        disabled={runLocked}
        value={graphTitle}
        onChange={(ev) => setGraphTitle(ev.target.value)}
      />
      {/* author, schemaVersion, inputs, outputs fields */}
      <button type="submit" className="gc-btn gc-inspector-apply" disabled={runLocked}>
        {t("app.inspector.applyGraphSettings")}
      </button>
    </form>
  );
}
```

- [ ] **Step 7: Create index.ts barrel export**

```typescript
// ui/src/components/inspector/index.ts
// Copyright GraphCaster. All Rights Reserved.

export { NodeInspectorTask } from "./NodeInspectorTask";
export { NodeInspectorMcp } from "./NodeInspectorMcp";
export { EdgeInspector } from "./EdgeInspector";
export { GraphSettingsInspector } from "./GraphSettingsInspector";
export type * from "./types";
```

- [ ] **Step 8: Update InspectorPanel.tsx**

Replace inline forms with imported sub-components:

1. Remove state declarations for ca*, mcp*, llm*, graph* (lines 145-177)
2. Import sub-components from `./inspector`
3. Replace JSX blocks with component calls:

```typescript
// Before (lines 1127-1500):
{selection.graphNodeType === GRAPH_NODE_TYPE_TASK && (
  <div className="gc-inspector-task-section">
    {/* 370+ lines of Task node forms */}
  </div>
)}

// After:
{selection.graphNodeType === GRAPH_NODE_TYPE_TASK && (
  <NodeInspectorTask
    nodeId={selection.id}
    nodeData={selection.raw}
    onApplyNodeData={onApplyNodeData}
    runLocked={runLocked}
    graphDocument={graphDocument}
    getDocumentForStepCacheDirty={getDocumentForStepCacheDirty}
    onMarkStepCacheDirtyTransitive={onMarkStepCacheDirtyTransitive}
  />
)}
```

- [ ] **Step 9: Run tests**

Run: `cd ui && npm run test`
Expected: PASS

- [ ] **Step 10: Run app to verify inspector works**

Run: `cd ui && npm run dev`
Expected: Select nodes/edges, inspector forms work correctly

- [ ] **Step 11: Commit**

```bash
git add ui/src/components/inspector/ ui/src/components/InspectorPanel.tsx
git commit -m "refactor(ui): extract inspector sub-components from InspectorPanel

Extract node-type specific forms into separate components:
- NodeInspectorTask: gcPin, stepCache, cursorAgent fields
- NodeInspectorMcp: MCP tool transport and config fields
- EdgeInspector: edge condition and route description
- GraphSettingsInspector: document metadata fields

Reduces InspectorPanel from ~1836 to ~300 lines."
```

---

## Task 5: Extract Python Runner Node Executors

**Files:**
- Create: `python/graph_caster/runner/__init__.py`
- Create: `python/graph_caster/runner/task_executor.py`
- Create: `python/graph_caster/runner/mcp_tool_executor.py`
- Create: `python/graph_caster/runner/step_cache_mixin.py`
- Modify: `python/graph_caster/runner.py`
- Create: `python/tests/test_runner_task_executor.py`

- [ ] **Step 1: Create runner package directory**

```bash
mkdir -p python/graph_caster/runner
```

- [ ] **Step 2: Create step_cache_mixin.py**

Extract the duplicated step cache logic pattern:

```python
# python/graph_caster/runner/step_cache_mixin.py
# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import copy
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from graph_caster.models import Node
    from graph_caster.node_output_cache import StepCachePolicy, StepCacheStore

from graph_caster.node_output_cache import compute_step_cache_key


def _cache_key_prefix(key_hex: str) -> str:
    if len(key_hex) >= 16:
        return key_hex[:16]
    return key_hex


def _node_wants_step_cache(node: "Node") -> bool:
    v = node.data.get("stepCache")
    if v is True:
        return True
    if v in (1, "1", "true", "True", "yes", "Yes"):
        return True
    return False


class StepCacheContext:
    """Encapsulates step cache check and store logic for a single node execution."""

    def __init__(
        self,
        *,
        node: "Node",
        ctx: dict[str, Any],
        policy: "StepCachePolicy | None",
        store: "StepCacheStore | None",
        graph_id: str,
        emit: Any,
        upstream_outputs: dict[str, Any],
        upstream_incomplete_reason: str | None,
        graph_ref_upstream_revisions: list[tuple[str, str]],
        workspace_secrets_fp: str | None,
        cache_node_kind: str,
    ):
        self.node = node
        self.ctx = ctx
        self.policy = policy
        self.store = store
        self.graph_id = graph_id
        self.emit = emit
        self.cache_node_kind = cache_node_kind

        self.want_cache = _node_wants_step_cache(node)
        self.parent_ref = str(ctx.get("_parent_graph_ref_node_id") or "").strip()
        self.dirty = bool(
            policy
            and policy.enabled
            and (
                node.id in policy.dirty_nodes
                or (self.parent_ref != "" and self.parent_ref in policy.dirty_nodes)
            )
        )
        self.cache_active = (
            self.want_cache
            and policy is not None
            and policy.enabled
            and store is not None
        )

        self.used_cache = False
        self.cache_key: str | None = None
        self.upstream_incomplete = False
        self._upstream_outputs = upstream_outputs
        self._upstream_incomplete_reason = upstream_incomplete_reason
        self._gr_pairs = graph_ref_upstream_revisions
        self._ws_fp = workspace_secrets_fp

        self._compute_cache_state()

    def _compute_cache_state(self) -> None:
        if not self.cache_active:
            return

        graph_rev = str(self.ctx.get("graph_rev") or "")
        tenant_id = self.ctx.get("tenant_id")
        tenant_s = str(tenant_id).strip() if tenant_id is not None else None

        if self._upstream_incomplete_reason:
            self.upstream_incomplete = True
            self.emit(
                "node_cache_miss",
                nodeId=self.node.id,
                graphId=self.graph_id,
                reason=self._upstream_incomplete_reason,
            )
        elif self.dirty:
            self.cache_key = compute_step_cache_key(
                graph_rev=graph_rev,
                graph_id=self.graph_id,
                node_id=self.node.id,
                node_data=self.node.data,
                upstream_outputs=self._upstream_outputs,
                tenant_id=tenant_s,
                workspace_secrets_file_fp=self._ws_fp,
                graph_ref_upstream_revisions=self._gr_pairs,
                cache_node_kind=self.cache_node_kind,
            )
            self.emit(
                "node_cache_miss",
                nodeId=self.node.id,
                graphId=self.graph_id,
                keyPrefix=_cache_key_prefix(self.cache_key),
                reason="dirty",
            )
        else:
            self.cache_key = compute_step_cache_key(
                graph_rev=graph_rev,
                graph_id=self.graph_id,
                node_id=self.node.id,
                node_data=self.node.data,
                upstream_outputs=self._upstream_outputs,
                tenant_id=tenant_s,
                workspace_secrets_file_fp=self._ws_fp,
                graph_ref_upstream_revisions=self._gr_pairs,
                cache_node_kind=self.cache_node_kind,
            )
            cached = self.store.get(self.cache_key) if self.store else None
            if cached is not None:
                self._apply_cached_result(cached)
            else:
                self.emit(
                    "node_cache_miss",
                    nodeId=self.node.id,
                    graphId=self.graph_id,
                    keyPrefix=_cache_key_prefix(self.cache_key),
                )

    def _apply_cached_result(self, cached: dict[str, Any]) -> None:
        from graph_caster.gc_pin import last_result_from_process_result

        outs_map = self.ctx.setdefault("node_outputs", {})
        outs_map[self.node.id] = copy.deepcopy(cached)
        pr = cached.get("processResult")
        self.ctx["last_result"] = last_result_from_process_result(pr)
        self.emit(
            "node_cache_hit",
            nodeId=self.node.id,
            graphId=self.graph_id,
            keyPrefix=_cache_key_prefix(self.cache_key) if self.cache_key else "",
        )
        self.used_cache = True

    def store_result(self, outs_map: dict[str, Any]) -> None:
        if (
            self.cache_active
            and self.cache_key is not None
            and self.store is not None
            and not self.upstream_incomplete
        ):
            self.store.put(self.cache_key, copy.deepcopy(outs_map.get(self.node.id, {})))
```

- [ ] **Step 3: Create task_executor.py**

```python
# python/graph_caster/runner/task_executor.py
# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from typing import Any, Callable, Literal, TYPE_CHECKING

if TYPE_CHECKING:
    from graph_caster.models import Node
    from graph_caster.step_queue import StepQueue

from graph_caster.runner.step_cache_mixin import StepCacheContext


def run_task_visit(
    node: "Node",
    ctx: dict[str, Any],
    step_q: "StepQueue",
    *,
    emit: Callable[..., None],
    graph_id: str,
    step_cache_ctx: StepCacheContext | None,
    should_cancel: Callable[[], bool] | None,
    workspace_secrets: dict[str, str] | None,
    follow_edges_from: Callable[..., bool],
) -> tuple[Literal["ok", "continue", "break"], bool]:
    """Execute a task node and return (status, used_pin)."""
    from graph_caster.process_exec import run_task_process, redact_task_data_for_node_execute
    from graph_caster.gc_pin import (
        gc_pin_valid_for_short_circuit,
        merged_process_result_for_pin_short_circuit,
        snapshot_for_pin_event,
    )

    task_exit_used_pin = False
    outs_map = ctx.setdefault("node_outputs", {})
    outs_map.setdefault(node.id, {})

    # Check gcPin short-circuit
    pin_short = False
    pin_data = node.data.get("gcPin")
    if pin_data is not None and gc_pin_valid_for_short_circuit(pin_data, "task"):
        pin_short = True
        task_exit_used_pin = True
        merged = merged_process_result_for_pin_short_circuit(pin_data)
        outs_map[node.id]["processResult"] = merged
        ctx["last_result"] = merged.get("exitCode") == 0

    # Emit node_execute
    emit(
        "node_execute",
        nodeId=node.id,
        nodeType=node.type,
        graphId=graph_id,
        taskData=redact_task_data_for_node_execute(node.data),
    )

    ok = True
    used_step_cache = False

    if step_cache_ctx and step_cache_ctx.used_cache:
        used_step_cache = True

    if not pin_short and not used_step_cache:
        ok = run_task_process(
            node_id=node.id,
            graph_id=graph_id,
            data=dict(node.data),
            ctx=ctx,
            emit=emit,
            should_cancel=should_cancel,
            workspace_secrets=workspace_secrets,
        )

    if ok and step_cache_ctx and not used_step_cache:
        step_cache_ctx.store_result(outs_map)

    # Emit snapshot
    snap_o = outs_map.get(node.id)
    if isinstance(snap_o, dict) and isinstance(snap_o.get("processResult"), dict):
        emit(
            "node_outputs_snapshot",
            nodeId=node.id,
            graphId=graph_id,
            snapshot=snapshot_for_pin_event(snap_o),
        )

    if not ok:
        if ctx.get("_gc_process_cancelled"):
            ctx["_run_cancelled"] = True
        ne_task: dict[str, Any] = {
            "nodeId": node.id,
            "nodeType": node.type,
            "graphId": graph_id,
        }
        if task_exit_used_pin:
            ne_task["usedPin"] = True
        emit("node_exit", **ne_task)
        if ctx.get("_gc_process_cancelled"):
            return "break", task_exit_used_pin
        ctx["last_result"] = False
        if follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
            return "continue", task_exit_used_pin
        return "break", task_exit_used_pin

    return "ok", task_exit_used_pin
```

- [ ] **Step 4: Create __init__.py**

```python
# python/graph_caster/runner/__init__.py
# Copyright GraphCaster. All Rights Reserved.

from graph_caster.runner.step_cache_mixin import StepCacheContext
from graph_caster.runner.task_executor import run_task_visit

__all__ = ["StepCacheContext", "run_task_visit"]
```

- [ ] **Step 5: Write test for task_executor**

```python
# python/tests/test_runner_task_executor.py
# Copyright GraphCaster. All Rights Reserved.

import pytest
from unittest.mock import MagicMock, patch
from graph_caster.runner.task_executor import run_task_visit
from graph_caster.models import Node


def test_run_task_visit_ok():
    node = Node(id="n1", type="task", data={"command": "echo hello"})
    ctx = {"node_outputs": {}}
    step_q = MagicMock()
    emit = MagicMock()
    follow_edges = MagicMock(return_value=False)

    with patch("graph_caster.runner.task_executor.run_task_process", return_value=True):
        status, used_pin = run_task_visit(
            node=node,
            ctx=ctx,
            step_q=step_q,
            emit=emit,
            graph_id="test-graph",
            step_cache_ctx=None,
            should_cancel=None,
            workspace_secrets=None,
            follow_edges_from=follow_edges,
        )

    assert status == "ok"
    assert used_pin is False
    emit.assert_any_call(
        "node_execute",
        nodeId="n1",
        nodeType="task",
        graphId="test-graph",
        taskData={"command": "echo hello"},
    )
```

- [ ] **Step 6: Run tests**

Run: `cd python && python -m pytest tests/test_runner_task_executor.py -v`
Expected: PASS

- [ ] **Step 7: Update runner.py to use extracted modules**

Replace `_run_task_visit` method body with call to `run_task_visit` from module.

- [ ] **Step 8: Run full test suite**

Run: `cd python && python -m pytest tests/ -v`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add python/graph_caster/runner/ python/tests/test_runner_task_executor.py python/graph_caster/runner.py
git commit -m "refactor(python): extract task executor and step cache mixin from runner"
```

---

## Task 6: Extract GraphCanvas Hooks

**Files:**
- Create: `ui/src/components/canvas/useCanvasRunOverlay.ts`
- Create: `ui/src/components/canvas/useCanvasViewport.ts`
- Create: `ui/src/components/canvas/index.ts`
- Modify: `ui/src/components/GraphCanvas.tsx`

- [ ] **Step 1: Create canvas hooks directory**

```bash
mkdir -p ui/src/components/canvas
```

- [ ] **Step 2: Create useCanvasRunOverlay.ts**

Extract run highlight/overlay logic (~100 lines).

- [ ] **Step 3: Create useCanvasViewport.ts**

Extract viewport + LOD logic (~80 lines).

- [ ] **Step 4: Create index.ts barrel**

- [ ] **Step 5: Update GraphCanvas.tsx**

- [ ] **Step 6: Run tests and verify**

- [ ] **Step 7: Commit**

```bash
git add ui/src/components/canvas/ ui/src/components/GraphCanvas.tsx
git commit -m "refactor(ui): extract canvas hooks from GraphCanvas"
```

---

## Task 7: Split runSessionStore

**Files:**
- Create: `ui/src/run/runSessionActions.ts`
- Create: `ui/src/run/runSessionSelectors.ts`
- Modify: `ui/src/run/runSessionStore.ts`

- [ ] **Step 1: Create runSessionActions.ts**

Extract all action functions (~200 lines).

- [ ] **Step 2: Create runSessionSelectors.ts**

Extract selector/derived state functions (~100 lines).

- [ ] **Step 3: Update runSessionStore.ts**

Keep only store definition, import actions and selectors.

- [ ] **Step 4: Update imports across codebase**

- [ ] **Step 5: Run tests**

- [ ] **Step 6: Commit**

```bash
git add ui/src/run/runSessionActions.ts ui/src/run/runSessionSelectors.ts ui/src/run/runSessionStore.ts
git commit -m "refactor(ui): split runSessionStore into store/actions/selectors"
```

---

## Task 8: Extract Python Run Broker Routes

**Files:**
- Create: `python/graph_caster/run_broker/routes/__init__.py`
- Create: `python/graph_caster/run_broker/routes/http_routes.py`
- Create: `python/graph_caster/run_broker/routes/ws_routes.py`
- Modify: `python/graph_caster/run_broker/app.py`

- [ ] **Step 1: Create routes package**

```bash
mkdir -p python/graph_caster/run_broker/routes
```

- [ ] **Step 2: Create http_routes.py**

Extract REST endpoint handlers (~100 lines).

- [ ] **Step 3: Create ws_routes.py**

Extract WebSocket handlers (~80 lines).

- [ ] **Step 4: Create __init__.py**

- [ ] **Step 5: Update app.py**

Keep app factory, import routes.

- [ ] **Step 6: Run tests**

- [ ] **Step 7: Commit**

```bash
git add python/graph_caster/run_broker/routes/ python/graph_caster/run_broker/app.py
git commit -m "refactor(python): extract run_broker routes into separate modules"
```

---

## Summary: Expected File Size Reductions

| File | Before | After | Reduction |
|------|--------|-------|-----------|
| `AppShell.tsx` | ~1975 | ~400 | ~80% |
| `InspectorPanel.tsx` | ~1836 | ~300 | ~84% |
| `GraphCanvas.tsx` | ~1171 | ~500 | ~57% |
| `runner.py` | ~1921 | ~400 | ~79% |
| `runSessionStore.ts` | ~731 | ~200 | ~73% |
| `run_broker/app.py` | ~415 | ~150 | ~64% |

## Benefits

1. **Testability:** Extracted hooks and modules can be unit-tested in isolation
2. **Readability:** Each file has single responsibility, easier to understand
3. **Maintainability:** Changes localized, reduced merge conflicts
4. **Reusability:** Hooks can be reused across components
5. **Code navigation:** IDE can better navigate smaller, focused files
