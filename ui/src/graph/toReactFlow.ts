// Copyright GraphCaster. All Rights Reserved.

import type { Edge, Node } from "@xyflow/react";

import {
  absoluteJsonPosition,
  commentSizeFromData,
  sanitizeNodeParents,
  sortNodesParentsFirst,
} from "./flowHierarchy";
import { GRAPH_NODE_TYPE_COMMENT, GRAPH_NODE_TYPE_START } from "./nodeKinds";
import { normalizeEdgeHandleValue, pickEdgeHandleRaw } from "./normalizeHandles";
import type { GraphDocumentJson, GraphEdgeJson } from "./types";
import type { NodeRunPhase } from "../run/nodeRunOverlay";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export type GcNodeData = {
  graphNodeType: string;
  label: string;
  raw: Record<string, unknown>;
  runOverlayPhase?: NodeRunPhase | null;
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
  const rawNodes = sanitizeNodeParents(doc.nodes ?? []);
  const rawEdges = doc.edges ?? [];

  const byJsonId = new Map(rawNodes.map((n) => [n.id, n]));

  const flowNodesUnsorted: Node<GcNodeData>[] = rawNodes.map((n) => {
    const data = n.data ?? {};
    const graphNodeType = typeof n.type === "string" && n.type.length > 0 ? n.type : "unknown";

    if (graphNodeType === GRAPH_NODE_TYPE_COMMENT) {
      const { w, h } = commentSizeFromData(data);
      const pos = absoluteJsonPosition(n);
      return {
        id: n.id,
        type: "gcComment",
        position: pos,
        zIndex: 0,
        data: {
          graphNodeType: GRAPH_NODE_TYPE_COMMENT,
          label: nodeLabel(data, n.id),
          raw: { ...data },
        },
        style: { width: w, height: h, zIndex: 0 },
        connectable: false,
        selectable: true,
        draggable: true,
        focusable: true,
      };
    }

    const abs = absoluteJsonPosition(n);
    const pidRaw = n.parentId;
    const pid = typeof pidRaw === "string" && pidRaw.trim() !== "" ? pidRaw.trim() : undefined;
    const parentJson = pid ? byJsonId.get(pid) : undefined;
    const parentId =
      pid && parentJson?.type === GRAPH_NODE_TYPE_COMMENT ? pid : undefined;
    const pAbs = parentId ? absoluteJsonPosition(parentJson!) : null;
    const position =
      parentId && pAbs
        ? { x: abs.x - pAbs.x, y: abs.y - pAbs.y }
        : { x: abs.x, y: abs.y };

    return {
      id: n.id,
      type: "gcNode",
      position,
      parentId,
      extent: parentId ? ("parent" as const) : undefined,
      zIndex: 1,
      deletable: graphNodeType !== GRAPH_NODE_TYPE_START,
      data: {
        graphNodeType,
        label: nodeLabel(data, n.id),
        raw: { ...data },
      },
    };
  });

  const nodes = sortNodesParentsFirst(flowNodesUnsorted);

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
    const er = e as GraphEdgeJson;
    if (isPlainRecord(er.data) && typeof er.data.routeDescription === "string") {
      edge.data = { routeDescription: er.data.routeDescription };
    }
    return edge;
  });

  return { nodes, edges };
}
