// Copyright GraphCaster. All Rights Reserved.

import { isGraphDocumentFrameType } from "./nodeKinds";
import type { GraphDocumentJson } from "./types";

export function findUnreachableWorkflowNodeIds(doc: GraphDocumentJson, startId: string): string[] {
  const nodes = doc.nodes ?? [];
  const edges = doc.edges ?? [];
  const adj = new Map<string, Set<string>>();
  for (const e of edges) {
    let outs = adj.get(e.source);
    if (outs == null) {
      outs = new Set();
      adj.set(e.source, outs);
    }
    outs.add(e.target);
  }
  const visited = new Set<string>();
  const q: string[] = [startId];
  visited.add(startId);
  while (q.length > 0) {
    const u = q.shift();
    if (u == null) {
      break;
    }
    const outs = adj.get(u);
    if (outs == null) {
      continue;
    }
    for (const v of outs) {
      if (!visited.has(v)) {
        visited.add(v);
        q.push(v);
      }
    }
  }
  const out: string[] = [];
  for (const n of nodes) {
    if (isGraphDocumentFrameType(n.type)) {
      continue;
    }
    if (!visited.has(n.id)) {
      out.push(n.id);
    }
  }
  out.sort();
  return out;
}
