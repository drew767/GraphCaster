// Copyright GraphCaster. All Rights Reserved.

import type {
  Connection,
  Edge,
  Node,
  OnConnectEnd,
  OnConnectStart,
} from "@xyflow/react";
import { useCallback, type Dispatch, type SetStateAction } from "react";

import { isGcFlowConnectionAllowed } from "../../../graph/connectionCompatibility";
import { flowConnectionHandle } from "../../../graph/normalizeHandles";
import { newGraphEdgeId } from "../../../graph/nodePalette";
import type { GraphEdgeJson } from "../../../graph/types";
import type { GcNodeData } from "../../../graph/toReactFlow";
import type { GcConnectionDragOrigin } from "../../GcConnectionDragContext";

export type GcConnectDroppedOnPaneArgs = {
  screenX: number;
  screenY: number;
  sourceNodeId: string;
  sourceHandle: string;
};

export function useGraphCanvasConnections(options: {
  structureLocked: boolean;
  nodes: Node<GcNodeData>[];
  edges: Edge[];
  onConnectNewEdge: (edge: GraphEdgeJson) => void;
  setConnectionDrag: Dispatch<SetStateAction<GcConnectionDragOrigin>>;
  onConnectDroppedOnPane?: (args: GcConnectDroppedOnPaneArgs) => void;
}): {
  onConnectStart: OnConnectStart;
  onConnectEnd: OnConnectEnd;
  isValidConnection: (c: Connection | Edge) => boolean;
  onConnect: (c: Connection) => void;
} {
  const { structureLocked, nodes, edges, onConnectNewEdge, setConnectionDrag, onConnectDroppedOnPane } =
    options;

  const onConnectStart = useCallback<OnConnectStart>((_ev, { nodeId, handleId, handleType }) => {
    if (handleType === "source" && nodeId) {
      setConnectionDrag({
        nodeId,
        handleId: flowConnectionHandle(handleId, "out_default"),
      });
    } else {
      setConnectionDrag(null);
    }
  }, [setConnectionDrag]);

  const onConnectEnd = useCallback<OnConnectEnd>(
    (event, connectionState) => {
      setConnectionDrag(null);
      if (structureLocked || !onConnectDroppedOnPane) {
        return;
      }
      const st = connectionState as {
        fromNode?: Node<GcNodeData> | null;
        fromHandle?: { type?: string; id?: string | null } | null;
        toNode?: Node | null;
      };
      if (!st.fromNode || st.toNode != null) {
        return;
      }
      const fh = st.fromHandle;
      if (!fh || fh.type !== "source") {
        return;
      }
      let screenX: number;
      let screenY: number;
      if ("clientX" in event && typeof (event as MouseEvent).clientX === "number") {
        screenX = (event as MouseEvent).clientX;
        screenY = (event as MouseEvent).clientY;
      } else {
        const te = event as TouchEvent;
        const t0 = te.changedTouches?.[0];
        if (!t0) {
          return;
        }
        screenX = t0.clientX;
        screenY = t0.clientY;
      }
      onConnectDroppedOnPane({
        screenX,
        screenY,
        sourceNodeId: st.fromNode.id,
        sourceHandle: flowConnectionHandle(fh.id, "out_default"),
      });
    },
    [structureLocked, onConnectDroppedOnPane, setConnectionDrag],
  );

  const isValidConnection = useCallback(
    (c: Connection | Edge) => {
      if (structureLocked) {
        return false;
      }
      return isGcFlowConnectionAllowed(
        {
          source: c.source,
          target: c.target,
          sourceHandle: c.sourceHandle ?? null,
          targetHandle: c.targetHandle ?? null,
        },
        nodes,
        edges,
      );
    },
    [structureLocked, nodes, edges],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      if (structureLocked) {
        return;
      }
      if (!isGcFlowConnectionAllowed(c, nodes, edges)) {
        return;
      }
      const sh = flowConnectionHandle(c.sourceHandle, "out_default");
      const th = flowConnectionHandle(c.targetHandle, "in_default");
      onConnectNewEdge({
        id: newGraphEdgeId(),
        source: c.source!,
        target: c.target!,
        sourceHandle: sh,
        targetHandle: th,
        condition: null,
      });
    },
    [structureLocked, nodes, edges, onConnectNewEdge],
  );

  return { onConnectStart, onConnectEnd, isValidConnection, onConnect };
}
