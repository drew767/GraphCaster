// Copyright GraphCaster. All Rights Reserved.

export type ViewportLike = { x: number; y: number; zoom: number };

const STORAGE_PREFIX = "gc.viewport.";

function storageKey(workflowId: string): string {
  return STORAGE_PREFIX + workflowId;
}

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadViewport(workflowId: string): ViewportLike | null {
  if (workflowId === "") {
    return null;
  }
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  let raw: string | null = null;
  try {
    raw = storage.getItem(storageKey(workflowId));
  } catch {
    return null;
  }
  if (raw == null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }
  const o = parsed as Record<string, unknown>;
  if (typeof o.x !== "number" || !Number.isFinite(o.x)) {
    return null;
  }
  if (typeof o.y !== "number" || !Number.isFinite(o.y)) {
    return null;
  }
  if (typeof o.zoom !== "number" || !Number.isFinite(o.zoom) || o.zoom <= 0) {
    return null;
  }
  return { x: o.x, y: o.y, zoom: o.zoom };
}

export function saveViewport(workflowId: string, viewport: ViewportLike): void {
  if (workflowId === "") {
    return;
  }
  const storage = getStorage();
  if (!storage) {
    return;
  }
  if (!Number.isFinite(viewport.x) || !Number.isFinite(viewport.y) || !Number.isFinite(viewport.zoom)) {
    return;
  }
  const payload = JSON.stringify({ x: viewport.x, y: viewport.y, zoom: viewport.zoom });
  try {
    storage.setItem(storageKey(workflowId), payload);
  } catch {
    /* quota exceeded or storage disabled — ignore */
  }
}

export function clearViewport(workflowId: string): void {
  if (workflowId === "") {
    return;
  }
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(storageKey(workflowId));
  } catch {
    /* ignore */
  }
}
