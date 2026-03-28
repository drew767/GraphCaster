// Copyright GraphCaster. All Rights Reserved.

export type GraphNodeJson = {
  id: string;
  type: string;
  position?: { x?: number; y?: number };
  /** When set, this node is visually grouped inside a `comment` frame (`parentId` targets that frame). */
  parentId?: string;
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
  /** Optional per-edge metadata (e.g. routeDescription for ai_route branches). */
  data?: { routeDescription?: string };
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
    [key: string]: unknown;
  };
  /** Declared inputs when this graph is invoked (e.g. from a parent / nested call); JSON value. */
  inputs?: unknown;
  /** Declared outputs / result shape; JSON value. */
  outputs?: unknown;
  viewport?: { x?: number; y?: number; zoom?: number };
  nodes?: GraphNodeJson[];
  edges?: GraphEdgeJson[];
};

/** Inspector apply for document-level fields (no selection). */
export type GraphDocumentSettingsPatch = {
  title?: string;
  graphId?: string;
  author?: string;
  schemaVersion?: number;
  inputs?: unknown;
  outputs?: unknown;
};
