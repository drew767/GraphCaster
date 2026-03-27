// Copyright Aura. All Rights Reserved.

export type GraphNodeJson = {
  id: string;
  type: string;
  position?: { x?: number; y?: number };
  data?: Record<string, unknown>;
};

export type GraphEdgeJson = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  source_handle?: string | null;
  targetHandle?: string | null;
  target_handle?: string | null;
  condition?: string | null;
};

export type GraphDocumentJson = {
  schemaVersion?: number;
  /** Mirrors Python `raw.graphId`; canonical place is `meta.graphId`. */
  graphId?: string;
  meta?: {
    schemaVersion?: number;
    graphId?: string;
    title?: string;
    author?: string;
  };
  viewport?: { x?: number; y?: number; zoom?: number };
  nodes?: GraphNodeJson[];
  edges?: GraphEdgeJson[];
};
