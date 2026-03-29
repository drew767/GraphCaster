// Copyright GraphCaster. All Rights Reserved.

import type { EdgeChange, Node, NodeChange } from "@xyflow/react";
import { useCallback } from "react";

import type { GcNodeData } from "../../../graph/toReactFlow";

export function useGraphCanvasNodesEdgesChangeGuards(options: {
  structureLocked: boolean;
  onBeforeStructureRemove?: () => void;
  onFlowStructureChange: () => void;
  onNodesChange: (changes: NodeChange<Node<GcNodeData>>[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
}): {
  onNodesChangeWrapped: (changes: NodeChange<Node>[]) => void;
  onEdgesChangeWrapped: (changes: EdgeChange[]) => void;
} {
  const {
    structureLocked,
    onBeforeStructureRemove,
    onFlowStructureChange,
    onNodesChange,
    onEdgesChange,
  } = options;

  const onNodesChangeWrapped = useCallback(
    (changes: NodeChange<Node>[]) => {
      if (structureLocked && changes.some((c) => c.type === "remove")) {
        return;
      }
      if (!structureLocked && changes.some((c) => c.type === "remove")) {
        onBeforeStructureRemove?.();
      }
      onNodesChange(changes as NodeChange<Node<GcNodeData>>[]);
      const syncDoc = changes.some((c) => c.type === "remove" || c.type === "dimensions");
      if (syncDoc) {
        window.requestAnimationFrame(() => {
          onFlowStructureChange();
        });
      }
    },
    [structureLocked, onBeforeStructureRemove, onFlowStructureChange, onNodesChange],
  );

  const onEdgesChangeWrapped = useCallback(
    (changes: EdgeChange[]) => {
      if (structureLocked && changes.some((c) => c.type === "remove")) {
        return;
      }
      if (!structureLocked && changes.some((c) => c.type === "remove")) {
        onBeforeStructureRemove?.();
      }
      onEdgesChange(changes);
      const removed = changes.some((c) => c.type === "remove");
      if (removed) {
        window.requestAnimationFrame(() => {
          onFlowStructureChange();
        });
      }
    },
    [structureLocked, onBeforeStructureRemove, onEdgesChange, onFlowStructureChange],
  );

  return { onNodesChangeWrapped, onEdgesChangeWrapped };
}
