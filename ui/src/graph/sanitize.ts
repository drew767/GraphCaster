// Copyright Aura. All Rights Reserved.

import type { GraphDocumentJson } from "./types";

export function sanitizeGraphConnectivity(doc: GraphDocumentJson): GraphDocumentJson {
  const nodes = doc.nodes ?? [];
  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = (doc.edges ?? []).filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  return { ...doc, nodes, edges };
}
