// Copyright GraphCaster. All Rights Reserved.

import type { Edge, Node } from "@xyflow/react";

import { getCommentNodeSize, sanitizeNodeParents } from "./flowHierarchy";
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

function absoluteFlowPosition(n: Node<GcNodeData>, byId: Map<string, Node<GcNodeData>>): { x: number; y: number } {
  let x = n.position.x;
  let y = n.position.y;
  let pid: string | undefined = n.parentId ?? undefined;
  while (pid) {
    const p = byId.get(pid);
    if (!p) {
      break;
    }
    x += p.position.x;
    y += p.position.y;
    pid = p.parentId ?? undefined;
  }
  return { x, y };
}

export function flowToDocument(
  nodes: Node<GcNodeData>[],
  edges: Edge[],
  base: GraphDocumentJson,
): GraphDocumentJson {
  const typed = nodes as Node<GcNodeData>[];
  const byId = new Map(typed.map((n) => [n.id, n]));

  const outNodes: GraphNodeJson[] = typed.map((n) => {
    const abs = absoluteFlowPosition(n, byId);
    const rawBase = { ...(n.data?.raw ?? {}) };

    if (n.type === "gcComment") {
      const s = getCommentNodeSize(n);
      rawBase.width = s.w;
      rawBase.height = s.h;
      const hasTitle = typeof rawBase.title === "string" && rawBase.title.trim() !== "";
      if (!hasTitle && typeof n.data?.label === "string" && n.data.label.trim() !== "") {
        rawBase.title = n.data.label.trim();
      }
      const row: GraphNodeJson = {
        id: n.id,
        type: "comment",
        position: abs,
        data: rawBase,
      };
      return row;
    }

    const row: GraphNodeJson = {
      id: n.id,
      type: n.data?.graphNodeType ?? "unknown",
      position: abs,
      data: rawBase,
    };
    const pid = n.parentId;
    if (typeof pid === "string" && pid.trim() !== "") {
      row.parentId = pid.trim();
    }
    return row;
  });

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
  const nextMeta: GraphDocumentJson["meta"] = {
    ...meta,
    schemaVersion: resolvedSv,
    graphId,
  };
  const doc: GraphDocumentJson = {
    schemaVersion: resolvedSv,
    meta: nextMeta,
    viewport: base.viewport ?? { x: 0, y: 0, zoom: 1 },
    nodes: sanitizeNodeParents(outNodes),
    edges: outEdges,
    graphId,
  };
  if (base.inputs !== undefined) {
    doc.inputs = base.inputs;
  }
  if (base.outputs !== undefined) {
    doc.outputs = base.outputs;
  }
  return doc;
}
