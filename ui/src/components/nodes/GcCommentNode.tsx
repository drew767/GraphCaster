// Copyright GraphCaster. All Rights Reserved.

import { NodeResizer, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import type { GcNodeData } from "../../graph/toReactFlow";
import { useGcEffectiveNodeTier } from "../../graph/useGcEffectiveNodeTier";

function GcCommentNodeInner(props: NodeProps) {
  const { t } = useTranslation();
  const tier = useGcEffectiveNodeTier(props.id, props.selected);
  const data = props.data as GcNodeData | undefined;
  const title = data?.label ?? props.id;
  const cls = `gc-flow-comment${props.selected ? " gc-flow-comment--selected" : ""}${tier === "compact" ? " gc-flow-comment--lod-compact" : ""}${tier === "ghost" ? " gc-flow-comment--ghost" : ""}`;

  const showResizer = tier === "full" || props.selected;

  return (
    <div
      className={cls}
      aria-label={tier === "ghost" ? t("app.canvas.lodAriaGhostOffViewport") : undefined}
    >
      {showResizer ? (
        <NodeResizer
          minWidth={200}
          minHeight={120}
          lineClassName="gc-flow-comment-resize-line"
          handleClassName="gc-flow-comment-resize-handle"
        />
      ) : null}
      <div className="gc-flow-comment__title">{title}</div>
      <div className="gc-flow-comment__body" aria-hidden="true" />
    </div>
  );
}

export const GcCommentNode = memo(GcCommentNodeInner);
GcCommentNode.displayName = "GcCommentNode";
