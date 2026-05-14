// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useState } from "react";
import { useReactFlow, type Edge, type Node } from "@xyflow/react";

import { isTextEditingTarget } from "../../lib/isTextEditingTarget";
import type { GcNodeData } from "../toReactFlow";

const DEFAULT_NODE_WIDTH = 180;
const DEFAULT_NODE_GAP_X = 60;
const MAIN_OUT_HANDLE = "out_default";

export type NodeSearchHotkeyState = {
  open: boolean;
  anchor: { x: number; y: number };
  selectedNodeId: string | null;
};

export type NodeSearchHotkeyApi = {
  state: NodeSearchHotkeyState;
  close: () => void;
  /** Called by the popover when a node type is picked. */
  pickNodeType: (nodeType: string) => void;
};

export type UseCanvasNodeSearchHotkeyOptions = {
  /** Add a new node of `nodeType` to the right of `fromNodeId` and connect them. */
  onAddNodeToRight: (args: {
    fromNodeId: string;
    fromHandle: string;
    nodeType: string;
    position: { x: number; y: number };
  }) => void;
  /** When true, the hotkey is suppressed (active run). */
  disabled?: boolean;
};

/**
 * UXP5 — open NodeSearchPopover on the selected node when user presses Tab.
 * Requires exactly one selected node with no existing outgoing edge on its
 * main output handle. The popover anchors to the node's right edge in screen
 * coordinates.
 */
export function useCanvasNodeSearchHotkey(
  options: UseCanvasNodeSearchHotkeyOptions,
): NodeSearchHotkeyApi {
  const { onAddNodeToRight, disabled = false } = options;
  const { getNodes, getEdges, getViewport, flowToScreenPosition } = useReactFlow();

  const [state, setState] = useState<NodeSearchHotkeyState>({
    open: false,
    anchor: { x: 0, y: 0 },
    selectedNodeId: null,
  });

  const close = useCallback(() => {
    setState((prev) => (prev.open ? { ...prev, open: false } : prev));
  }, []);

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (isTextEditingTarget(e.target)) return;

      const nodes = getNodes() as Node<GcNodeData>[];
      const selected = nodes.filter((n) => n.selected);
      if (selected.length !== 1) return;
      const node = selected[0];

      const edges = getEdges() as Edge[];
      const hasOutgoingOnMain = edges.some(
        (ed) => ed.source === node.id && (ed.sourceHandle ?? MAIN_OUT_HANDLE) === MAIN_OUT_HANDLE,
      );
      if (hasOutgoingOnMain) return;

      e.preventDefault();

      // Anchor: node's right edge in screen coordinates.
      const w =
        typeof node.width === "number" && node.width > 0
          ? node.width
          : (typeof node.measured?.width === "number" ? node.measured.width : DEFAULT_NODE_WIDTH);
      const flowX = node.position.x + w;
      const flowY = node.position.y;
      let anchor: { x: number; y: number };
      if (typeof flowToScreenPosition === "function") {
        anchor = flowToScreenPosition({ x: flowX, y: flowY });
      } else {
        const vp = getViewport();
        anchor = {
          x: flowX * vp.zoom + vp.x,
          y: flowY * vp.zoom + vp.y,
        };
      }

      setState({
        open: true,
        anchor,
        selectedNodeId: node.id,
      });
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [disabled, getNodes, getEdges, getViewport, flowToScreenPosition]);

  const pickNodeType = useCallback(
    (nodeType: string) => {
      const id = state.selectedNodeId;
      if (id == null) return;
      const nodes = getNodes() as Node<GcNodeData>[];
      const source = nodes.find((n) => n.id === id);
      if (!source) return;
      const w =
        typeof source.width === "number" && source.width > 0
          ? source.width
          : (typeof source.measured?.width === "number"
              ? source.measured.width
              : DEFAULT_NODE_WIDTH);
      const position = {
        x: source.position.x + w + DEFAULT_NODE_GAP_X,
        y: source.position.y,
      };
      onAddNodeToRight({
        fromNodeId: id,
        fromHandle: MAIN_OUT_HANDLE,
        nodeType,
        position,
      });
      setState({ open: false, anchor: { x: 0, y: 0 }, selectedNodeId: null });
    },
    [getNodes, onAddNodeToRight, state.selectedNodeId],
  );

  return { state, close, pickNodeType };
}
