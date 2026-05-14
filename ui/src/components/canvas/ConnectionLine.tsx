// Copyright GraphCaster. All Rights Reserved.

import { getBezierPath, type ConnectionLineComponentProps } from "@xyflow/react";
import { useEffect, useState } from "react";

const SHOW_DELAY_MS = 300;

/**
 * UX76 — Connection preview line drawn while the user drags a new edge from a Handle.
 *
 * A 300ms delay prevents flicker when the user taps the "+" button without intending
 * to drag (quick tap would flash a line and dismiss).
 *
 * Smart bezier routing matches `GcBranchEdge` (`getBezierPath`) — same curvature as
 * settled edges. Color: var(--color--primary, #007aff) at 0.6 opacity, stroke 2px.
 */
export function ConnectionLine({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
  toPosition,
}: ConnectionLineComponentProps) {
  const [showLine, setShowLine] = useState(false);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setShowLine(true);
    }, SHOW_DELAY_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, []);

  if (!showLine) {
    return null;
  }

  const [edgePath] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
  });

  return (
    <g>
      <path
        d={edgePath}
        fill="none"
        stroke="var(--color--primary, #007aff)"
        strokeOpacity={0.6}
        strokeWidth={2}
        strokeLinecap="round"
        className="gc-connection-line__path"
      />
    </g>
  );
}
