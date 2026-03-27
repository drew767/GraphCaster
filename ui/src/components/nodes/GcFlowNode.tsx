// Copyright GraphCaster. All Rights Reserved.

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { memo } from "react";
import { useTranslation } from "react-i18next";

import type { GcNodeData } from "../../graph/toReactFlow";

function GcFlowNodeInner(props: NodeProps) {
  const { t } = useTranslation();
  const data = props.data as GcNodeData | undefined;
  const kind = data?.graphNodeType ?? "unknown";
  const showTarget = kind !== "start";
  const showSource = kind !== "exit";
  const showErrorOut = showSource && (kind === "task" || kind === "graph_ref");
  const cls = `gc-flow-node gc-flow-node--${kind}${props.selected ? " gc-flow-node--selected" : ""}`;

  return (
    <div className={cls}>
      {showTarget ? <Handle type="target" position={Position.Left} id="in_default" /> : null}
      <div className="gc-flow-node__body">
        <span className="gc-flow-node__pill">{kind}</span>
        <span className="gc-flow-node__label">{data?.label ?? props.id}</span>
      </div>
      {showSource ? (
        <>
          <Handle
            type="source"
            position={Position.Right}
            id="out_default"
            style={showErrorOut ? { top: "38%" } : undefined}
          />
          {showErrorOut ? (
            <Handle
              type="source"
              position={Position.Right}
              id="out_error"
              style={{ top: "62%" }}
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
