// Copyright GraphCaster. All Rights Reserved.

import type { Node } from "@xyflow/react";

import { getFlowNodeSize, getWorldTopLeft } from "./flowHierarchy";
import { GRAPH_NODE_TYPE_GROUP, GRAPH_NODE_TYPE_START } from "./nodeKinds";
import { newGraphNodeId } from "./nodePalette";
import type { GcNodeData } from "./toReactFlow";

const DEFAULT_PADDING = 24;

function eligibleIdsForGroup(nodes: Node<GcNodeData>[], selectedIds: ReadonlySet<string>): Set<string> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const out = new Set<string>();
  for (const id of selectedIds) {
    const n = byId.get(id);
    if (!n || n.type !== "gcNode") {
      continue;
    }
    const d = n.data as GcNodeData | undefined;
    if (d?.graphNodeType === GRAPH_NODE_TYPE_START) {
      continue;
    }
    out.add(id);
  }
  return out;
}

export function computeGroupFrameBounds(
  nodes: Node<GcNodeData>[],
  selectedIds: ReadonlySet<string>,
  padding = DEFAULT_PADDING,
): { x: number; y: number; w: number; h: number } | null {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const eligible = eligibleIdsForGroup(nodes, selectedIds);
  if (eligible.size < 2) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of eligible) {
    const n = byId.get(id)!;
    const wp = getWorldTopLeft(n, byId);
    const { w, h } = getFlowNodeSize(n);
    minX = Math.min(minX, wp.x);
    minY = Math.min(minY, wp.y);
    maxX = Math.max(maxX, wp.x + w);
    maxY = Math.max(maxY, wp.y + h);
  }
  return {
    x: minX - padding,
    y: minY - padding,
    w: maxX - minX + 2 * padding,
    h: maxY - minY + 2 * padding,
  };
}

function commonFrameParentId(nodes: Node<GcNodeData>[], eligible: Set<string>): string | undefined {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let pid: string | undefined;
  for (const id of eligible) {
    const cur = byId.get(id)?.parentId ?? undefined;
    if (pid === undefined) {
      pid = cur;
    } else if (pid !== cur) {
      return undefined;
    }
  }
  return pid;
}

export function applyGroupSelection(
  nodes: Node<GcNodeData>[],
  selectedIds: ReadonlySet<string>,
  options?: { groupId?: string; padding?: number },
): { nodes: Node<GcNodeData>[]; groupId: string } | null {
  const padding = options?.padding ?? DEFAULT_PADDING;
  const eligible = eligibleIdsForGroup(nodes, selectedIds);
  if (eligible.size < 2) {
    return null;
  }
  const bbox = computeGroupFrameBounds(nodes, selectedIds, padding);
  if (!bbox) {
    return null;
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parentId = commonFrameParentId(nodes, eligible);
  const groupId = options?.groupId ?? `group-${newGraphNodeId().replace(/^n-/, "")}`;

  let groupPos = { x: bbox.x, y: bbox.y };
  if (parentId) {
    const p = byId.get(parentId);
    if (p) {
      const pAbs = getWorldTopLeft(p, byId);
      groupPos = { x: bbox.x - pAbs.x, y: bbox.y - pAbs.y };
    }
  }

  const groupNode: Node<GcNodeData> = {
    id: groupId,
    type: "gcGroup",
    position: groupPos,
    parentId,
    extent: parentId ? ("parent" as const) : undefined,
    zIndex: 0,
    data: {
      graphNodeType: GRAPH_NODE_TYPE_GROUP,
      label: "Group",
      raw: { title: "Group", width: bbox.w, height: bbox.h },
    },
    style: { width: bbox.w, height: bbox.h, zIndex: 0 },
    connectable: false,
    selectable: true,
    draggable: true,
    focusable: true,
  };

  const baseNodes = nodes.filter((n) => !eligible.has(n.id));
  const withGroup = [...baseNodes, groupNode];
  const mapAfter = new Map(withGroup.map((n) => [n.id, n]));
  const groupWorld = getWorldTopLeft(groupNode, mapAfter);

  const wrapped = [...eligible].map((id) => {
    const n = byId.get(id)!;
    const world = getWorldTopLeft(n, byId);
    return {
      ...n,
      parentId: groupId,
      extent: "parent" as const,
      position: { x: world.x - groupWorld.x, y: world.y - groupWorld.y },
    };
  });

  return { nodes: [...baseNodes, groupNode, ...wrapped], groupId };
}

export function canApplyGroupSelection(
  nodes: Node<GcNodeData>[],
  selectedIds: ReadonlySet<string>,
): boolean {
  return computeGroupFrameBounds(nodes, selectedIds) != null;
}

export function applyUngroupSelection(nodes: Node<GcNodeData>[], groupFlowId: string): Node<GcNodeData>[] | null {
  const gid = groupFlowId.trim();
  if (gid === "") {
    return null;
  }
  const group = nodes.find((n) => n.id === gid && n.type === "gcGroup");
  if (!group) {
    return null;
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const groupWorld = getWorldTopLeft(group, byId);
  const parentId = group.parentId ?? undefined;

  const withoutGroup = nodes.filter((n) => n.id !== gid);
  return withoutGroup.map((n) => {
    if (n.parentId !== gid) {
      return n;
    }
    const rel = n.position;
    const worldX = groupWorld.x + rel.x;
    const worldY = groupWorld.y + rel.y;
    if (parentId) {
      const p = byId.get(parentId);
      if (p) {
        const pWorld = getWorldTopLeft(p, byId);
        return {
          ...n,
          parentId,
          extent: "parent" as const,
          position: { x: worldX - pWorld.x, y: worldY - pWorld.y },
        };
      }
    }
    const { parentId: _p, extent: _e, ...rest } = n;
    return { ...rest, position: { x: worldX, y: worldY } } as Node<GcNodeData>;
  });
}
