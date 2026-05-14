// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";

const EDGE_THRESHOLD_PX = 40;
const PAN_STEP_PX = 8;

export type AutoPanOptions = {
  /** Pixel distance from the viewport edge that triggers auto-pan. */
  edgeThreshold?: number;
  /** Pan velocity (CSS pixels per animation frame). */
  step?: number;
  /**
   * Returns the bounding rect of the canvas area; defaults to window viewport.
   * Pass a stable callback returning the React Flow wrapper rect for accurate edges.
   */
  getBounds?: () => { left: number; top: number; right: number; bottom: number } | null;
};

/**
 * UXP4 — auto-pan the canvas viewport while a connection wire is being dragged
 * and the pointer is near a viewport edge. Stops on connection end / pointerleave
 * from the edge zone.
 *
 * Returns nothing — purely attaches global listeners while a drag is in progress.
 */
export function useCanvasAutoPan(options: AutoPanOptions = {}): void {
  const { edgeThreshold = EDGE_THRESHOLD_PX, step = PAN_STEP_PX, getBounds } = options;

  const rf = useReactFlow();
  const [dragging, setDragging] = useState(false);

  const rfRef = useRef(rf);
  rfRef.current = rf;
  const getBoundsRef = useRef(getBounds);
  getBoundsRef.current = getBounds;

  // Listen for the start/end of a connection drag via xyflow's "connectstart" /
  // "connectend" pane events surfaced as DOM events on document.
  useEffect(() => {
    const onConnectStart = () => setDragging(true);
    const onConnectEnd = () => setDragging(false);
    window.addEventListener("gc:connect-start", onConnectStart);
    window.addEventListener("gc:connect-end", onConnectEnd);
    return () => {
      window.removeEventListener("gc:connect-start", onConnectStart);
      window.removeEventListener("gc:connect-end", onConnectEnd);
    };
  }, []);

  useEffect(() => {
    if (!dragging) return;

    let rafId: number | null = null;
    let dx = 0;
    let dy = 0;

    const tick = () => {
      rafId = null;
      if (dx === 0 && dy === 0) return;
      const api = rfRef.current;
      const vp = api.getViewport();
      api.setViewport({ x: vp.x + dx, y: vp.y + dy, zoom: vp.zoom });
      rafId = requestAnimationFrame(tick);
    };

    const computeDelta = (clientX: number, clientY: number) => {
      const boundsFn = getBoundsRef.current;
      let rect: { left: number; top: number; right: number; bottom: number } | null = null;
      if (boundsFn) {
        rect = boundsFn();
      }
      if (rect == null) {
        rect = {
          left: 0,
          top: 0,
          right: typeof window !== "undefined" ? window.innerWidth : 0,
          bottom: typeof window !== "undefined" ? window.innerHeight : 0,
        };
      }
      let nx = 0;
      let ny = 0;
      if (clientX < rect.left + edgeThreshold) {
        nx = +step;
      } else if (clientX > rect.right - edgeThreshold) {
        nx = -step;
      }
      if (clientY < rect.top + edgeThreshold) {
        ny = +step;
      } else if (clientY > rect.bottom - edgeThreshold) {
        ny = -step;
      }
      return { nx, ny };
    };

    const onPointerMove = (e: PointerEvent) => {
      const { nx, ny } = computeDelta(e.clientX, e.clientY);
      dx = nx;
      dy = ny;
      if ((dx !== 0 || dy !== 0) && rafId == null) {
        rafId = requestAnimationFrame(tick);
      }
      if (dx === 0 && dy === 0 && rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    };

    window.addEventListener("pointermove", onPointerMove);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      if (rafId != null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [dragging, edgeThreshold, step]);
}

/** Dispatches a window event used by `useCanvasAutoPan` to detect drag start/end. */
export function dispatchCanvasConnectStart(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("gc:connect-start"));
}

export function dispatchCanvasConnectEnd(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("gc:connect-end"));
}
