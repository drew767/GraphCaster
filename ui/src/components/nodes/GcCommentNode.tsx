// Copyright GraphCaster. All Rights Reserved.

import { NodeResizer, type NodeProps } from "@xyflow/react";
import { memo } from "react";

import type { GcNodeData } from "../../graph/toReactFlow";
import { useGcCanvasLod } from "../GcCanvasLodContext";

function GcCommentNodeInner(props: NodeProps) {
  const lod = useGcCanvasLod();
  const data = props.data as GcNodeData | undefined;
  const title = data?.label ?? props.id;
  const cls = `gc-flow-comment${props.selected ? " gc-flow-comment--selected" : ""}${lod === "compact" ? " gc-flow-comment--lod-compact" : ""}`;

  const showResizer = lod === "full" || props.selected;

  return (
    <div className={cls}>
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
