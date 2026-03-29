// Copyright GraphCaster. All Rights Reserved.

/** Persisted toggle: optional lighter node chrome fully outside the padded viewport (F1 performance). */
export const GHOST_OFFVIEWPORT_STORAGE_KEY = "gc-editor-ghost-offviewport";

export function readGhostOffViewportEnabled(): boolean {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return false;
  }
  const v = window.localStorage.getItem(GHOST_OFFVIEWPORT_STORAGE_KEY);
  if (v === null) {
    return false;
  }
  return v === "1" || v === "true";
}

export function writeGhostOffViewportEnabled(enabled: boolean): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  window.localStorage.setItem(GHOST_OFFVIEWPORT_STORAGE_KEY, enabled ? "1" : "0");
}
