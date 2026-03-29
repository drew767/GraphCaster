// Copyright GraphCaster. All Rights Reserved.

import type { Edge, Node } from "@xyflow/react";

import { getWorldTopLeft } from "../../graph/flowHierarchy";
import { isReactFlowFrameNodeType } from "../../graph/nodeKinds";
import type { GcNodeData } from "../../graph/toReactFlow";

export function flowStateAfterRemovingNodeIds(
  nds: Node<GcNodeData>[],
  eds: Edge[],
  removeIds: Set<string>,
): { nodes: Node<GcNodeData>[]; edges: Edge[] } {
  const oldById = new Map(nds.map((n) => [n.id, n]));
  let next = nds.filter((n) => !removeIds.has(n.id));
  next = next.map((n) => {
    if (n.parentId && removeIds.has(n.parentId)) {
      const p = oldById.get(n.parentId);
      if (p && isReactFlowFrameNodeType(p.type)) {
        const abs = getWorldTopLeft(n as Node<GcNodeData>, oldById);
        const { parentId: _p, extent: _e, ...rest } = n as Node<GcNodeData> & {
          parentId?: string;
          extent?: unknown;
        };
        return { ...rest, position: abs } as Node<GcNodeData>;
      }
    }
    return n;
  });
  next = next.filter((n) => !removeIds.has(n.id));
  const nextEdges = eds.filter((e) => !removeIds.has(e.source) && !removeIds.has(e.target));
  return { nodes: next, edges: nextEdges };
}
