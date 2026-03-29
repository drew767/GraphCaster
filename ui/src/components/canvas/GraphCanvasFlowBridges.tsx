// Copyright GraphCaster. All Rights Reserved.

import type { Node } from "@xyflow/react";
import { useReactFlow } from "@xyflow/react";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type MutableRefObject,
} from "react";

import {
  effectiveFollowRunCameraPanAnimated,
  type RunMotionPreference,
} from "../../graph/canvasRunMotion";
import { flowToDocument } from "../../graph/fromReactFlow";
import {
  getCommentNodeSize,
  getFlowNodeSize,
  getWorldTopLeft,
} from "../../graph/flowHierarchy";
import { sanitizeGraphConnectivity } from "../../graph/sanitize";
import type { GraphDocumentJson } from "../../graph/types";
import { isReactFlowFrameNodeType } from "../../graph/nodeKinds";
import type { GcNodeData } from "../../graph/toReactFlow";
import { usePrefersReducedMotion } from "../../lib/usePrefersReducedMotion";

import type { ExportDocumentOptions, GraphCanvasHandle } from "./graphCanvasHandleTypes";

export type FlowCanvasHandleBridgeProps = {
  baseDocument: GraphDocumentJson;
  onExportRemovedDanglingEdges?: (removedEdgeIds: string[]) => void;
  removeNodesByIdRef: MutableRefObject<(ids: readonly string[]) => void>;
};

export const FlowCanvasHandleBridge = forwardRef<GraphCanvasHandle, FlowCanvasHandleBridgeProps>(
  function FlowCanvasHandleBridge(
    { baseDocument, onExportRemovedDanglingEdges, removeNodesByIdRef },
    ref,
  ) {
    const { getNodes, getEdges, getNode, fitView } = useReactFlow();
    useImperativeHandle(
      ref,
      () => ({
        exportDocument(options?: ExportDocumentOptions) {
          const doc = flowToDocument(getNodes() as Node<GcNodeData>[], getEdges(), baseDocument);
          const { document, removedEdgeIds } = sanitizeGraphConnectivity(doc);
          const notify = options?.notifyRemovedDanglingEdges !== false;
          if (removedEdgeIds.length > 0 && notify) {
            onExportRemovedDanglingEdges?.(removedEdgeIds);
          }
          return document;
        },
        focusNode(nodeId: string) {
          const id = nodeId.trim();
          if (id === "") {
            return;
          }
          const n = getNode(id);
          if (!n) {
            return;
          }
          void fitView({
            nodes: [{ id }],
            padding: 0.28,
            duration: 220,
            minZoom: 0.12,
            maxZoom: 1.85,
          });
        },
        removeNodesById(ids: readonly string[]) {
          removeNodesByIdRef.current(ids);
        },
      }),
      [getNodes, getEdges, getNode, fitView, baseDocument, onExportRemovedDanglingEdges, removeNodesByIdRef],
    );
    return null;
  },
);

export function FlowProjectionBridge({
  projectRef,
}: {
  projectRef: MutableRefObject<((clientX: number, clientY: number) => { x: number; y: number }) | null>;
}) {
  const rf = useReactFlow();
  useLayoutEffect(() => {
    projectRef.current = (clientX, clientY) => rf.screenToFlowPosition({ x: clientX, y: clientY });
    return () => {
      projectRef.current = null;
    };
  }, [rf, projectRef]);
  return null;
}

export function RefitOnLayoutEpoch({ epoch }: { epoch: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    if (epoch <= 0) {
      return;
    }
    const handle = requestAnimationFrame(() => {
      void fitView({ padding: 0.15, duration: 200 });
    });
    return () => {
      cancelAnimationFrame(handle);
    };
  }, [epoch, fitView]);
  return null;
}

const FOLLOW_RUN_CAMERA_DEBOUNCE_MS = 85;
const FOLLOW_RUN_AFTER_REFIT_MS = 220;

export function FollowActiveRunCamera({
  runHighlightNodeId,
  followEnabled,
  followActive,
  runMotionPreference,
  layoutEpoch,
}: {
  runHighlightNodeId: string | null;
  followEnabled: boolean;
  followActive: boolean;
  runMotionPreference: RunMotionPreference;
  layoutEpoch: number;
}) {
  const { getNodes, getNode, setCenter, getViewport } = useReactFlow();
  const prefersReduced = usePrefersReducedMotion();
  const layoutEpochRef = useRef(layoutEpoch);

  useEffect(() => {
    if (!followEnabled || !followActive) {
      return;
    }
    const id = runHighlightNodeId?.trim() ?? "";
    if (id === "") {
      return;
    }

    const prevEpoch = layoutEpochRef.current;
    layoutEpochRef.current = layoutEpoch;
    const epochBumped = prevEpoch !== layoutEpoch && layoutEpoch > 0;
    const delay = epochBumped
      ? FOLLOW_RUN_CAMERA_DEBOUNCE_MS + FOLLOW_RUN_AFTER_REFIT_MS
      : FOLLOW_RUN_CAMERA_DEBOUNCE_MS;

    const handle = window.setTimeout(() => {
      const n = getNode(id);
      if (!n) {
        if (import.meta.env.DEV) {
          console.debug("[gc-follow-run] node not on canvas", id);
        }
        return;
      }
      const all = getNodes();
      const byId = new Map(all.map((x) => [x.id, x]));
      const topLeft = getWorldTopLeft(n as Node<GcNodeData>, byId);
      const dims = isReactFlowFrameNodeType(n.type)
        ? getCommentNodeSize(n as Node<GcNodeData>)
        : getFlowNodeSize(n);
      const x = topLeft.x + dims.w / 2;
      const y = topLeft.y + dims.h / 2;
      const zoom = getViewport().zoom;
      const animate = effectiveFollowRunCameraPanAnimated(runMotionPreference, prefersReduced);
      void setCenter(x, y, {
        zoom,
        duration: animate ? 220 : 0,
      });
    }, delay);

    return () => {
      window.clearTimeout(handle);
    };
  }, [
    runHighlightNodeId,
    followEnabled,
    followActive,
    runMotionPreference,
    layoutEpoch,
    getNode,
    getNodes,
    setCenter,
    getViewport,
    prefersReduced,
  ]);

  return null;
}
