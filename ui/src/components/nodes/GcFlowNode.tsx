// Copyright Aura. All Rights Reserved.

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";

import type { GcNodeData } from "../../graph/toReactFlow";

function GcFlowNodeInner(props: NodeProps) {
  const data = props.data as GcNodeData | undefined;
  const kind = data?.graphNodeType ?? "unknown";
  const showTarget = kind !== "start";
  const showSource = kind !== "exit";

  return (
    <div className={`gc-flow-node gc-flow-node--${kind}`}>
      {showTarget ? <Handle type="target" position={Position.Left} id="in_default" /> : null}
      <div className="gc-flow-node__body">
        <span className="gc-flow-node__pill">{kind}</span>
        <span className="gc-flow-node__label">{data?.label ?? props.id}</span>
      </div>
      {showSource ? <Handle type="source" position={Position.Right} id="out_default" /> : null}
    </div>
  );
}

export const GcFlowNode = memo(GcFlowNodeInner);
GcFlowNode.displayName = "GcFlowNode";
