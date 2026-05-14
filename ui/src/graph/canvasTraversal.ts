// Copyright GraphCaster. All Rights Reserved.

import type { Edge, Node } from "@xyflow/react";

/**
 * Returns all nodes reachable upstream from the given node by following incoming edges
 * (breadth-first; does not include the starting node itself).
 */
export function findUpstreamNodes(nodeId: string, nodes: Node[], edges: Edge[]): Node[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const queue: string[] = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.target === current && !visited.has(edge.source)) {
        visited.add(edge.source);
        queue.push(edge.source);
      }
    }
  }

  return Array.from(visited)
    .map((id) => nodeMap.get(id))
    .filter((n): n is Node => n != null);
}

/**
 * Returns all nodes reachable downstream from the given node by following outgoing edges
 * (breadth-first; does not include the starting node itself).
 */
export function findDownstreamNodes(nodeId: string, nodes: Node[], edges: Edge[]): Node[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const visited = new Set<string>();
  const queue: string[] = [nodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.source === current && !visited.has(edge.target)) {
        visited.add(edge.target);
        queue.push(edge.target);
      }
    }
  }

  return Array.from(visited)
    .map((id) => nodeMap.get(id))
    .filter((n): n is Node => n != null);
}

/**
 * Finds the nearest node in the given direction relative to the given node's position.
 * Uses the node's x/y position for comparison. Returns null if none found.
 */
export function findAdjacentSibling(
  nodeId: string,
  direction: "up" | "down" | "left" | "right",
  nodes: Node[],
): Node | null {
  const origin = nodes.find((n) => n.id === nodeId);
  if (!origin) {
    return null;
  }

  const ox = origin.position.x;
  const oy = origin.position.y;

  let best: Node | null = null;
  let bestDist = Infinity;

  for (const node of nodes) {
    if (node.id === nodeId) {
      continue;
    }

    const nx = node.position.x;
    const ny = node.position.y;
    const dx = nx - ox;
    const dy = ny - oy;

    let isCandidate = false;
    let dist = 0;

    switch (direction) {
      case "up":
        if (dy < 0) {
          isCandidate = true;
          dist = Math.sqrt(dx * dx + dy * dy);
        }
        break;
      case "down":
        if (dy > 0) {
          isCandidate = true;
          dist = Math.sqrt(dx * dx + dy * dy);
        }
        break;
      case "left":
        if (dx < 0) {
          isCandidate = true;
          dist = Math.sqrt(dx * dx + dy * dy);
        }
        break;
      case "right":
        if (dx > 0) {
          isCandidate = true;
          dist = Math.sqrt(dx * dx + dy * dy);
        }
        break;
    }

    if (isCandidate && dist < bestDist) {
      bestDist = dist;
      best = node;
    }
  }

  return best;
}
