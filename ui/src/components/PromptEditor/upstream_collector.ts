// Copyright GraphCaster. All Rights Reserved.

import type { GraphDocumentJson } from "../../graph/types";
import { isGraphDocumentFrameType } from "../../graph/nodeKinds";

export type UpstreamNodeRef = {
  id: string;
  type: string;
  outputs: string[];
};

/**
 * Walk the graph DAG backwards from `currentNodeId` and collect all ancestors
 * that are executable (not frames). For each ancestor, derive output handle names
 * from the outgoing edges (sourceHandle) or fall back to ["out_default"].
 */
export function collectUpstreamNodes(
  doc: GraphDocumentJson,
  currentNodeId: string,
): UpstreamNodeRef[] {
  const nodes = doc.nodes ?? [];
  const edges = doc.edges ?? [];

  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  // Build reverse adjacency: target → [source, ...]
  const reverseAdj = new Map<string, string[]>();
  for (const e of edges) {
    const arr = reverseAdj.get(e.target) ?? [];
    arr.push(e.source);
    reverseAdj.set(e.target, arr);
  }

  // BFS backwards
  const visited = new Set<string>();
  const queue: string[] = [currentNodeId];
  visited.add(currentNodeId);

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const parents = reverseAdj.get(nodeId) ?? [];
    for (const p of parents) {
      if (!visited.has(p)) {
        visited.add(p);
        queue.push(p);
      }
    }
  }

  // Remove the current node itself from the ancestor set
  visited.delete(currentNodeId);

  // Build output handle map: nodeId → set of sourceHandles used on outgoing edges
  const outHandles = new Map<string, Set<string>>();
  for (const e of edges) {
    const handle = e.sourceHandle ?? e.source_handle ?? null;
    if (handle != null && handle.trim() !== "") {
      const set = outHandles.get(e.source) ?? new Set();
      set.add(handle.trim());
      outHandles.set(e.source, set);
    }
  }

  const result: UpstreamNodeRef[] = [];
  for (const nodeId of visited) {
    const node = nodeById.get(nodeId);
    if (!node) {
      continue;
    }
    if (isGraphDocumentFrameType(node.type)) {
      continue;
    }
    const handles = outHandles.get(nodeId);
    const outputs: string[] =
      handles && handles.size > 0 ? Array.from(handles).sort() : ["out_default"];
    result.push({ id: nodeId, type: node.type, outputs });
  }

  result.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}
