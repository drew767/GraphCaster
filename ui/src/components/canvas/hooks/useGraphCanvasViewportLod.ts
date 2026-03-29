// Copyright GraphCaster. All Rights Reserved.

import type { Node } from "@xyflow/react";
import { useStore } from "@xyflow/react";
import { useCallback, useMemo, useRef } from "react";

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
  const zoom = useStore((s) => s.transform[2]);
  const flowPane = useStore(
    useCallback(
      (s) => ({
        tx: s.transform[0],
        ty: s.transform[1],
        z: s.transform[2],
        width: s.width,
        height: s.height,
      }),
      [],
    ),
  );
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
      [flowPane.tx, flowPane.ty, flowPane.z],
      flowPane.width,
      flowPane.height,
      VIEWPORT_OFFSCREEN_PADDING_PX,
    );
  }, [
    ghostOffViewportEnabled,
    nodes,
    flowPane.tx,
    flowPane.ty,
    flowPane.z,
    flowPane.width,
    flowPane.height,
  ]);

  const viewportTierValue = useMemo(
    () => ({ ghostOffViewportEnabled, visibilityById }),
    [ghostOffViewportEnabled, visibilityById],
  );

  return { canvasLod, branchEdgeUiValue, viewportTierValue };
}
