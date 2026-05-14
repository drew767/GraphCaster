// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export type NodeAddPopoverAnchor = {
  /** Screen x/y for the popover (right edge of the source node). */
  x: number;
  y: number;
  /** Source node id that anchors the popover; used when creating the follow-up node. */
  sourceNodeId: string;
};

export type NodeAddPopoverState = {
  open: boolean;
  anchor: NodeAddPopoverAnchor | null;
  openAt: (anchor: NodeAddPopoverAnchor) => void;
  close: () => void;
};

export const useNodeAddPopoverStore = create<NodeAddPopoverState>((set) => ({
  open: false,
  anchor: null,
  openAt: (anchor) => {
    set({ open: true, anchor });
  },
  close: () => {
    set({ open: false, anchor: null });
  },
}));
