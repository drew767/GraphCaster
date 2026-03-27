// Copyright Aura. All Rights Reserved.

import type { Edge, Node } from "@xyflow/react";

import { normalizeEdgeHandleValue, pickEdgeHandleRaw } from "./normalizeHandles";
import type { GraphDocumentJson, GraphEdgeJson } from "./types";

export type GcNodeData = {
  graphNodeType: string;
  label: string;
  raw: Record<string, unknown>;
};

export function nodeLabel(data: Record<string, unknown> | undefined, fallbackId: string): string {
  const title = data?.title;
  if (typeof title === "string" && title.trim() !== "") {
    return title;
  }
  return fallbackId;
}

function edgeHandles(e: GraphEdgeJson): { sourceHandle: string; targetHandle: string } {
  const er = e as Record<string, unknown>;
  const shRaw = pickEdgeHandleRaw(er, "sourceHandle", "source_handle");
  const thRaw = pickEdgeHandleRaw(er, "targetHandle", "target_handle");
  return {
    sourceHandle: normalizeEdgeHandleValue(shRaw, "out_default"),
    targetHandle: normalizeEdgeHandleValue(thRaw, "in_default"),
  };
}

export function graphDocumentToFlow(doc: GraphDocumentJson): { nodes: Node<GcNodeData>[]; edges: Edge[] } {
  const rawNodes = doc.nodes ?? [];
  const rawEdges = doc.edges ?? [];

  const nodes: Node<GcNodeData>[] = rawNodes.map((n) => {
    const data = n.data ?? {};
    const graphNodeType = typeof n.type === "string" && n.type.length > 0 ? n.type : "unknown";
    return {
      id: n.id,
      type: "gcNode",
      position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
      data: {
        graphNodeType,
        label: nodeLabel(data, n.id),
        raw: { ...data },
      },
    };
  });

  const edges: Edge[] = rawEdges.map((e) => {
    const { sourceHandle, targetHandle } = edgeHandles(e);
    const edge: Edge = {
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle,
      targetHandle,
    };
    if (e.condition != null && String(e.condition).trim() !== "") {
      edge.label = String(e.condition);
    }
    return edge;
  });

  return { nodes, edges };
}
