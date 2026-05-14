// Copyright GraphCaster. All Rights Reserved.

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  getSmoothStepPath,
  useInternalNode,
  useReactFlow,
  type EdgeProps,
} from "@xyflow/react";
import { memo, useCallback, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { edgeCanvasLabelText, flowEdgeLabelToCondition } from "../edgeCanvasLabel";
import { GRAPH_NODE_TYPE_AI_ROUTE } from "../nodeKinds";
import type { GcNodeData } from "../toReactFlow";
import { useGcBranchEdgeUi } from "../../components/edges/GcBranchEdgeUiContext";
import { useEdgeInsertStore } from "./edgeInsertStore";

export const EdgeWithPlus = memo(function EdgeWithPlus({
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
  selected,
}: EdgeProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const { setEdges } = useReactFlow();
  const requestInsert = useEdgeInsertStore((s) => s.requestInsert);

  const branchUi = useGcBranchEdgeUi();
  const showEdgeLabels = branchUi?.showEdgeLabels ?? true;
  const lodCompact = branchUi?.lodCompact ?? false;
  const sourceNode = useInternalNode(source);
  const sourceType = (sourceNode?.data as GcNodeData | undefined)?.graphNodeType;
  const sourceIsAiRoute = sourceType === GRAPH_NODE_TYPE_AI_ROUTE;

  const routeDescription =
    data != null &&
    typeof data === "object" &&
    !Array.isArray(data) &&
    typeof (data as { routeDescription?: unknown }).routeDescription === "string"
      ? (data as { routeDescription: string }).routeDescription
      : "";

  const pillText = edgeCanvasLabelText({
    condition: flowEdgeLabelToCondition(label),
    routeDescription,
    sourceIsAiRoute,
    branchFallbackLabel: t("app.canvas.edgeLabelAiRouteFallback", { defaultValue: "branch" }),
  });
  const showPill = showEdgeLabels && !lodCompact && pillText !== "";

  // Prefer smoothstep when source/target positions differ on Y; fall back to
  // bezier when collinear to match React Flow's default edge feel.
  const [edgePath, labelX, labelY] =
    sourceX === targetX || sourceY === targetY
      ? getBezierPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
        })
      : getSmoothStepPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
        });

  const onPlusClick = useCallback(
    (ev: MouseEvent<HTMLButtonElement>) => {
      ev.preventDefault();
      ev.stopPropagation();
      requestInsert(id, ev.clientX, ev.clientY);
    },
    [id, requestInsert],
  );

  const onDeleteClick = useCallback(
    (ev: MouseEvent<HTMLButtonElement>) => {
      ev.preventDefault();
      ev.stopPropagation();
      setEdges((edges) => edges.filter((e) => e.id !== id));
    },
    [id, setEdges],
  );

  const onEnter = useCallback(() => {
    setHovered(true);
  }, []);
  const onLeave = useCallback(() => {
    setHovered(false);
  }, []);

  const showControls = hovered || selected;

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
              transform: `translate(-50%, calc(-50% - 18px)) translate(${labelX}px, ${labelY}px)`,
            }}
          >
            <span className="gc-branch-edge__label">{pillText}</span>
          </div>
        </EdgeLabelRenderer>
      ) : null}
      <EdgeLabelRenderer>
        <div
          className="gc-edge-with-plus__hot"
          data-testid={`gc-edge-with-plus-${id}`}
          data-hovered={showControls ? "true" : "false"}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
        >
          {showControls ? (
            <>
              <button
                type="button"
                className="gc-edge-with-plus__delete nodrag nopan"
                aria-label={t("canvas.edge.deleteEdge")}
                title={t("canvas.edge.deleteEdge")}
                data-testid={`gc-edge-delete-${id}`}
                onClick={onDeleteClick}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                className="gc-edge-with-plus__plus nodrag nopan"
                aria-label={t("canvas.edge.insertNode")}
                title={t("canvas.edge.insertNode")}
                data-testid={`gc-edge-plus-${id}`}
                onClick={onPlusClick}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  aria-hidden="true"
                  focusable="false"
                >
                  <path
                    d="M7 2.5 L7 11.5 M2.5 7 L11.5 7"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
