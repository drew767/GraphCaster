// Copyright GraphCaster. All Rights Reserved.
// Authoritative source: schemas/graph-document.schema.json (v1.20)
//
// Hand-written mirror of the JSON Schema until scripts/codegen.sh (planned)
// runs json-schema-to-typescript. The schema is the single source of truth;
// drift between this file and the schema is a bug.
//
// Forward-compatibility: extra unknown fields are preserved via
// `[key: string]: unknown` index signatures, mirroring
// `additionalProperties: true` in the schema.
//
// These types are intentionally identical in shape to the legacy
// ui/src/graph/types.ts so consumers can migrate one import at a time.

export type ContractViewport = {
  x?: number;
  y?: number;
  zoom?: number;
  [key: string]: unknown;
};

export type ContractMeta = {
  schemaVersion?: number;
  graphId?: string;
  title?: string;
  author?: string;
  [key: string]: unknown;
};

export type ContractNode = {
  id: string;
  type: string;
  position?: { x?: number; y?: number; [key: string]: unknown };
  /** Optional parent frame (comment/group) id. */
  parentId?: string;
  data?: Record<string, unknown>;
  /**
   * Execution mode. Mirrors python contract.document.Node.mode:
   * "normal" | "bypass" | "mute" | "disabled" (or absent).
   */
  mode?: string;
};

export type ContractEdgeData = {
  routeDescription?: string;
  /** F18: optional override of effective port kind on source side. */
  sourcePortKind?: string;
  /** F18: optional override on target side. */
  targetPortKind?: string;
  [key: string]: unknown;
};

export type ContractEdge = {
  id: string;
  source: string;
  target: string;
  // camelCase is canonical. snake_case kept as forward-compat alias
  // until graphs/ are migrated to camelCase.
  sourceHandle?: string | null;
  targetHandle?: string | null;
  source_handle?: string | null;
  target_handle?: string | null;
  condition?: string | null;
  data?: ContractEdgeData;
};

export type ContractDocument = {
  schemaVersion?: number;
  /** Legacy: mirrors meta.graphId. */
  graphId?: string;
  meta?: ContractMeta;
  inputs?: unknown;
  outputs?: unknown;
  viewport?: ContractViewport;
  nodes?: ContractNode[];
  edges?: ContractEdge[];
  [key: string]: unknown;
};
