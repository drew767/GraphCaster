// Copyright GraphCaster. All Rights Reserved.

export type GraphCanvasSelection =
  | {
      kind: "node";
      id: string;
      graphNodeType: string;
      label: string;
      raw: Record<string, unknown>;
    }
  | {
      kind: "multiNode";
      ids: string[];
      nodes: { id: string; graphNodeType: string; label: string }[];
    }
  | {
      kind: "edge";
      id: string;
      source: string;
      target: string;
      condition: string | null;
      routeDescription: string;
    };

/** @deprecated Prefer `GraphCanvasSelection` with `kind: "node"`. */
export type GraphNodeSelection = Extract<GraphCanvasSelection, { kind: "node" }>;
