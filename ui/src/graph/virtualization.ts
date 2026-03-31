// Copyright GraphCaster. All Rights Reserved.

/** Viewport in flow coordinates (XYFlow transform world space). */
export type FlowViewport = { x: number; y: number; zoom: number };

export type NodeLayout = {
  id: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
};

const DEFAULT_W = 200;
const DEFAULT_H = 80;

/**
 * Returns node ids whose bounding boxes intersect the viewport rect (with padding in flow pixels).
 * Used to skip rendering far-off nodes on large graphs (Phase 5.2 prep).
 */
export function visibleNodeIdsForViewport(
  nodes: readonly NodeLayout[],
  viewport: FlowViewport,
  viewWidthCssPx: number,
  viewHeightCssPx: number,
  paddingPx: number,
): Set<string> {
  const z = Math.max(0.05, viewport.zoom);
  const halfW = viewWidthCssPx / z / 2;
  const halfH = viewHeightCssPx / z / 2;
  const pad = paddingPx / z;
  const minX = viewport.x - halfW - pad;
  const maxX = viewport.x + halfW + pad;
  const minY = viewport.y - halfH - pad;
  const maxY = viewport.y + halfH + pad;
  const out = new Set<string>();
  for (const n of nodes) {
    const w = n.width ?? DEFAULT_W;
    const h = n.height ?? DEFAULT_H;
    const x1 = n.position.x;
    const y1 = n.position.y;
    const x2 = x1 + w;
    const y2 = y1 + h;
    if (x2 >= minX && x1 <= maxX && y2 >= minY && y1 <= maxY) {
      out.add(n.id);
    }
  }
  return out;
}
