// Copyright GraphCaster. All Rights Reserved.

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";

function RerouteNodeInner(props: NodeProps) {
  return (
    <div
      className={`gc-reroute-node${props.selected ? " gc-reroute-node--selected" : ""}`}
      aria-label="Reroute"
    >
      <Handle type="target" position={Position.Left} id="in_default" />
      <Handle type="source" position={Position.Right} id="out_default" />
    </div>
  );
}

export const RerouteNode = memo(RerouteNodeInner);
RerouteNode.displayName = "RerouteNode";
