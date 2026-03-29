// Copyright GraphCaster. All Rights Reserved.

import type { Node } from "@xyflow/react";

import { getCommentNodeSize, getFlowNodeSize, getWorldTopLeft } from "./flowHierarchy";
import { isReactFlowFrameNodeType } from "./nodeKinds";
import type { GcCanvasLodLevel } from "./canvasLod";
import type { GcNodeData } from "./toReactFlow";

/** Padding in **screen px** expanded into flow coords as `paddingPx / zoom`. */
export const VIEWPORT_OFFSCREEN_PADDING_PX = 96;

export type FlowViewportRect = { minX: number; minY: number; maxX: number; maxY: number };

export type GcViewportNodeClass = "in" | "pad" | "off";

/**
 * Stable empty visibility map when off-viewport ghost is disabled.
 * Reuse this instead of `new Map()` so viewport context does not churn on pan/zoom.
 */
export const EMPTY_NODE_VISIBILITY_BY_ID: ReadonlyMap<string, GcViewportNodeClass> = new Map();

export type GcEffectiveNodeTier = "full" | "compact" | "ghost";

/**
 * Visible region in flow (world) coordinates from React Flow `transform` and pane size.
 * `transform` is `[tx, ty, zoom]` per @xyflow/react store.
 */
export function viewportInnerFromTransform(
  transform: readonly [number, number, number],
  width: number,
  height: number,
): FlowViewportRect | null {
  if (width <= 0 || height <= 0) {
    return null;
  }
  const [tx, ty, zoom] = transform;
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return null;
  }
  const rx = -tx / zoom;
  const ry = -ty / zoom;
  const minX = rx === 0 ? 0 : rx;
  const minY = ry === 0 ? 0 : ry;
  const maxX = minX + width / zoom;
  const maxY = minY + height / zoom;
  return { minX, minY, maxX, maxY };
}

export function expandViewport(vp: FlowViewportRect, paddingWorld: number): FlowViewportRect {
  const p = Number.isFinite(paddingWorld) && paddingWorld > 0 ? paddingWorld : 0;
  return {
    minX: vp.minX - p,
    minY: vp.minY - p,
    maxX: vp.maxX + p,
    maxY: vp.maxY + p,
  };
}

/** Axis-aligned rect as top-left + size (flow coords). */
export type NodeWorldRect = { x: number; y: number; w: number; h: number };

export function rectIntersectsViewport(node: NodeWorldRect, vp: FlowViewportRect): boolean {
  return !(node.x + node.w < vp.minX || node.x > vp.maxX || node.y + node.h < vp.minY || node.y > vp.maxY);
}

export function classifyVisibility(
  inner: FlowViewportRect,
  padded: FlowViewportRect,
  node: NodeWorldRect,
): GcViewportNodeClass {
  if (rectIntersectsViewport(node, inner)) {
    return "in";
  }
  if (rectIntersectsViewport(node, padded)) {
    return "pad";
  }
  return "off";
}

export function resolveEffectiveTier(
  lod: GcCanvasLodLevel,
  visibility: GcViewportNodeClass,
  opts: { ghostOffViewportEnabled: boolean; selected: boolean },
): GcEffectiveNodeTier {
  if (!opts.ghostOffViewportEnabled) {
    return lod;
  }
  if (opts.selected) {
    return lod;
  }
  if (visibility === "off") {
    return "ghost";
  }
  return lod;
}

function nodeWorldRect(n: Node, byId: Map<string, Node>): NodeWorldRect {
  const pos = getWorldTopLeft(n, byId);
  const dims = isReactFlowFrameNodeType(n.type)
    ? getCommentNodeSize(n as Node<GcNodeData>)
    : getFlowNodeSize(n);
  return { x: pos.x, y: pos.y, w: dims.w, h: dims.h };
}

export function computeVisibilityByNodeId(
  nodes: readonly Node[],
  transform: readonly [number, number, number],
  width: number,
  height: number,
  paddingPx: number,
): Map<string, GcViewportNodeClass> {
  const out = new Map<string, GcViewportNodeClass>();
  const inner = viewportInnerFromTransform(transform, width, height);
  if (!inner) {
    for (const n of nodes) {
      out.set(n.id, "in");
    }
    return out;
  }
  const zoom = transform[2];
  const padWorld = paddingPx / zoom;
  const padded = expandViewport(inner, padWorld);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const rect = nodeWorldRect(n, byId);
    out.set(n.id, classifyVisibility(inner, padded, rect));
  }
  return out;
}
