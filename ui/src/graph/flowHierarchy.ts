// Copyright GraphCaster. All Rights Reserved.

import type { Node } from "@xyflow/react";

import type { GcNodeData } from "./toReactFlow";
import type { GraphNodeJson } from "./types";

const DEFAULT_COMMENT_W = 360;
const DEFAULT_COMMENT_H = 220;
const DEFAULT_NODE_W = 180;
const DEFAULT_NODE_H = 72;

export function commentSizeFromData(data: Record<string, unknown> | undefined): { w: number; h: number } {
  const wRaw = data?.width;
  const hRaw = data?.height;
  const w = typeof wRaw === "number" && Number.isFinite(wRaw) && wRaw > 0 ? wRaw : DEFAULT_COMMENT_W;
  const h = typeof hRaw === "number" && Number.isFinite(hRaw) && hRaw > 0 ? hRaw : DEFAULT_COMMENT_H;
  return { w, h };
}

export function getWorldTopLeft(n: Node, byId: Map<string, Node>): { x: number; y: number } {
  let x = n.position.x;
  let y = n.position.y;
  let pid: string | undefined = n.parentId ?? undefined;
  while (pid) {
    const p = byId.get(pid);
    if (!p) {
      break;
    }
    x += p.position.x;
    y += p.position.y;
    pid = p.parentId ?? undefined;
  }
  return { x, y };
}

export function getFlowNodeSize(n: Node): { w: number; h: number } {
  const mw = typeof n.measured?.width === "number" ? n.measured.width : undefined;
  const mh = typeof n.measured?.height === "number" ? n.measured.height : undefined;
  if (mw != null && mw > 0 && mh != null && mh > 0) {
    return { w: mw, h: mh };
  }
  const nw = typeof n.width === "number" ? n.width : undefined;
  const nh = typeof n.height === "number" ? n.height : undefined;
  if (nw != null && nw > 0 && nh != null && nh > 0) {
    return { w: nw, h: nh };
  }
  return { w: DEFAULT_NODE_W, h: DEFAULT_NODE_H };
}

export function getCommentNodeSize(n: Node<GcNodeData>): { w: number; h: number } {
  const raw = n.data?.raw ?? {};
  const fromData = commentSizeFromData(raw);
  const mw = typeof n.measured?.width === "number" && n.measured.width > 0 ? n.measured.width : undefined;
  const mh = typeof n.measured?.height === "number" && n.measured.height > 0 ? n.measured.height : undefined;
  if (mw != null && mh != null) {
    return { w: mw, h: mh };
  }
  const sw = n.style?.width;
  const sh = n.style?.height;
  const pw = typeof sw === "string" ? parseFloat(sw) : NaN;
  const ph = typeof sh === "string" ? parseFloat(sh) : NaN;
  if (Number.isFinite(pw) && pw > 0 && Number.isFinite(ph) && ph > 0) {
    return { w: pw, h: ph };
  }
  return fromData;
}

export function reparentDraggedNode(nodes: Node<GcNodeData>[], draggedId: string): Node<GcNodeData>[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const dragged = byId.get(draggedId);
  if (!dragged || dragged.type === "gcComment") {
    return nodes;
  }

  const worldPos = getWorldTopLeft(dragged, byId);
  const dims = getFlowNodeSize(dragged);
  const cx = worldPos.x + dims.w / 2;
  const cy = worldPos.y + dims.h / 2;

  const hitComments = nodes
    .filter((n) => n.type === "gcComment")
    .map((n) => {
      const p = getWorldTopLeft(n, byId);
      const s = getCommentNodeSize(n as Node<GcNodeData>);
      return { id: n.id, area: s.w * s.h, p, s };
    })
    .filter((box) => cx >= box.p.x && cx <= box.p.x + box.s.w && cy >= box.p.y && cy <= box.p.y + box.s.h)
    .sort((a, b) => a.area - b.area);

  const newParentId = hitComments[0]?.id;
  const curParent = dragged.parentId ?? undefined;

  if (newParentId === curParent) {
    return nodes;
  }

  return nodes.map((n) => {
    if (n.id !== draggedId) {
      return n;
    }
    if (newParentId) {
      const parentNode = byId.get(newParentId);
      if (!parentNode) {
        return n;
      }
      const pPos = getWorldTopLeft(parentNode, byId);
      return {
        ...n,
        parentId: newParentId,
        extent: "parent" as const,
        position: { x: worldPos.x - pPos.x, y: worldPos.y - pPos.y },
      };
    }
    const { parentId: _pid, extent: _ext, ...rest } = n;
    return { ...rest, position: { x: worldPos.x, y: worldPos.y } };
  });
}

export function absoluteJsonPosition(n: GraphNodeJson): { x: number; y: number } {
  return { x: n.position?.x ?? 0, y: n.position?.y ?? 0 };
}

export function pickCommentParentId(nodes: GraphNodeJson[], x: number, y: number): string | undefined {
  const candidates: { id: string; area: number }[] = [];
  for (const n of nodes) {
    if (n.type !== "comment") {
      continue;
    }
    const p = absoluteJsonPosition(n);
    const { w, h } = commentSizeFromData(n.data);
    if (x >= p.x && x <= p.x + w && y >= p.y && y <= p.y + h) {
      candidates.push({ id: n.id, area: w * h });
    }
  }
  if (candidates.length === 0) {
    return undefined;
  }
  candidates.sort((a, b) => a.area - b.area);
  return candidates[0]?.id;
}

export function sortNodesParentsFirst<T extends { id: string; parentId?: string | null }>(list: T[]): T[] {
  const idSet = new Set(list.map((n) => n.id));
  const memo = new Map<string, number>();
  const depth = (id: string): number => {
    const c = memo.get(id);
    if (c != null) {
      return c;
    }
    const node = list.find((n) => n.id === id);
    const pid = node?.parentId;
    if (!pid || !idSet.has(pid)) {
      memo.set(id, 0);
      return 0;
    }
    const d = 1 + depth(pid);
    memo.set(id, d);
    return d;
  };
  return [...list].sort((a, b) => depth(a.id) - depth(b.id));
}

export function sanitizeNodeParents(nodes: GraphNodeJson[]): GraphNodeJson[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return nodes.map((n) => {
    if (n.type === "comment") {
      if (n.parentId !== undefined) {
        const { parentId: _, ...rest } = n;
        return rest as GraphNodeJson;
      }
      return n;
    }
    const pid = n.parentId;
    if (typeof pid !== "string" || pid.trim() === "") {
      if (n.parentId !== undefined) {
        const { parentId: _, ...rest } = n;
        return rest as GraphNodeJson;
      }
      return n;
    }
    const parent = byId.get(pid.trim());
    if (!parent || parent.type !== "comment") {
      const { parentId: _, ...rest } = n;
      return rest as GraphNodeJson;
    }
    return { ...n, parentId: pid.trim() };
  });
}
