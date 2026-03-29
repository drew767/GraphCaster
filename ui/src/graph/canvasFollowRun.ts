// Copyright GraphCaster. All Rights Reserved.

/** Persisted toggle: pan viewport to the active run node (Comfy/n8n-style execution focus). */
export const FOLLOW_RUN_STORAGE_KEY = "gc-editor-follow-run";

export function readFollowRunPreference(): boolean {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(FOLLOW_RUN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeFollowRunPreference(enabled: boolean): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  try {
    if (enabled) {
      window.localStorage.setItem(FOLLOW_RUN_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(FOLLOW_RUN_STORAGE_KEY);
    }
  } catch {
    /* ignore quota / private mode */
  }
}
