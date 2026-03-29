// Copyright GraphCaster. All Rights Reserved.

import type { GraphEdgeJson } from "./types";
import { coercePortKindOverride, type PortDataKind } from "./portDataKinds";

/** Partial update for `GraphEdgeJson.data`; use `null` for port keys to remove an override. */
export type EdgeDataPatch = {
  routeDescription?: string;
  sourcePortKind?: PortDataKind | null;
  targetPortKind?: PortDataKind | null;
};

function pickKnownEdgeData(prev: GraphEdgeJson["data"] | undefined): GraphEdgeJson["data"] {
  if (prev == null || typeof prev !== "object" || Array.isArray(prev)) {
    return {};
  }
  const o: GraphEdgeJson["data"] = {};
  if (typeof prev.routeDescription === "string") {
    o.routeDescription = prev.routeDescription;
  }
  const skPrev = coercePortKindOverride(prev.sourcePortKind);
  if (skPrev !== undefined) {
    o.sourcePortKind = skPrev;
  }
  const tkPrev = coercePortKindOverride(prev.targetPortKind);
  if (tkPrev !== undefined) {
    o.targetPortKind = tkPrev;
  }
  return o;
}

/**
 * Merge a patch into edge `data`. Only **`routeDescription`**, **`sourcePortKind`**, **`targetPortKind`**
 * are carried from `prev` (other keys on `prev` are ignored — same bucket as **`$defs.edgeData`** in schema).
 * Port kinds in patch and prev are validated via **`coercePortKindOverride`** (parity with Python).
 * Route description: empty string after trim removes the key.
 */
export function mergeGraphEdgeData(
  prev: GraphEdgeJson["data"] | undefined,
  patch: EdgeDataPatch,
): GraphEdgeJson["data"] | undefined {
  const next = { ...pickKnownEdgeData(prev) };

  if ("routeDescription" in patch) {
    const t = (patch.routeDescription ?? "").trim();
    if (t === "") {
      delete next.routeDescription;
    } else {
      next.routeDescription = t.slice(0, 1024);
    }
  }
  if ("sourcePortKind" in patch) {
    if (patch.sourcePortKind === null) {
      delete next.sourcePortKind;
    } else {
      const c = coercePortKindOverride(patch.sourcePortKind);
      if (c === undefined) {
        delete next.sourcePortKind;
      } else {
        next.sourcePortKind = c;
      }
    }
  }
  if ("targetPortKind" in patch) {
    if (patch.targetPortKind === null) {
      delete next.targetPortKind;
    } else {
      const c = coercePortKindOverride(patch.targetPortKind);
      if (c === undefined) {
        delete next.targetPortKind;
      } else {
        next.targetPortKind = c;
      }
    }
  }

  if (
    next.routeDescription === undefined &&
    next.sourcePortKind === undefined &&
    next.targetPortKind === undefined
  ) {
    return undefined;
  }
  const out: GraphEdgeJson["data"] = {};
  if (next.routeDescription !== undefined) {
    out.routeDescription = next.routeDescription;
  }
  if (next.sourcePortKind !== undefined) {
    out.sourcePortKind = next.sourcePortKind;
  }
  if (next.targetPortKind !== undefined) {
    out.targetPortKind = next.targetPortKind;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}
