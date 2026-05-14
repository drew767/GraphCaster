// Copyright GraphCaster. All Rights Reserved.

/**
 * Unified node-types catalog (mirror of `schemas/node-types.json`).
 *
 * Single source of truth for UI <-> Python; drift is detected by
 * `python/tests/test_node_types_catalog.py` and
 * `ui/src/graph/nodeTypesCatalog.test.ts`.
 */

import rawCatalog from "@schemas/node-types.json";

export interface NodeTypeInfo {
  readonly type: string;
  readonly title: string;
  readonly category: string;
  readonly supportsStepCache: boolean;
  readonly isIdempotent: boolean;
  readonly implementedIn: readonly string[];
  readonly drift?: string;
}

interface CatalogShape {
  readonly version: number;
  readonly nodeTypes: readonly NodeTypeInfo[];
}

const CATALOG: CatalogShape = rawCatalog as unknown as CatalogShape;

const BY_TYPE: ReadonlyMap<string, NodeTypeInfo> = new Map(
  CATALOG.nodeTypes.map((entry) => [entry.type, entry] as const),
);

/** Return metadata for `type`, or `undefined` if not in the catalog. */
export function getNodeTypeInfo(type: string): NodeTypeInfo | undefined {
  return BY_TYPE.get(type);
}

/** Return every catalog entry in declared order. */
export function getAllNodeTypeInfos(): readonly NodeTypeInfo[] {
  return CATALOG.nodeTypes;
}

/** Return the catalog format version. */
export function getCatalogVersion(): number {
  return CATALOG.version;
}

/**
 * Return `true` when `type` is marked idempotent in the catalog.
 * Unknown types return `false` (safe default for replay guards).
 */
export function isIdempotent(type: string): boolean {
  const info = BY_TYPE.get(type);
  return Boolean(info && info.isIdempotent);
}

/**
 * Return `true` when `type` may be cached by the step-cache layer.
 * Unknown types return `false`.
 */
export function supportsStepCache(type: string): boolean {
  const info = BY_TYPE.get(type);
  return Boolean(info && info.supportsStepCache);
}
