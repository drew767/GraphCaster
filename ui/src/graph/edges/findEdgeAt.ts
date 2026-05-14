// Copyright GraphCaster. All Rights Reserved.

import type { Edge, Node } from "@xyflow/react";

export const DEFAULT_EDGE_DROP_TOLERANCE = 12;

interface NodeCenterLookup {
  readonly id: string;
  readonly cx: number;
  readonly cy: number;
}

const DEFAULT_NODE_W = 200;
const DEFAULT_NODE_H = 80;

function nodeCenter(node: Node): { cx: number; cy: number } {
  const wRaw =
    typeof node.width === "number"
      ? node.width
      : typeof (node as { measured?: { width?: number } }).measured?.width === "number"
        ? (node as { measured?: { width?: number } }).measured!.width!
        : DEFAULT_NODE_W;
  const hRaw =
    typeof node.height === "number"
      ? node.height
      : typeof (node as { measured?: { height?: number } }).measured?.height === "number"
        ? (node as { measured?: { height?: number } }).measured!.height!
        : DEFAULT_NODE_H;
  const w = Number.isFinite(wRaw) && wRaw > 0 ? wRaw : DEFAULT_NODE_W;
  const h = Number.isFinite(hRaw) && hRaw > 0 ? hRaw : DEFAULT_NODE_H;
  return {
    cx: node.position.x + w / 2,
    cy: node.position.y + h / 2,
  };
}

/** Squared distance from point (px, py) to segment (ax, ay)–(bx, by). */
export function pointToSegmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  if (lenSq === 0) {
    return apx * apx + apy * apy;
  }
  let t = (apx * abx + apy * aby) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy;
}

/**
 * Find an edge whose straight-line segment between source and target node centers
 * passes within `tolerance` flow-coordinate units of point (`fx`, `fy`).
 * Returns the closest qualifying edge, or `null` if none qualify.
 */
export function findEdgeAtFlowPosition(
  edges: readonly Edge[],
  nodes: readonly Node[],
  fx: number,
  fy: number,
  tolerance: number = DEFAULT_EDGE_DROP_TOLERANCE,
): Edge | null {
  if (edges.length === 0 || nodes.length === 0) {
    return null;
  }
  const centers = new Map<string, NodeCenterLookup>();
  for (const n of nodes) {
    const { cx, cy } = nodeCenter(n);
    centers.set(n.id, { id: n.id, cx, cy });
  }
  const tolSq = tolerance * tolerance;
  let best: Edge | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const edge of edges) {
    const src = centers.get(edge.source);
    const tgt = centers.get(edge.target);
    if (!src || !tgt) {
      continue;
    }
    const dSq = pointToSegmentDistanceSq(fx, fy, src.cx, src.cy, tgt.cx, tgt.cy);
    if (dSq <= tolSq && dSq < bestDistSq) {
      best = edge;
      bestDistSq = dSq;
    }
  }
  return best;
}
