// Copyright GraphCaster. All Rights Reserved.

/** Persisted toggle: show branch captions on edges (F4 / `ai_route`). Default **on** when unset. */
export const EDGE_LABELS_STORAGE_KEY = "gc-editor-edge-labels";

export function readEdgeLabelsEnabled(): boolean {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return true;
  }
  const v = window.localStorage.getItem(EDGE_LABELS_STORAGE_KEY);
  if (v === null) {
    return true;
  }
  return v === "1" || v === "true";
}

export function writeEdgeLabelsEnabled(enabled: boolean): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  window.localStorage.setItem(EDGE_LABELS_STORAGE_KEY, enabled ? "1" : "0");
}
