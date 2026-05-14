// Copyright GraphCaster. All Rights Reserved.

import type { Edge, Node } from "@xyflow/react";

export type TidyUpDirection = "LR" | "TB";

export interface TidyUpOptions {
  rankSeparation?: number;
  nodeSeparation?: number;
}

const DEFAULT_NODE_WIDTH = 200;
const DEFAULT_NODE_HEIGHT = 80;

function nodeW(n: Node): number {
  return typeof n.measured?.width === "number" && n.measured.width > 0
    ? n.measured.width
    : typeof n.width === "number" && n.width > 0
      ? n.width
      : DEFAULT_NODE_WIDTH;
}

function nodeH(n: Node): number {
  return typeof n.measured?.height === "number" && n.measured.height > 0
    ? n.measured.height
    : typeof n.height === "number" && n.height > 0
      ? n.height
      : DEFAULT_NODE_HEIGHT;
}

/**
 * Compute new positions for the given nodes using a dagre layered layout.
 * Returns a new array of nodes with updated `position` (other props are
 * preserved). Edges are not modified.
 */
export async function tidyUp(
  nodes: Node[],
  edges: Edge[],
  direction: TidyUpDirection = "LR",
  options: TidyUpOptions = {},
): Promise<Node[]> {
  if (nodes.length === 0) {
    return [];
  }

  const rankSep = options.rankSeparation ?? 80;
  const nodeSep = options.nodeSeparation ?? 50;

  const dagre = await import("dagre");
  const g = new dagre.default.graphlib.Graph({ compound: true });
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep: rankSep,
    nodesep: nodeSep,
    marginx: 20,
    marginy: 20,
  });

  const nodeIdSet = new Set(nodes.map((n) => n.id));

  const isTopLevel = (n: Node): boolean => !n.parentId || !nodeIdSet.has(n.parentId);

  const topLevelNodes = nodes.filter(isTopLevel);
  const childNodes = nodes.filter((n) => !isTopLevel(n));

  for (const node of topLevelNodes) {
    g.setNode(node.id, { width: nodeW(node), height: nodeH(node), label: node.id });
  }

  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.default.layout(g);

  const newPositions = new Map<string, { x: number; y: number }>();
  for (const node of topLevelNodes) {
    const n = g.node(node.id);
    if (n) {
      const w = nodeW(node);
      const h = nodeH(node);
      newPositions.set(node.id, { x: n.x - w / 2, y: n.y - h / 2 });
    } else {
      newPositions.set(node.id, node.position);
    }
  }

  // Keep child nodes attached to their parents by offset.
  for (const child of childNodes) {
    const parentId = child.parentId!;
    const parentNode = nodes.find((n) => n.id === parentId);
    if (!parentNode) {
      newPositions.set(child.id, child.position);
      continue;
    }
    const oldParentPos = parentNode.position;
    const newParentPos = newPositions.get(parentId) ?? oldParentPos;
    const dx = newParentPos.x - oldParentPos.x;
    const dy = newParentPos.y - oldParentPos.y;
    newPositions.set(child.id, {
      x: child.position.x + dx,
      y: child.position.y + dy,
    });
  }

  return nodes.map((node) => {
    const pos = newPositions.get(node.id);
    if (!pos) {
      return node;
    }
    return { ...node, position: pos };
  });
}
