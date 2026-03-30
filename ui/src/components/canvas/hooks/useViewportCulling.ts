// Copyright GraphCaster. All Rights Reserved.

import { useMemo } from "react";
import type { Node } from "@xyflow/react";

export type CullingViewport = {
  x: number;
  y: number;
  zoom: number;
  width: number;
  height: number;
};

export interface ViewportCullingOptions {
  padding?: number;
  nodeWidth?: number;
  nodeHeight?: number;
}

export interface ViewportCullingResult {
  visibleNodes: Node[];
  visibleNodeIds: Set<string>;
  totalCount: number;
  visibleCount: number;
}

export function useViewportCulling(
  nodes: Node[],
  viewport: CullingViewport,
  options: ViewportCullingOptions = {},
): ViewportCullingResult {
  const {
    padding = 100,
    nodeWidth = 200,
    nodeHeight = 100,
  } = options;

  return useMemo(() => {
    const scale = viewport.zoom || 1;
    const viewportLeft = -viewport.x / scale - padding;
    const viewportTop = -viewport.y / scale - padding;
    const viewportRight = viewportLeft + (viewport.width || 800) / scale + padding * 2;
    const viewportBottom = viewportTop + (viewport.height || 600) / scale + padding * 2;

    const visibleNodes: Node[] = [];
    const visibleNodeIds = new Set<string>();

    for (const node of nodes) {
      const { x, y } = node.position;
      const width = (typeof node.width === "number" ? node.width : nodeWidth) || nodeWidth;
      const height = (typeof node.height === "number" ? node.height : nodeHeight) || nodeHeight;

      const nodeRight = x + width;
      const nodeBottom = y + height;

      if (
        nodeRight >= viewportLeft &&
        x <= viewportRight &&
        nodeBottom >= viewportTop &&
        y <= viewportBottom
      ) {
        visibleNodes.push(node);
        visibleNodeIds.add(node.id);
      }
    }

    return {
      visibleNodes,
      visibleNodeIds,
      totalCount: nodes.length,
      visibleCount: visibleNodes.length,
    };
  }, [nodes, viewport.x, viewport.y, viewport.zoom, viewport.width, viewport.height, padding, nodeWidth, nodeHeight]);
}
