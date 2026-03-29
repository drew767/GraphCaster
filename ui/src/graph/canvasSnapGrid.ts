// Copyright GraphCaster. All Rights Reserved.

/** Must match `<Background gap={…} />` and `snapGrid` on `<ReactFlow>`. */
export const CANVAS_GRID_STEP = 16;

export const SNAP_GRID_STORAGE_KEY = "gc-editor-snap-grid";

/** Default **false** so existing graphs keep free positioning until the user enables snap. */
export function readSnapGridEnabled(): boolean {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return false;
  }
  const v = window.localStorage.getItem(SNAP_GRID_STORAGE_KEY);
  if (v === null) {
    return false;
  }
  return v === "1" || v === "true";
}

export function writeSnapGridEnabled(enabled: boolean): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  window.localStorage.setItem(SNAP_GRID_STORAGE_KEY, enabled ? "1" : "0");
}
