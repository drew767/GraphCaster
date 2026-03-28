// Copyright GraphCaster. All Rights Reserved.

import type { Edge } from "@xyflow/react";

/** Deep-clone JSON trees with sorted object keys so `JSON.stringify` is order-invariant for plain objects. */
function sortJsonTree(v: unknown): unknown {
  if (v === null || typeof v !== "object") {
    return v;
  }
  if (Array.isArray(v)) {
    return v.map(sortJsonTree);
  }
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(o).sort()) {
    out[k] = sortJsonTree(o[k]);
  }
  return out;
}

function jsonSnapshotComparable(v: unknown): string {
  return JSON.stringify(sortJsonTree(v));
}

/**
 * True when document-driven RF edge fields match (excluding transient UI class names
 * such as warning/run highlights, which are layered in `mergeEdgeWarningHighlight`).
 */
export function gcFlowEdgeDocumentPayloadEqual(a: Edge, b: Edge): boolean {
  if (a.source !== b.source || a.target !== b.target) {
    return false;
  }
  if (a.sourceHandle !== b.sourceHandle) {
    return false;
  }
  if (a.targetHandle !== b.targetHandle) {
    return false;
  }
  if (a.type !== b.type) {
    return false;
  }
  if (Boolean(a.animated) !== Boolean(b.animated)) {
    return false;
  }
  if (Boolean(a.hidden) !== Boolean(b.hidden)) {
    return false;
  }
  if (a.label !== b.label) {
    return false;
  }
  if (jsonSnapshotComparable(a.data ?? null) !== jsonSnapshotComparable(b.data ?? null)) {
    return false;
  }
  if (jsonSnapshotComparable(a.style ?? null) !== jsonSnapshotComparable(b.style ?? null)) {
    return false;
  }
  return true;
}

/** Re-apply document edges while preserving React Flow interaction flags from the previous frame. */
export function gcFlowEdgesSyncKeepSelection(prev: Edge[], next: Edge[]): Edge[] {
  const prevById = new Map(prev.map((e) => [e.id, e]));
  return next.map((b) => {
    const p = prevById.get(b.id);
    if (p == null) {
      return b;
    }
    if (p.selected === b.selected && p.selectable === b.selectable) {
      return b;
    }
    return { ...b, selected: p.selected, selectable: p.selectable };
  });
}
