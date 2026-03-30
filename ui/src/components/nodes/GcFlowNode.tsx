// Copyright GraphCaster. All Rights Reserved.

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import type { GcNodeData } from "../../graph/toReactFlow";
import { useGcEffectiveNodeTier } from "../../graph/useGcEffectiveNodeTier";
import { useGcConnectionDrag } from "../GcConnectionDragContext";
import { GcFlowTargetHandle } from "./GcFlowTargetHandle";

function GcFlowNodeInner(props: NodeProps) {
  const { t } = useTranslation();
  const tier = useGcEffectiveNodeTier(props.id, props.selected);
  const data = props.data as GcNodeData | undefined;
  const kind = data?.graphNodeType ?? "unknown";
  const showTarget = kind !== "start";
  const showSource = kind !== "exit";
  const showErrorOut =
    showSource &&
    (kind === "task" ||
      kind === "graph_ref" ||
      kind === "mcp_tool" ||
      kind === "http_request" ||
      kind === "rag_query" ||
      kind === "delay" ||
      kind === "debounce" ||
      kind === "wait_for" ||
      kind === "python_code" ||
      kind === "llm_agent");
  const compactHandles = tier === "compact" || tier === "ghost";
  const cls = `gc-flow-node gc-flow-node--${kind}${props.selected ? " gc-flow-node--selected" : ""}${tier === "compact" ? " gc-flow-node--lod-compact" : ""}${tier === "ghost" ? " gc-flow-node--ghost" : ""}`;
  const raw = data?.raw;
  const pinOn =
    kind === "task" &&
    raw != null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    typeof (raw as { gcPin?: unknown }).gcPin === "object" &&
    (raw as { gcPin?: { enabled?: unknown } }).gcPin !== null &&
    (raw as { gcPin?: { enabled?: unknown } }).gcPin?.enabled === true;
  const stepCacheOn =
    (kind === "task" ||
      kind === "mcp_tool" ||
      kind === "http_request" ||
      kind === "rag_query" ||
      kind === "delay" ||
      kind === "debounce" ||
      kind === "wait_for" ||
      kind === "python_code" ||
      kind === "llm_agent" ||
      kind === "ai_route") &&
    raw != null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    (raw as { stepCache?: unknown }).stepCache === true;

  const overlayPhase = data?.runOverlayPhase;
  const overlayStatus =
    overlayPhase === "running" ||
    overlayPhase === "success" ||
    overlayPhase === "failed" ||
    overlayPhase === "skipped"
      ? t(`app.run.overlay.${overlayPhase}`)
      : undefined;
  const overlayAria =
    overlayStatus != null
      ? t("app.run.overlay.nodeAria", { label: data?.label ?? props.id, status: overlayStatus })
      : undefined;
  const label = data?.label ?? props.id;
  const compactAriaParts: string[] = [];
  if (tier !== "full" && pinOn) {
    compactAriaParts.push(t("app.canvas.lodAriaPinned"));
  }
  if (tier !== "full" && stepCacheOn) {
    compactAriaParts.push(t("app.canvas.lodAriaStepCache"));
  }
  if (tier === "ghost") {
    compactAriaParts.push(t("app.canvas.lodAriaGhostOffViewport"));
  }
  const compactAria =
    compactAriaParts.length > 0 ? `${compactAriaParts.join(". ")}.` : null;
  const connectionDrag = useGcConnectionDrag();
  let ariaLabel: string | undefined;
  if (overlayAria != null && compactAria != null) {
    ariaLabel = `${overlayAria} ${compactAria}`;
  } else if (overlayAria != null) {
    ariaLabel = overlayAria;
  } else if (compactAria != null) {
    ariaLabel = `${label}. ${compactAria}`;
  } else {
    ariaLabel = undefined;
  }

  return (
    <div className={cls} title={overlayStatus} aria-label={ariaLabel}>
      {showTarget ? (
        connectionDrag != null ? (
          <GcFlowTargetHandle nodeId={props.id} drag={connectionDrag} />
        ) : (
          <Handle type="target" position={Position.Left} id="in_default" />
        )
      ) : null}
      <div className="gc-flow-node__body">
        {tier === "full" ? (
          <span className="gc-flow-node__pillrow">
            <span className="gc-flow-node__pill">{kind}</span>
            {pinOn ? (
              <span className="gc-flow-node__pin" title={t("app.canvas.pinBadge")}>
                ●
              </span>
            ) : null}
            {stepCacheOn ? (
              <span className="gc-flow-node__stepcache" title={t("app.canvas.stepCacheBadge")}>
                C
              </span>
            ) : null}
          </span>
        ) : null}
        <span className="gc-flow-node__label">{data?.label ?? props.id}</span>
      </div>
      {showSource ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="out_default"
            style={showErrorOut ? { top: compactHandles ? "42%" : "38%" } : undefined}
          />
          {showErrorOut ? (
            <Handle
              type="source"
              position={Position.Right}
              id="out_error"
              style={{ top: compactHandles ? "58%" : "62%" }}
              className="gc-flow-node__handle--error"
              title={t("app.canvas.errorOutHandle")}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export const GcFlowNode = memo(GcFlowNodeInner);
GcFlowNode.displayName = "GcFlowNode";
