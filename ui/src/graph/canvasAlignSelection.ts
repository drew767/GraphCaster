// Copyright GraphCaster. All Rights Reserved.

import type { Node } from "@xyflow/react";

import { getCommentNodeSize, getFlowNodeSize } from "./flowHierarchy";
import { isReactFlowFrameNodeType } from "./nodeKinds";
import type { GcNodeData } from "./toReactFlow";

export type AlignDistributeOp =
  | "align-left"
  | "align-right"
  | "align-top"
  | "align-bottom"
  | "align-h-center"
  | "align-v-center"
  | "distribute-h"
  | "distribute-v";

type Item = { id: string; x: number; y: number; w: number; h: number };

function gcNodeSize(n: Node<GcNodeData>): { w: number; h: number } {
  return isReactFlowFrameNodeType(n.type) ? getCommentNodeSize(n) : getFlowNodeSize(n);
}

export function partitionSelectedByParent(
  nodes: Node<GcNodeData>[],
  selectedIds: ReadonlySet<string>,
): Map<string, Node<GcNodeData>[]> {
  const m = new Map<string, Node<GcNodeData>[]>();
  for (const n of nodes) {
    if (!selectedIds.has(n.id)) {
      continue;
    }
    const key = n.parentId ?? "";
    const list = m.get(key);
    if (list) {
      list.push(n);
    } else {
      m.set(key, [n]);
    }
  }
  return m;
}

export function alignSelectionPossible(nodes: Node<GcNodeData>[], selectedIds: ReadonlySet<string>): boolean {
  for (const list of partitionSelectedByParent(nodes, selectedIds).values()) {
    if (list.length >= 2) {
      return true;
    }
  }
  return false;
}

export function distributeSelectionPossible(
  nodes: Node<GcNodeData>[],
  selectedIds: ReadonlySet<string>,
): boolean {
  for (const list of partitionSelectedByParent(nodes, selectedIds).values()) {
    if (list.length >= 3) {
      return true;
    }
  }
  return false;
}

function bucketNodeById(list: Node<GcNodeData>[]): Map<string, Node<GcNodeData>> {
  return new Map(list.map((n) => [n.id, n]));
}

function toItems(list: Node<GcNodeData>[]): Item[] {
  return list.map((n) => {
    const { w, h } = gcNodeSize(n);
    return { id: n.id, x: n.position.x, y: n.position.y, w, h };
  });
}

function isAlignOp(op: AlignDistributeOp): boolean {
  return op !== "distribute-h" && op !== "distribute-v";
}

function applyAlignToBucket(list: Node<GcNodeData>[], op: AlignDistributeOp): Map<string, { x: number; y: number }> {
  const byId = bucketNodeById(list);
  const items = toItems(list);
  const minL = Math.min(...items.map((i) => i.x));
  const maxR = Math.max(...items.map((i) => i.x + i.w));
  const minT = Math.min(...items.map((i) => i.y));
  const maxB = Math.max(...items.map((i) => i.y + i.h));
  const out = new Map<string, { x: number; y: number }>();

  for (const it of items) {
    const n = byId.get(it.id)!;
    let x = it.x;
    let y = it.y;
    switch (op) {
      case "align-left":
        x = minL;
        break;
      case "align-right":
        x = maxR - it.w;
        break;
      case "align-top":
        y = minT;
        break;
      case "align-bottom":
        y = maxB - it.h;
        break;
      case "align-h-center":
        x = (minL + maxR) / 2 - it.w / 2;
        break;
      case "align-v-center":
        y = (minT + maxB) / 2 - it.h / 2;
        break;
      default:
        break;
    }
    if (x !== n.position.x || y !== n.position.y) {
      out.set(it.id, { x, y });
    }
  }
  return out;
}

function applyDistributeHorizontal(list: Node<GcNodeData>[]): Map<string, { x: number; y: number }> {
  const byId = bucketNodeById(list);
  const items = toItems(list).sort((a, b) => a.x - b.x);
  const n = items.length;
  const L0 = items[0]!.x;
  const REnd = items[n - 1]!.x + items[n - 1]!.w;
  const sumW = items.reduce((s, i) => s + i.w, 0);
  const gap = (REnd - L0 - sumW) / (n - 1);
  const out = new Map<string, { x: number; y: number }>();
  let x = L0;
  for (let i = 0; i < n; i++) {
    const it = items[i]!;
    const node = byId.get(it.id)!;
    const nx = i === 0 ? L0 : x;
    if (nx !== node.position.x) {
      out.set(it.id, { x: nx, y: node.position.y });
    }
    x = nx + it.w + gap;
  }
  return out;
}

function applyDistributeVertical(list: Node<GcNodeData>[]): Map<string, { x: number; y: number }> {
  const byId = bucketNodeById(list);
  const items = toItems(list).sort((a, b) => a.y - b.y);
  const n = items.length;
  const T0 = items[0]!.y;
  const BEnd = items[n - 1]!.y + items[n - 1]!.h;
  const sumH = items.reduce((s, i) => s + i.h, 0);
  const gap = (BEnd - T0 - sumH) / (n - 1);
  const out = new Map<string, { x: number; y: number }>();
  let y = T0;
  for (let i = 0; i < n; i++) {
    const it = items[i]!;
    const node = byId.get(it.id)!;
    const ny = i === 0 ? T0 : y;
    if (ny !== node.position.y) {
      out.set(it.id, { x: node.position.x, y: ny });
    }
    y = ny + it.h + gap;
  }
  return out;
}

/**
 * Returns a new node array with updated positions, or **null** if no node moved.
 */
export function applyAlignDistribute(
  nodes: Node<GcNodeData>[],
  selectedIds: ReadonlySet<string>,
  op: AlignDistributeOp,
): Node<GcNodeData>[] | null {
  const deltas = new Map<string, { x: number; y: number }>();
  const partitions = partitionSelectedByParent(nodes, selectedIds);

  for (const list of partitions.values()) {
    if (isAlignOp(op)) {
      if (list.length < 2) {
        continue;
      }
      const part = applyAlignToBucket(list, op);
      for (const [id, pos] of part) {
        deltas.set(id, pos);
      }
    } else if (op === "distribute-h") {
      if (list.length < 3) {
        continue;
      }
      const part = applyDistributeHorizontal(list);
      for (const [id, pos] of part) {
        deltas.set(id, pos);
      }
    } else if (op === "distribute-v") {
      if (list.length < 3) {
        continue;
      }
      const part = applyDistributeVertical(list);
      for (const [id, pos] of part) {
        deltas.set(id, pos);
      }
    }
  }

  if (deltas.size === 0) {
    return null;
  }

  return nodes.map((n) => {
    const d = deltas.get(n.id);
    if (!d) {
      return n;
    }
    return { ...n, position: { x: d.x, y: d.y } };
  });
}
