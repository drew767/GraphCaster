// Copyright GraphCaster. All Rights Reserved.

import type { Edge, Node } from "@xyflow/react";

export type LayeredLayoutOptions = {
  direction?: "TB" | "LR" | "BT" | "RL";
  nodeSpacing?: number;
  rankSpacing?: number;
};

type LayoutEdge = { id: string; source: string; target: string };

/**
 * Lightweight layered layout (DAG ranks). Used for async / worker layout previews.
 */
export function layeredLayoutPositions<N extends Node>(
  nodes: N[],
  edges: Edge[],
  options: LayeredLayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const { direction = "LR", nodeSpacing = 50, rankSpacing = 150 } = options;

  const layoutEdges: LayoutEdge[] = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
  }));

  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();

  for (const node of nodes) {
    successors.set(node.id, []);
    predecessors.set(node.id, []);
  }

  for (const edge of layoutEdges) {
    successors.get(edge.source)?.push(edge.target);
    predecessors.get(edge.target)?.push(edge.source);
  }

  const ranks = new Map<string, number>();
  const visited = new Set<string>();

  function assignRank(nodeId: string): number {
    if (ranks.has(nodeId)) {
      return ranks.get(nodeId)!;
    }
    if (visited.has(nodeId)) {
      return 0;
    }

    visited.add(nodeId);

    const preds = predecessors.get(nodeId) || [];
    const maxPredRank = preds.length > 0 ? Math.max(...preds.map(assignRank)) : -1;

    const rank = maxPredRank + 1;
    ranks.set(nodeId, rank);
    return rank;
  }

  for (const node of nodes) {
    assignRank(node.id);
  }

  const rankGroups = new Map<number, string[]>();
  for (const [nodeId, rank] of ranks) {
    if (!rankGroups.has(rank)) {
      rankGroups.set(rank, []);
    }
    rankGroups.get(rank)!.push(nodeId);
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const out = new Map<string, { x: number; y: number }>();

  const isHorizontal = direction === "LR" || direction === "RL";
  const sortedRanks = [...rankGroups.keys()].sort((a, b) => a - b);

  for (const rank of sortedRanks) {
    const nodesInRank = rankGroups.get(rank)!;
    const rankPosition = rank * rankSpacing;

    nodesInRank.forEach((nodeId, index) => {
      const node = nodeById.get(nodeId)!;
      const h = typeof node.height === "number" ? node.height : 60;
      const offset = index * (nodeSpacing + h);

      out.set(
        nodeId,
        isHorizontal ? { x: rankPosition, y: offset } : { x: offset, y: rankPosition },
      );
    });
  }

  return out;
}
