// Copyright GraphCaster. All Rights Reserved.

import type { Node } from "@xyflow/react";
import { useStore } from "@xyflow/react";
import { useMemo, useRef } from "react";

import { type GcCanvasLodLevel, lodLevelWithHysteresis } from "../../../graph/canvasLod";
import type { GcNodeData } from "../../../graph/toReactFlow";
import {
  computeVisibilityByNodeId,
  EMPTY_NODE_VISIBILITY_BY_ID,
  VIEWPORT_OFFSCREEN_PADDING_PX,
} from "../../../graph/viewportNodeTier";

export function useGraphCanvasViewportLod(
  nodes: Node<GcNodeData>[],
  ghostOffViewportEnabled: boolean,
  edgeLabelsEnabled: boolean,
): {
  canvasLod: GcCanvasLodLevel;
  branchEdgeUiValue: { showEdgeLabels: boolean; lodCompact: boolean };
  viewportTierValue: {
    ghostOffViewportEnabled: boolean;
    visibilityById: ReturnType<typeof computeVisibilityByNodeId> | typeof EMPTY_NODE_VISIBILITY_BY_ID;
  };
} {
  /*
   * CRITICAL: DO NOT use a single useStore selector that returns a new object!
   *
   * BAD (causes infinite re-render loop → black screen):
   *   const flowPane = useStore(s => ({ tx: s.transform[0], ty: s.transform[1], ... }));
   *
   * React Flow's useStore compares selector results with ===.
   * A selector returning a new object each call always fails equality,
   * triggering endless re-renders until React throws "Maximum update depth exceeded".
   *
   * GOOD: Use separate selectors returning primitive values (number, string, boolean).
   * Primitives are compared by value and won't cause spurious updates.
   */
  const zoom = useStore((s) => s.transform[2]);
  const tx = useStore((s) => s.transform[0]);
  const ty = useStore((s) => s.transform[1]);
  const width = useStore((s) => s.width);
  const height = useStore((s) => s.height);
  const lodStickyRef = useRef<GcCanvasLodLevel>("full");
  const canvasLod = (() => {
    const next = lodLevelWithHysteresis(zoom, lodStickyRef.current);
    lodStickyRef.current = next;
    return next;
  })();

  const branchEdgeUiValue = useMemo(
    () => ({
      showEdgeLabels: edgeLabelsEnabled,
      lodCompact: canvasLod === "compact",
    }),
    [edgeLabelsEnabled, canvasLod],
  );

  const visibilityById = useMemo(() => {
    if (!ghostOffViewportEnabled) {
      return EMPTY_NODE_VISIBILITY_BY_ID;
    }
    return computeVisibilityByNodeId(
      nodes,
      [tx, ty, zoom],
      width,
      height,
      VIEWPORT_OFFSCREEN_PADDING_PX,
    );
  }, [ghostOffViewportEnabled, nodes, tx, ty, zoom, width, height]);

  const viewportTierValue = useMemo(
    () => ({ ghostOffViewportEnabled, visibilityById }),
    [ghostOffViewportEnabled, visibilityById],
  );

  return { canvasLod, branchEdgeUiValue, viewportTierValue };
}
