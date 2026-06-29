// Copyright GraphCaster. All Rights Reserved.
// Authoritative source: schemas/graph-document.schema.json (v1.20)
//
// Single entry point for contract types in the UI. Import from
// `ui/src/contract` instead of `ui/src/graph/types` going forward.
// The legacy module re-exports continue to work until consumers migrate.

export const SCHEMA_VERSION = "v1.20" as const;
export const SCHEMA_PATH = "schemas/graph-document.schema.json" as const;

export type {
  ContractDocument,
  ContractEdge,
  ContractEdgeData,
  ContractMeta,
  ContractNode,
  ContractViewport,
} from "./document";
