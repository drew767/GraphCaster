// Copyright GraphCaster. All Rights Reserved.

import type { Edge, Node } from "@xyflow/react";
import { useCallback } from "react";

import type { GraphCanvasSelection } from "../graphCanvasSelection";
import type { GcNodeData } from "../../../graph/toReactFlow";

function conditionFromEdgeLabel(label: Edge["label"]): string | null {
  if (label == null) {
    return null;
  }
  if (typeof label === "string") {
    const s = label.trim();
    return s === "" ? null : s;
  }
  return null;
}

export function useGraphCanvasSelectionChange(
  onSelect: (selection: GraphCanvasSelection | null) => void,
): (args: { nodes: Node[]; edges: Edge[] }) => void {
  return useCallback(
    ({ nodes: selNodes, edges: selEdges }: { nodes: Node[]; edges: Edge[] }) => {
      if (selNodes.length >= 2) {
        const rows = selNodes.map((node) => {
          const d = node.data as GcNodeData | undefined;
          return {
            id: node.id,
            graphNodeType: d?.graphNodeType ?? "unknown",
            label: d?.label ?? node.id,
          };
        });
        onSelect({ kind: "multiNode", ids: rows.map((r) => r.id), nodes: rows });
        return;
      }
      if (selNodes.length === 1) {
        const node = selNodes[0];
        const d = node.data as GcNodeData | undefined;
        if (!d) {
          onSelect(null);
          return;
        }
        onSelect({
          kind: "node",
          id: node.id,
          graphNodeType: d.graphNodeType,
          label: d.label,
          raw: d.raw,
        });
        return;
      }
      if (selEdges.length >= 1) {
        const edge = selEdges[0];
        const ed = edge.data as { routeDescription?: string } | undefined;
        const rd = typeof ed?.routeDescription === "string" ? ed.routeDescription : "";
        onSelect({
          kind: "edge",
          id: edge.id,
          source: edge.source,
          target: edge.target,
          condition: conditionFromEdgeLabel(edge.label),
          routeDescription: rd,
        });
        return;
      }
      onSelect(null);
    },
    [onSelect],
  );
}
