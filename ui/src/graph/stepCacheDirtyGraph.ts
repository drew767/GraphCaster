// Copyright GraphCaster. All Rights Reserved.

import {
  EDGE_SOURCE_OUT_ERROR,
  normalizeEdgeHandleValue,
  pickEdgeHandleRaw,
} from "./normalizeHandles";
import {
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_GRAPH_REF,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_TASK,
} from "./nodeKinds";
import type { GraphDocumentJson, GraphEdgeJson, GraphNodeJson } from "./types";

export type SuccessPathAdjacency = ReadonlyMap<string, readonly string[]>;

const NODE_TYPES_DATA_EDIT_INVALIDATES_STEP_CACHE = new Set<string>([
  GRAPH_NODE_TYPE_TASK,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_GRAPH_REF,
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_EXIT,
]);

export function nodeTypeTriggersStepCacheDirtyOnDataEdit(nodeType: string | undefined): boolean {
  if (nodeType == null || nodeType === "") {
    return false;
  }
  return NODE_TYPES_DATA_EDIT_INVALIDATES_STEP_CACHE.has(nodeType);
}

function dataStepCacheEnabled(data: GraphNodeJson["data"]): boolean {
  const v = data?.stepCache;
  if (v === true) {
    return true;
  }
  if (v === 1 || v === "1" || v === "true" || v === "True" || v === "yes" || v === "Yes") {
    return true;
  }
  return false;
}

function isSuccessPathEdge(e: GraphEdgeJson): boolean {
  const er = e as Record<string, unknown>;
  const raw = pickEdgeHandleRaw(er, "sourceHandle", "source_handle");
  const h = normalizeEdgeHandleValue(raw, "out_default");
  return h !== EDGE_SOURCE_OUT_ERROR;
}

export function buildSuccessPathAdjacency(doc: GraphDocumentJson): SuccessPathAdjacency {
  const edges = doc.edges ?? [];
  const m = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!isSuccessPathEdge(e)) {
      continue;
    }
    const src = e.source;
    const tgt = e.target;
    if (src === "" || tgt === "") {
      continue;
    }
    let set = m.get(src);
    if (set == null) {
      set = new Set();
      m.set(src, set);
    }
    set.add(tgt);
  }
  return new Map([...m.entries()].map(([src, set]) => [src, [...set]] as const));
}

export function collectDownstreamNodeIds(
  adj: SuccessPathAdjacency,
  seedIds: readonly string[],
): string[] {
  const seeds = [...new Set(seedIds.map((s) => s.trim()).filter((s) => s !== ""))];
  if (seeds.length === 0) {
    return [];
  }
  const out: string[] = [];
  const visited = new Set<string>();
  const q: string[] = [...seeds];
  for (const s of seeds) {
    visited.add(s);
    out.push(s);
  }
  while (q.length > 0) {
    const id = q.shift()!;
    const nbrs = adj.get(id);
    if (nbrs == null) {
      continue;
    }
    for (const t of nbrs) {
      if (visited.has(t)) {
        continue;
      }
      visited.add(t);
      out.push(t);
      q.push(t);
    }
  }
  return out;
}

export function wantsStepCacheOnNode(node: GraphNodeJson | undefined): boolean {
  if (node == null) {
    return false;
  }
  const t = node.type;
  if (
    t !== GRAPH_NODE_TYPE_TASK &&
    t !== GRAPH_NODE_TYPE_MCP_TOOL &&
    t !== GRAPH_NODE_TYPE_AI_ROUTE
  ) {
    return false;
  }
  return dataStepCacheEnabled(node.data);
}

export function filterStepCacheParticipants(doc: GraphDocumentJson, ids: readonly string[]): string[] {
  const nodes = doc.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    if (!wantsStepCacheOnNode(byId.get(id))) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function transitiveStepCacheDirtyNodeIds(
  doc: GraphDocumentJson,
  seedIds: readonly string[],
): string[] {
  const adj = buildSuccessPathAdjacency(doc);
  const closure = collectDownstreamNodeIds(adj, seedIds);
  return filterStepCacheParticipants(doc, closure);
}
