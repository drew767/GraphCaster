// Copyright GraphCaster. All Rights Reserved.

import { sanitizeNodeParents } from "./flowHierarchy";
import type { GraphDocumentJson } from "./types";

export type SanitizeGraphConnectivityResult = {
  document: GraphDocumentJson;
  removedEdgeIds: string[];
};

export function sanitizeGraphConnectivity(doc: GraphDocumentJson): SanitizeGraphConnectivityResult {
  const nodes = sanitizeNodeParents(doc.nodes ?? []);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const removedEdgeIds: string[] = [];
  const edges = (doc.edges ?? []).filter((e) => {
    const ok = nodeIds.has(e.source) && nodeIds.has(e.target);
    if (!ok) {
      removedEdgeIds.push(e.id);
    }
    return ok;
  });
  const uniqueRemovedEdgeIds = [...new Set(removedEdgeIds)];
  return { document: { ...doc, nodes, edges }, removedEdgeIds: uniqueRemovedEdgeIds };
}
