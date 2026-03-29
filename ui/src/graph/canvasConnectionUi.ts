// Copyright GraphCaster. All Rights Reserved.

import { ConnectionLineType } from "@xyflow/react";
import type { CSSProperties } from "react";

/**
 * Connection preview while dragging from a Handle (`<ReactFlow>` connection line props).
 * Stroke colors match `minimapChrome.ts` / `tokens.css` (`--gc-accent`, dark `--gc-accent-hover`).
 * Keep `ConnectionLineType.Bezier` in sync with `GcBranchEdge` (`getBezierPath`).
 *
 * @see https://reactflow.dev/api-reference/react-flow — `connectionRadius`, `connectionLineStyle`, `connectionLineType`
 */

/** React Flow default is 20; competitors on @xyflow often use a slightly larger snap radius. */
export const GC_CONNECTION_RADIUS = 28;

export const gcConnectionLineType = ConnectionLineType.Bezier;

export function connectionLineStyleForTheme(isDark: boolean): CSSProperties {
  return {
    stroke: isDark ? "#409cff" : "#007aff",
    strokeWidth: 2,
    strokeLinecap: "round",
  };
}
