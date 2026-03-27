// Copyright GraphCaster. All Rights Reserved.

import { sanitizeNodeParents } from "./flowHierarchy";
import type { GraphDocumentJson } from "./types";

export function sanitizeGraphConnectivity(doc: GraphDocumentJson): GraphDocumentJson {
  const nodes = sanitizeNodeParents(doc.nodes ?? []);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = (doc.edges ?? []).filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  return { ...doc, nodes, edges };
}
