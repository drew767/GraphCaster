// Copyright GraphCaster. All Rights Reserved.

import type { Node } from "@xyflow/react";

import { GRAPH_NODE_TYPE_COMMENT, GRAPH_NODE_TYPE_START } from "./nodeKinds";
import type { GcNodeData } from "./toReactFlow";

export const BULK_DUPLICATE_OFFSET = { x: 40, y: 40 } as const;
/** Padding around the bbox of selected nodes when wrapping them in a sticky frame. */
export const BULK_STICKY_PADDING_PX = 24;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** True when the node's raw payload carries `gcMuted: true`. */
export function isNodeMuted(node: Node<GcNodeData>): boolean {
  const raw = node.data?.raw;
  if (!isPlainRecord(raw)) {
    return false;
  }
  return raw.gcMuted === true;
}

/** True when EVERY id is currently muted. Empty list → false. */
export function selectionAllMuted(
  nodes: ReadonlyArray<Node<GcNodeData>>,
  ids: ReadonlySet<string>,
): boolean {
  let any = false;
  for (const n of nodes) {
    if (!ids.has(n.id)) {
      continue;
    }
    any = true;
    if (!isNodeMuted(n)) {
      return false;
    }
  }
  return any;
}

/**
 * Toggle `gcMuted` on every selected node in one batched update.
 * When at least one selected node is not muted → mute all; otherwise unmute all.
 */
export function applyToggleMuteOnSelection(
  nodes: ReadonlyArray<Node<GcNodeData>>,
  ids: ReadonlySet<string>,
): Node<GcNodeData>[] {
  if (ids.size === 0) {
    return nodes.slice();
  }
  const allMuted = selectionAllMuted(nodes, ids);
  const nextValue = !allMuted;
  return nodes.map((n) => {
    if (!ids.has(n.id)) {
      return n;
    }
    const rawBase = isPlainRecord(n.data?.raw) ? { ...n.data!.raw } : {};
    if (nextValue) {
      rawBase.gcMuted = true;
    } else {
      delete rawBase.gcMuted;
    }
    return {
      ...n,
      data: { ...(n.data as GcNodeData), raw: rawBase },
    };
  });
}

export type DuplicateSelectionDeps = {
  newNodeId: () => string;
};

export type DuplicatedNodeMapping = { sourceId: string; clonedId: string };

export type DuplicateSelectionResult = {
  nodes: Node<GcNodeData>[];
  mappings: DuplicatedNodeMapping[];
};

/**
 * Duplicate selected nodes with a fixed visual offset and mark the clones as the new selection.
 * Excludes the `start` node (it is unique per graph). Children whose parent is also selected
 * keep the cloned parent reference; children with an unselected parent are top-level clones
 * (parentId stripped). The clones replace any previous selection.
 */
export function applyDuplicateSelection(
  nodes: ReadonlyArray<Node<GcNodeData>>,
  ids: ReadonlySet<string>,
  deps: DuplicateSelectionDeps,
  offset: { x: number; y: number } = BULK_DUPLICATE_OFFSET,
): DuplicateSelectionResult {
  const eligible = nodes.filter(
    (n) => ids.has(n.id) && n.data?.graphNodeType !== GRAPH_NODE_TYPE_START,
  );
  if (eligible.length === 0) {
    return { nodes: nodes.slice(), mappings: [] };
  }
  const idMap = new Map<string, string>();
  for (const n of eligible) {
    idMap.set(n.id, deps.newNodeId());
  }
  const clones: Node<GcNodeData>[] = eligible.map((n) => {
    const newId = idMap.get(n.id)!;
    const rawClone = isPlainRecord(n.data?.raw) ? { ...n.data!.raw } : {};
    let parentId = n.parentId;
    if (typeof parentId === "string" && parentId !== "") {
      const np = idMap.get(parentId);
      parentId = np ?? undefined;
    }
    const next: Node<GcNodeData> = {
      ...n,
      id: newId,
      position: { x: n.position.x + offset.x, y: n.position.y + offset.y },
      selected: true,
      data: { ...(n.data as GcNodeData), raw: rawClone },
    };
    if (parentId == null || parentId === "") {
      delete (next as { parentId?: string }).parentId;
      delete (next as { extent?: unknown }).extent;
    } else {
      next.parentId = parentId;
    }
    return next;
  });
  const cleared = nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
  return {
    nodes: [...cleared, ...clones],
    mappings: eligible.map((n) => ({ sourceId: n.id, clonedId: idMap.get(n.id)! })),
  };
}

/** Axis-aligned bounding box around the absolute positions of the selected nodes. */
export function bulkSelectionBBox(
  nodes: ReadonlyArray<Node<GcNodeData>>,
  ids: ReadonlySet<string>,
): { x: number; y: number; width: number; height: number } | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let found = false;
  for (const n of nodes) {
    if (!ids.has(n.id)) {
      continue;
    }
    const w = typeof n.width === "number" ? n.width : 160;
    const h = typeof n.height === "number" ? n.height : 40;
    const x = n.position.x;
    const y = n.position.y;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x + w > maxX) maxX = x + w;
    if (y + h > maxY) maxY = y + h;
    found = true;
  }
  if (!found) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export type GroupIntoStickyDeps = {
  newNodeId: () => string;
};

/**
 * Wrap the current selection in a `comment` (sticky) frame placed behind them, sized to the
 * bbox of the selection plus a fixed padding. Returns the next nodes array, or null if the
 * selection cannot form a frame (no eligible nodes / empty bbox).
 */
export function applyGroupSelectionIntoSticky(
  nodes: ReadonlyArray<Node<GcNodeData>>,
  ids: ReadonlySet<string>,
  deps: GroupIntoStickyDeps,
  paddingPx: number = BULK_STICKY_PADDING_PX,
): Node<GcNodeData>[] | null {
  const bbox = bulkSelectionBBox(nodes, ids);
  if (!bbox) {
    return null;
  }
  const stickyId = deps.newNodeId();
  const width = Math.max(80, bbox.width + paddingPx * 2);
  const height = Math.max(60, bbox.height + paddingPx * 2);
  const sticky: Node<GcNodeData> = {
    id: stickyId,
    type: "gcComment",
    position: { x: bbox.x - paddingPx, y: bbox.y - paddingPx },
    zIndex: 0,
    data: {
      graphNodeType: GRAPH_NODE_TYPE_COMMENT,
      label: "",
      raw: { width, height },
    },
    style: { width, height, zIndex: 0 },
    connectable: false,
    selectable: true,
    draggable: true,
    focusable: true,
    selected: false,
  };
  return [sticky, ...nodes];
}
