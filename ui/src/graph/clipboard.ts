// Copyright GraphCaster. All Rights Reserved.

import { GRAPH_NODE_TYPE_START } from "./nodeKinds";
import type { GraphDocumentJson, GraphEdgeJson, GraphNodeJson } from "./types";

export const GRAPH_CASTER_CLIPBOARD_KIND = "graphCaster:nodes-v1" as const;

export type GraphCasterClipboardV1 = {
  kind: typeof GRAPH_CASTER_CLIPBOARD_KIND;
  schemaVersion: number;
  nodes: GraphNodeJson[];
  edges: GraphEdgeJson[];
};

function cloneJson<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function buildClipboardPayload(
  doc: GraphDocumentJson,
  nodeIds: ReadonlySet<string>,
): GraphCasterClipboardV1 | null {
  if (nodeIds.size === 0) {
    return null;
  }
  const rawNodes = doc.nodes ?? [];
  const nodes = rawNodes.filter(
    (n) => nodeIds.has(n.id) && n.type !== GRAPH_NODE_TYPE_START,
  );
  if (nodes.length === 0) {
    return null;
  }
  const idset = new Set(nodes.map((n) => n.id));
  const edges = (doc.edges ?? []).filter((e) => idset.has(e.source) && idset.has(e.target));
  return {
    kind: GRAPH_CASTER_CLIPBOARD_KIND,
    schemaVersion: typeof doc.schemaVersion === "number" ? doc.schemaVersion : 1,
    nodes: nodes.map((n) => cloneJson(n)),
    edges: edges.map((e) => cloneJson(e)),
  };
}

export function parseClipboardPayload(raw: string): GraphCasterClipboardV1 | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }
  const o = parsed as Record<string, unknown>;
  if (o.kind !== GRAPH_CASTER_CLIPBOARD_KIND) {
    return null;
  }
  if (!Array.isArray(o.nodes) || !Array.isArray(o.edges)) {
    return null;
  }
  return o as GraphCasterClipboardV1;
}

export type MergePastedSubgraphDeps = {
  newNodeId: () => string;
  newEdgeId: () => string;
  positionOffset: { x: number; y: number };
};

export function mergePastedSubgraph(
  base: GraphDocumentJson,
  payload: GraphCasterClipboardV1,
  deps: MergePastedSubgraphDeps,
): GraphDocumentJson {
  const docHasStart = (base.nodes ?? []).some((n) => n.type === GRAPH_NODE_TYPE_START);
  const nodesToPaste = payload.nodes.filter((n) => {
    if (n.type !== GRAPH_NODE_TYPE_START) {
      return true;
    }
    return !docHasStart;
  });
  if (nodesToPaste.length === 0) {
    return base;
  }
  const seenPasteIds = new Set<string>();
  for (const n of nodesToPaste) {
    if (seenPasteIds.has(n.id)) {
      return base;
    }
    seenPasteIds.add(n.id);
  }
  const idMap = new Map<string, string>();
  for (const n of nodesToPaste) {
    idMap.set(n.id, deps.newNodeId());
  }
  const newNodes: GraphNodeJson[] = nodesToPaste.map((n) => {
    const row = cloneJson(n);
    row.id = idMap.get(n.id) ?? deps.newNodeId();
    const p = row.position ?? { x: 0, y: 0 };
    row.position = {
      x: (typeof p.x === "number" ? p.x : 0) + deps.positionOffset.x,
      y: (typeof p.y === "number" ? p.y : 0) + deps.positionOffset.y,
    };
    if (typeof row.parentId === "string" && row.parentId !== "") {
      const np = idMap.get(row.parentId);
      if (np !== undefined) {
        row.parentId = np;
      } else {
        delete row.parentId;
      }
    }
    return row;
  });
  const idset = new Set(nodesToPaste.map((n) => n.id));
  const newEdges: GraphEdgeJson[] = [];
  for (const e of payload.edges ?? []) {
    if (!idset.has(e.source) || !idset.has(e.target)) {
      continue;
    }
    const s = idMap.get(e.source);
    const t = idMap.get(e.target);
    if (s === undefined || t === undefined) {
      continue;
    }
    const row = cloneJson(e);
    row.id = deps.newEdgeId();
    row.source = s;
    row.target = t;
    newEdges.push(row);
  }
  return {
    ...base,
    nodes: [...(base.nodes ?? []), ...newNodes],
    edges: [...(base.edges ?? []), ...newEdges],
  };
}
