// Copyright GraphCaster. All Rights Reserved.

/**
 * Port-kind compatibility matrix (F18). Keep in sync with `python/graph_caster/port_data_kinds.py`.
 */

import type { PortDataKind } from "./portDataKinds";

export type PortKindPairVerdict = "ok" | "warn" | "block";

/**
 * - `ok`: assignable without warning.
 * - `warn`: e.g. json↔primitive — editor/runner warn only; does not fail `validate_graph_structure`.
 * - `block`: reserved for future `PortDataKind` pairs; same non-blocking policy as `warn` until product ties it to hard validate.
 */
export function classifyPortKindPair(outKind: PortDataKind, inKind: PortDataKind): PortKindPairVerdict {
  if (outKind === "any" || inKind === "any") {
    return "ok";
  }
  if (outKind === inKind) {
    return "ok";
  }
  if (
    (outKind === "json" && inKind === "primitive") ||
    (outKind === "primitive" && inKind === "json")
  ) {
    return "warn";
  }
  return "block";
}
