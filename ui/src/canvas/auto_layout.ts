// Copyright GraphCaster. All Rights Reserved.

import type { Edge, Node } from "@xyflow/react";

export type LayoutAlgorithm = "dagre-lr" | "dagre-tb" | "elk-layered" | "elk-force";

export interface LayoutOptions {
  algorithm: LayoutAlgorithm;
  /** Gap between layers (default 80). */
  rankSeparation?: number;
  /** Gap between nodes in the same layer (default 50). */
  nodeSeparation?: number;
  /** Keep nodes with the same parentId together in groups (default true). */
  respectGroups?: boolean;
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

// ---------------------------------------------------------------------------
// Dagre
// ---------------------------------------------------------------------------

async function layoutWithDagre(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const rankSep = options.rankSeparation ?? 80;
  const nodeSep = options.nodeSeparation ?? 50;
  const isLR = options.algorithm === "dagre-lr";

  // Dynamic import so the bundle can tree-shake in environments where it is
  // unavailable (e.g. test runs that mock it).
  const dagre = await import("dagre");
  const g = new dagre.default.graphlib.Graph({ compound: true });
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: isLR ? "LR" : "TB",
    ranksep: rankSep,
    nodesep: nodeSep,
    marginx: 20,
    marginy: 20,
  });

  const respectGroups = options.respectGroups ?? true;

  // When respectGroups is true, only top-level nodes participate in the main
  // dagre layout. Children of group nodes keep their relative offset to their
  // parent and are repositioned after the parent's new position is known.
  const nodeIdSet = new Set(nodes.map((n) => n.id));
  const parentIdsInGraph = new Set(
    nodes.filter((n) => n.parentId && nodeIdSet.has(n.parentId)).map((n) => n.parentId as string),
  );

  const isTopLevel = (n: Node): boolean =>
    !respectGroups || !n.parentId || !nodeIdSet.has(n.parentId);

  const topLevelNodes = nodes.filter(isTopLevel);
  const childNodes = respectGroups ? nodes.filter((n) => !isTopLevel(n)) : [];

  for (const node of topLevelNodes) {
    g.setNode(node.id, { width: nodeW(node), height: nodeH(node), label: node.id });
  }

  for (const edge of edges) {
    if (g.hasNode(edge.source) && g.hasNode(edge.target)) {
      g.setEdge(edge.source, edge.target);
    }
  }

  dagre.default.layout(g);

  // Build new positions for top-level nodes.
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

  // Compute offsets for child nodes: preserve their position relative to parent.
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

  const layoutedNodes = nodes.map((node) => {
    const pos = newPositions.get(node.id);
    if (!pos) {
      return node;
    }
    return { ...node, position: pos };
  });

  return { nodes: layoutedNodes, edges };
}

// ---------------------------------------------------------------------------
// ELK
// ---------------------------------------------------------------------------

interface ElkNodeShape {
  id: string;
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  children?: ElkNodeShape[];
  layoutOptions?: Record<string, string>;
}

interface ElkEdgeShape {
  id: string;
  sources: string[];
  targets: string[];
}

interface ElkGraph extends ElkNodeShape {
  edges?: ElkEdgeShape[];
}

async function layoutWithElk(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  const rankSep = options.rankSeparation ?? 80;
  const nodeSep = options.nodeSeparation ?? 50;
  const isForce = options.algorithm === "elk-force";
  const respectGroups = options.respectGroups ?? true;

  const ELK = (await import("elkjs")).default;
  const elk = new ELK();

  const algOption = isForce
    ? "org.eclipse.elk.force"
    : "layered";

  const topLevelLayoutOptions: Record<string, string> = {
    "elk.algorithm": algOption,
    "elk.layered.spacing.nodeNodeBetweenLayers": String(rankSep),
    "elk.spacing.nodeNode": String(nodeSep),
    "elk.padding": "[top=20,left=20,bottom=20,right=20]",
  };

  if (!isForce) {
    topLevelLayoutOptions["elk.direction"] = "RIGHT";
  }

  // Build a map from parentId → child ids for group nesting.
  const parentIds = new Set(nodes.filter((n) => n.parentId).map((n) => n.parentId as string));

  // Separate top-level nodes from children.
  const topLevelNodes = nodes.filter(
    (n) => !n.parentId || !respectGroups || !parentIds.has(n.parentId),
  );
  const childrenByParent = new Map<string, Node[]>();
  if (respectGroups) {
    for (const n of nodes) {
      if (n.parentId && parentIds.has(n.parentId)) {
        const arr = childrenByParent.get(n.parentId) ?? [];
        arr.push(n);
        childrenByParent.set(n.parentId, arr);
      }
    }
  }

  const buildElkNode = (n: Node): ElkNodeShape => {
    const children = childrenByParent.get(n.id);
    const base: ElkNodeShape = {
      id: n.id,
      width: nodeW(n),
      height: nodeH(n),
    };
    if (children && children.length > 0) {
      base.children = children.map(buildElkNode);
      base.layoutOptions = {
        "elk.algorithm": algOption,
        "elk.layered.spacing.nodeNodeBetweenLayers": String(rankSep),
        "elk.spacing.nodeNode": String(nodeSep),
        "elk.padding": "[top=10,left=10,bottom=10,right=10]",
      };
    }
    return base;
  };

  const elkNodes: ElkNodeShape[] = topLevelNodes.map(buildElkNode);

  const elkEdges: ElkEdgeShape[] = [];
  for (const e of edges) {
    const srcInTop = topLevelNodes.some((n) => n.id === e.source);
    const tgtInTop = topLevelNodes.some((n) => n.id === e.target);
    if (srcInTop && tgtInTop) {
      elkEdges.push({ id: e.id, sources: [e.source], targets: [e.target] });
    }
  }

  const graph: ElkGraph = {
    id: "__root__",
    layoutOptions: topLevelLayoutOptions,
    children: elkNodes,
    edges: elkEdges,
  };

  const laid = await elk.layout(graph as Parameters<typeof elk.layout>[0]);

  // Collect positions from the laid-out graph.
  const positions = new Map<string, { x: number; y: number }>();

  function collectPositions(n: ElkNodeShape): void {
    if (n.id !== "__root__") {
      positions.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 });
    }
    for (const child of n.children ?? []) {
      collectPositions(child);
    }
  }
  collectPositions(laid as ElkNodeShape);

  const layoutedNodes = nodes.map((node) => {
    const pos = positions.get(node.id);
    if (!pos) {
      return node;
    }
    return { ...node, position: pos };
  });

  return { nodes: layoutedNodes, edges };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Compute auto-layout positions for a set of React Flow nodes and edges.
 * Returns new node objects with updated `position`; edges are returned
 * unchanged (positions of edge bend-points are not recalculated).
 */
export async function autoLayout(
  nodes: Node[],
  edges: Edge[],
  options: LayoutOptions,
): Promise<{ nodes: Node[]; edges: Edge[] }> {
  if (nodes.length === 0) {
    return { nodes: [], edges: [] };
  }

  const algo = options.algorithm;
  if (algo === "dagre-lr" || algo === "dagre-tb") {
    return layoutWithDagre(nodes, edges, options);
  }
  return layoutWithElk(nodes, edges, options);
}
