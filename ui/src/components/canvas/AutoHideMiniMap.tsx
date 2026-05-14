// Copyright GraphCaster. All Rights Reserved.

import type { Node } from "@xyflow/react";
import { MiniMap, useStore } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";

import { minimapChromeForTheme } from "../../graph/minimapChrome";
import {
  minimapNodeColor,
  minimapNodeStroke,
  type MinimapRunStatus,
} from "../../graph/minimapNodeColors";
import type { GcNodeData } from "../../graph/toReactFlow";
import { usePrefersColorSchemeDark } from "../../lib/usePrefersColorSchemeDark";

const AUTO_HIDE_DELAY_MS = 1000;

/**
 * UX77 — Mini-map that auto-hides after 1s of viewport inactivity.
 *
 * Shows on any pan/zoom; smooth 300ms opacity transition.
 * Position: bottom-left (xyflow MiniMap default), 200×120px, theme-aware chrome.
 * Node colors use the existing `minimapNodeFill` / `minimapNodeStroke` SSOT.
 */
export function AutoHideMiniMap() {
  const [visible, setVisible] = useState(false);
  const hideTimerRef = useRef<number | null>(null);

  const tx = useStore((s) => s.transform[0]);
  const ty = useStore((s) => s.transform[1]);
  const zoom = useStore((s) => s.transform[2]);

  useEffect(() => {
    setVisible(true);
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
    }
    hideTimerRef.current = window.setTimeout(() => {
      setVisible(false);
      hideTimerRef.current = null;
    }, AUTO_HIDE_DELAY_MS);
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, [tx, ty, zoom]);

  const isDark = usePrefersColorSchemeDark();
  const chrome = minimapChromeForTheme(isDark);

  const nodeColor = (node: Node<GcNodeData>) => {
    const phase = node.data?.runOverlayPhase;
    const status: MinimapRunStatus | undefined =
      phase === "running"
        ? "running"
        : phase === "success"
          ? "success"
          : phase === "failed"
            ? "error"
            : phase === "skipped"
              ? "skipped"
              : undefined;
    return minimapNodeColor(node, status ? { [node.id]: status } : {});
  };
  const nodeStrokeColor = (node: Node<GcNodeData>) => minimapNodeStroke(node);

  return (
    <div
      className="gc-auto-minimap"
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 300ms ease",
        pointerEvents: visible ? undefined : "none",
      }}
      data-visible={visible}
    >
      <MiniMap
        pannable
        zoomable
        nodeStrokeWidth={3}
        style={{ width: 200, height: 120 }}
        bgColor={chrome.bgColor}
        maskColor={chrome.maskColor}
        maskStrokeColor={chrome.maskStrokeColor}
        maskStrokeWidth={chrome.maskStrokeWidth}
        nodeColor={nodeColor}
        nodeStrokeColor={nodeStrokeColor}
      />
    </div>
  );
}
