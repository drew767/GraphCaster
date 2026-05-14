// Copyright GraphCaster. All Rights Reserved.

import { memo } from "react";

import { Icon } from "../../components/ui/Icon/Icon";
import "./NodeStatusCornerIndicator.css";

export type NodeCornerStatus =
  | "error"
  | "running"
  | "pinned"
  | "muted"
  | "bypassed";

export interface NodeStatusCornerIndicatorProps {
  status: NodeCornerStatus | null;
}

/**
 * Single top-right corner indicator. Priority resolution is performed by
 * `resolveNodeCornerStatus` — callers pass the already-resolved status.
 */
function NodeStatusCornerIndicatorInner({ status }: NodeStatusCornerIndicatorProps) {
  if (status == null) {
    return null;
  }

  let iconName: Parameters<typeof Icon>[0]["name"];
  let className = "gc-node-corner-indicator";

  switch (status) {
    case "error":
      iconName = "circle-x";
      className += " gc-node-corner-indicator--error";
      break;
    case "running":
      iconName = "loader";
      className += " gc-node-corner-indicator--running";
      break;
    case "pinned":
      iconName = "pin";
      className += " gc-node-corner-indicator--pinned";
      break;
    case "muted":
      iconName = "volume-x";
      className += " gc-node-corner-indicator--muted";
      break;
    case "bypassed":
      iconName = "skip-forward";
      className += " gc-node-corner-indicator--bypassed";
      break;
    default:
      return null;
  }

  return (
    <span
      className={className}
      data-testid="node-corner-indicator"
      data-status={status}
    >
      <Icon name={iconName} size={12} />
    </span>
  );
}

export const NodeStatusCornerIndicator = memo(NodeStatusCornerIndicatorInner);
NodeStatusCornerIndicator.displayName = "NodeStatusCornerIndicator";

export function resolveNodeCornerStatus(opts: {
  hasError: boolean;
  isRunning: boolean;
  isPinned: boolean;
  isMuted: boolean;
  isBypassed: boolean;
}): NodeCornerStatus | null {
  if (opts.hasError) return "error";
  if (opts.isRunning) return "running";
  if (opts.isPinned) return "pinned";
  if (opts.isMuted) return "muted";
  if (opts.isBypassed) return "bypassed";
  return null;
}
