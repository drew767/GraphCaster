// Copyright GraphCaster. All Rights Reserved.

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useInternalNode,
  type EdgeProps,
} from "@xyflow/react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import { edgeCanvasLabelText, flowEdgeLabelToCondition } from "../../graph/edgeCanvasLabel";
import { GRAPH_NODE_TYPE_AI_ROUTE } from "../../graph/nodeKinds";
import type { GcNodeData } from "../../graph/toReactFlow";
import { useGcBranchEdgeUi } from "./GcBranchEdgeUiContext";

export const GcBranchEdge = memo(function GcBranchEdge({
  id,
  source,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  data,
  style,
  markerEnd,
  markerStart,
  interactionWidth,
}: EdgeProps) {
  const { t } = useTranslation();
  const { showEdgeLabels, lodCompact } = useGcBranchEdgeUi();
  const sourceNode = useInternalNode(source);
  const sourceType = (sourceNode?.data as GcNodeData | undefined)?.graphNodeType;
  const sourceIsAiRoute = sourceType === GRAPH_NODE_TYPE_AI_ROUTE;

  const rd =
    data != null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    typeof (data as { routeDescription?: unknown }).routeDescription === "string"
      ? (data as { routeDescription: string }).routeDescription
      : "";

  const pillText = edgeCanvasLabelText({
    condition: flowEdgeLabelToCondition(label),
    routeDescription: rd,
    sourceIsAiRoute,
    branchFallbackLabel: t("app.canvas.edgeLabelAiRouteFallback"),
  });

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const showPill = showEdgeLabels && !lodCompact && pillText !== "";

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={style}
        markerEnd={markerEnd}
        markerStart={markerStart}
        interactionWidth={interactionWidth}
      />
      {showPill ? (
        <EdgeLabelRenderer>
          <div
            className="gc-branch-edge__label-outer nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            <span className="gc-branch-edge__label">{pillText}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
});
