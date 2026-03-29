// Copyright GraphCaster. All Rights Reserved.

import { NodeResizer, type NodeProps } from "@xyflow/react";
import { memo } from "react";

import type { GcNodeData } from "../../graph/toReactFlow";
import { useGcCanvasLod } from "../GcCanvasLodContext";

function GcGroupNodeInner(props: NodeProps) {
  const lod = useGcCanvasLod();
  const data = props.data as GcNodeData | undefined;
  const title = data?.label ?? props.id;
  const cls = `gc-flow-group${props.selected ? " gc-flow-group--selected" : ""}${lod === "compact" ? " gc-flow-group--lod-compact" : ""}`;

  const showResizer = lod === "full" || props.selected;

  return (
    <div className={cls}>
      {showResizer ? (
        <NodeResizer
          minWidth={200}
          minHeight={120}
          lineClassName="gc-flow-group-resize-line"
          handleClassName="gc-flow-group-resize-handle"
        />
      ) : null}
      <div className="gc-flow-group__title">{title}</div>
      <div className="gc-flow-group__body" aria-hidden="true" />
    </div>
  );
}

export const GcGroupNode = memo(GcGroupNodeInner);
GcGroupNode.displayName = "GcGroupNode";
