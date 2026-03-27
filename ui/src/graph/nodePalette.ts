// Copyright GraphCaster. All Rights Reserved.

import {
  GRAPH_NODE_TYPE_COMMENT,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_GRAPH_REF,
  GRAPH_NODE_TYPE_TASK,
} from "./nodeKinds";

export function newGraphNodeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `n-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `n-${Date.now()}`;
}

export function newGraphEdgeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `e-${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `e-${Date.now()}`;
}

export function defaultDataForNodeType(type: string): Record<string, unknown> {
  switch (type) {
    case GRAPH_NODE_TYPE_GRAPH_REF:
      return { targetGraphId: "" };
    case GRAPH_NODE_TYPE_TASK:
      return { title: "Task" };
    case GRAPH_NODE_TYPE_EXIT:
      return { title: "Exit" };
    case GRAPH_NODE_TYPE_COMMENT:
      return { title: "Section", width: 360, height: 220 };
    default:
      return {};
  }
}
