// Copyright Aura. All Rights Reserved.

export const NODE_TYPE_ORDER = ["start", "exit", "task", "graph_ref"] as const;

export type PaletteNodeType = (typeof NODE_TYPE_ORDER)[number];

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
    case "graph_ref":
      return { targetGraphId: "" };
    case "task":
      return { title: "Task" };
    case "exit":
      return { title: "Exit" };
    default:
      return {};
  }
}
