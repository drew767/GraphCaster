// Copyright GraphCaster. All Rights Reserved.

/**
 * Off-main-thread layered layout (same algorithm as graph/layeredLayout.ts).
 */

export type LayoutWorkerNode = {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
};

export type LayoutWorkerEdge = { id: string; source: string; target: string };

export type LayoutWorkerOptions = {
  direction?: "TB" | "LR" | "BT" | "RL";
  nodeSpacing?: number;
  rankSpacing?: number;
};

export type LayoutWorkerRequest = {
  type: "layout";
  requestId: number;
  nodes: LayoutWorkerNode[];
  edges: LayoutWorkerEdge[];
  options?: LayoutWorkerOptions;
};

export type LayoutWorkerResponse = {
  type: "layout-complete";
  requestId: number;
  positions: Record<string, { x: number; y: number }>;
  error?: string;
};

function computePositions(
  nodes: LayoutWorkerNode[],
  edges: LayoutWorkerEdge[],
  options: LayoutWorkerOptions = {},
): Map<string, { x: number; y: number }> {
  const { direction = "LR", nodeSpacing = 50, rankSpacing = 150 } = options;

  const successors = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();

  for (const node of nodes) {
    successors.set(node.id, []);
    predecessors.set(node.id, []);
  }

  for (const edge of edges) {
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

self.onmessage = (e: MessageEvent<LayoutWorkerRequest>) => {
  const data = e.data;
  if (data.type !== "layout") {
    return;
  }
  try {
    const pos = computePositions(data.nodes, data.edges, data.options ?? {});
    const positions: Record<string, { x: number; y: number }> = {};
    for (const [id, p] of pos) {
      positions[id] = p;
    }
    const res: LayoutWorkerResponse = {
      type: "layout-complete",
      requestId: data.requestId,
      positions,
    };
    self.postMessage(res);
  } catch (err) {
    const res: LayoutWorkerResponse = {
      type: "layout-complete",
      requestId: data.requestId,
      positions: {},
      error: err instanceof Error ? err.message : String(err),
    };
    self.postMessage(res);
  }
};

export {};
