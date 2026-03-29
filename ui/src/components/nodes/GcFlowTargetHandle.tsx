// Copyright GraphCaster. All Rights Reserved.

import { Handle, Position, useStore, type Node } from "@xyflow/react";
import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { isGcFlowConnectionAllowed } from "../../graph/connectionCompatibility";
import type { GcNodeData } from "../../graph/toReactFlow";
import type { GcConnectionDragOrigin } from "../GcConnectionDragContext";

type Props = {
  nodeId: string;
  drag: NonNullable<GcConnectionDragOrigin>;
};

/** Target handle that subscribes to the flow store only while a connection drag is active (parent switches from plain `Handle`). */
function GcFlowTargetHandleInner({ nodeId, drag }: Props) {
  const { t } = useTranslation();
  const allowed = useStore(
    useCallback(
      (s) =>
        isGcFlowConnectionAllowed(
          {
            source: drag.nodeId,
            target: nodeId,
            sourceHandle: drag.handleId,
            targetHandle: "in_default",
          },
          s.nodes as Node<GcNodeData>[],
          s.edges,
        ),
      [drag.nodeId, drag.handleId, nodeId],
    ),
  );
  const hint = allowed ? t("app.canvas.connectionDropTargetAllowed") : t("app.canvas.connectionDropTargetRejected");
  return (
    <Handle
      type="target"
      position={Position.Left}
      id="in_default"
      className={allowed ? "gc-handle--drop-allowed" : "gc-handle--drop-rejected"}
      title={hint}
      aria-label={hint}
    />
  );
}

export const GcFlowTargetHandle = memo(GcFlowTargetHandleInner);
GcFlowTargetHandle.displayName = "GcFlowTargetHandle";
