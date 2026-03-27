// Copyright Aura. All Rights Reserved.

import type { Edge, Node } from "@xyflow/react";

import { flowConnectionHandle } from "./normalizeHandles";
import type { GraphDocumentJson, GraphEdgeJson, GraphNodeJson } from "./types";
import type { GcNodeData } from "./toReactFlow";

function edgeLabelToCondition(label: Edge["label"]): string | null {
  if (label == null) {
    return null;
  }
  if (typeof label === "string") {
    const s = label.trim();
    return s === "" ? null : s;
  }
  return null;
}

function coerceSchemaVersion(v: unknown, fallback: number): number {
  if (typeof v === "boolean") {
    return v ? 1 : 0;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
    return parseInt(v.trim(), 10);
  }
  return fallback;
}

export function flowToDocument(
  nodes: Node<GcNodeData>[],
  edges: Edge[],
  base: GraphDocumentJson,
): GraphDocumentJson {
  const outNodes: GraphNodeJson[] = nodes.map((n) => ({
    id: n.id,
    type: n.data?.graphNodeType ?? "unknown",
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    data: { ...(n.data?.raw ?? {}) },
  }));

  const outEdges: GraphEdgeJson[] = edges.map((e) => {
    const sh = flowConnectionHandle(e.sourceHandle, "out_default");
    const th = flowConnectionHandle(e.targetHandle, "in_default");
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: sh,
      targetHandle: th,
      condition: edgeLabelToCondition(e.label),
    };
  });

  const meta = base.meta ?? {};
  const schemaRaw = meta.schemaVersion ?? base.schemaVersion;
  const resolvedSv = coerceSchemaVersion(schemaRaw, 1);
  const metaGidRaw = meta.graphId ?? base.graphId;
  const metaGid =
    typeof metaGidRaw === "string"
      ? metaGidRaw.trim()
      : typeof metaGidRaw === "number" && Number.isFinite(metaGidRaw)
        ? String(metaGidRaw)
        : "";
  const topGidRaw = base.graphId;
  const topGid =
    typeof topGidRaw === "string"
      ? topGidRaw.trim()
      : typeof topGidRaw === "number" && Number.isFinite(topGidRaw)
        ? String(topGidRaw)
        : "";
  const graphId = metaGid || topGid || "default";
  return {
    schemaVersion: resolvedSv,
    meta: {
      schemaVersion: resolvedSv,
      graphId,
      ...(meta.title != null ? { title: meta.title } : {}),
      ...(meta.author != null ? { author: meta.author } : {}),
    },
    viewport: base.viewport ?? { x: 0, y: 0, zoom: 1 },
    nodes: outNodes,
    edges: outEdges,
  };
}
