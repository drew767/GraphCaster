// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export type EdgeInsertAnchor = { x: number; y: number };

export type EdgeInsertConfirmHandler = (
  edgeId: string,
  nodeType: string,
  anchor: EdgeInsertAnchor,
) => void;

interface EdgeInsertState {
  open: boolean;
  edgeId: string | null;
  anchor: EdgeInsertAnchor | null;
  /**
   * Canvas-provided handler that performs the actual split (create node, delete
   * old edge, add two new edges). Registered by `GraphCanvas` while mounted.
   */
  confirmHandler: EdgeInsertConfirmHandler | null;
  requestInsert: (edgeId: string, x: number, y: number) => void;
  cancel: () => void;
  confirm: (nodeType: string) => void;
  registerConfirmHandler: (handler: EdgeInsertConfirmHandler | null) => void;
}

export const useEdgeInsertStore = create<EdgeInsertState>((set, get) => ({
  open: false,
  edgeId: null,
  anchor: null,
  confirmHandler: null,

  requestInsert: (edgeId, x, y) => {
    set({ open: true, edgeId, anchor: { x, y } });
  },

  cancel: () => {
    set({ open: false, edgeId: null, anchor: null });
  },

  confirm: (nodeType) => {
    const { edgeId, anchor, confirmHandler } = get();
    if (edgeId != null && anchor != null && confirmHandler != null) {
      confirmHandler(edgeId, nodeType, anchor);
    }
    set({ open: false, edgeId: null, anchor: null });
  },

  registerConfirmHandler: (handler) => {
    set({ confirmHandler: handler });
  },
}));
