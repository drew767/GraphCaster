// Copyright GraphCaster. All Rights Reserved.

/**
 * Open graph document + workspace state. Currently SHADOWED by AppShell's
 * local useState; this store is the migration target for Шаг 9 follow-ups.
 *
 * MAY:
 * - Hold graphDocument, workspaceGraphsDir, workspaceIndex, layoutEpoch.
 * - Expose setGraphDocument/setWorkspace/bumpLayoutEpoch actions.
 *
 * MUST NOT:
 * - Know about React Flow (Node/Edge xyflow types are renderer-local).
 * - Know about run-state (that's runSessionStore).
 * - Do I/O (loaders live in lib/workspaceFs.ts).
 */

import { create } from "zustand";
import type { GraphDocumentJson } from "../graph/types";
import type { WorkspaceGraphEntry } from "../lib/workspaceFs";

export interface GraphStoreState {
  graphDocument: GraphDocumentJson | null;
  workspaceGraphsDir: FileSystemDirectoryHandle | null;
  workspaceIndex: readonly WorkspaceGraphEntry[];
  layoutEpoch: number;
  setGraphDocument: (doc: GraphDocumentJson | null) => void;
  setWorkspace: (
    dir: FileSystemDirectoryHandle | null,
    index: readonly WorkspaceGraphEntry[],
  ) => void;
  bumpLayoutEpoch: () => void;
}

export const useGraphStore = create<GraphStoreState>((set) => ({
  graphDocument: null,
  workspaceGraphsDir: null,
  workspaceIndex: [],
  layoutEpoch: 0,
  setGraphDocument: (doc) => set({ graphDocument: doc }),
  setWorkspace: (dir, index) =>
    set({ workspaceGraphsDir: dir, workspaceIndex: index }),
  bumpLayoutEpoch: () => set((s) => ({ layoutEpoch: s.layoutEpoch + 1 })),
}));
