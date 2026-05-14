// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

/**
 * Allowed values for `node.mode` (mirrors Python `NODE_MODES` in
 * `python/graph_caster/models.py`). Keep in sync.
 */
export type NodeMode = "normal" | "bypass" | "mute" | "disabled";

export const NODE_MODES: ReadonlySet<NodeMode> = new Set([
  "normal",
  "bypass",
  "mute",
  "disabled",
]);

export function isNodeMode(value: unknown): value is NodeMode {
  return typeof value === "string" && NODE_MODES.has(value as NodeMode);
}

/**
 * Command-dispatch pattern (mirrors `edgeInsertStore.ts`). The store does NOT
 * own xyflow nodes/edges — `GraphCanvas` registers a handler that performs the
 * actual mutation via `setNodes`. This keeps the single source of truth in
 * xyflow while letting any component (context menu, hotkey, AI hub) request
 * mutations without prop-drilling.
 */

export type GraphMutationCommand =
  | { kind: "setNodeMode"; nodeIds: string[]; mode: NodeMode }
  | { kind: "toggleCollapse"; nodeIds: string[] }
  | { kind: "togglePin"; nodeIds: string[] };

export type GraphMutationHandler = (cmd: GraphMutationCommand) => void;

interface GraphMutationsState {
  handler: GraphMutationHandler | null;
  registerHandler: (handler: GraphMutationHandler | null) => void;

  setNodeMode: (nodeIds: string[], mode: NodeMode) => void;
  toggleCollapse: (nodeIds: string[]) => void;
  togglePin: (nodeIds: string[]) => void;
  dispatch: (cmd: GraphMutationCommand) => void;
}

export const useGraphMutationsStore = create<GraphMutationsState>((set, get) => ({
  handler: null,

  registerHandler: (handler) => {
    set({ handler });
  },

  dispatch: (cmd) => {
    const { handler } = get();
    if (handler != null) {
      handler(cmd);
    } else if (typeof console !== "undefined") {
      // No-op when the canvas is not mounted yet — keep ergonomic.
      console.warn("[graphMutationsStore] dispatch ignored, no handler registered", cmd);
    }
  },

  setNodeMode: (nodeIds, mode) => {
    if (nodeIds.length === 0) {
      return;
    }
    get().dispatch({ kind: "setNodeMode", nodeIds, mode });
  },

  toggleCollapse: (nodeIds) => {
    if (nodeIds.length === 0) {
      return;
    }
    get().dispatch({ kind: "toggleCollapse", nodeIds });
  },

  togglePin: (nodeIds) => {
    if (nodeIds.length === 0) {
      return;
    }
    get().dispatch({ kind: "togglePin", nodeIds });
  },
}));
