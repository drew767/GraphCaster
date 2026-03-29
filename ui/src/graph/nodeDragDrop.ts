// Copyright Aura. All Rights Reserved.

import type { AddNodeMenuPick } from "./addNodeMenu";

/**
 * Custom MIME type for GraphCaster node drag events.
 * Using application/x- prefix for vendor-specific types.
 */
export const GC_DRAG_NODE_MIME_TYPE = "application/x-gc-node";

/**
 * Payload structure for dragged node data.
 * Matches AddNodeMenuPick from addNodeMenu.ts for consistency.
 */
export type NodeDragPayload = AddNodeMenuPick;

/**
 * Encode payload to JSON string for dataTransfer.setData().
 */
export function encodeNodeDragData(payload: NodeDragPayload): string {
  return JSON.stringify(payload);
}

/**
 * Decode JSON string from dataTransfer.getData().
 * Returns null if invalid or missing required fields.
 */
export function decodeNodeDragData(data: string): NodeDragPayload | null {
  try {
    const parsed = JSON.parse(data);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    if (!("kind" in parsed)) {
      return null;
    }
    const kind = parsed.kind;
    if (kind === "primitive" && typeof parsed.nodeType === "string") {
      return { kind: "primitive", nodeType: parsed.nodeType };
    }
    if (kind === "graph_ref" && typeof parsed.targetGraphId === "string") {
      return { kind: "graph_ref", targetGraphId: parsed.targetGraphId };
    }
    if (kind === "task_cursor_agent") {
      return { kind: "task_cursor_agent" };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a drag event contains GraphCaster node data.
 * Accepts native `DragEvent` or React's synthetic `DragEvent` (both expose `dataTransfer`).
 */
export function isGcNodeDragEvent(event: { dataTransfer: DataTransfer | null }): boolean {
  if (!event.dataTransfer) {
    return false;
  }
  return Array.from(event.dataTransfer.types).includes(GC_DRAG_NODE_MIME_TYPE);
}
