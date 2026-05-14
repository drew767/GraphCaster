// Copyright GraphCaster. All Rights Reserved.

import type { ExecutionStatus } from "./executionsApi";

export function statusIconChar(status: ExecutionStatus): string {
  switch (status) {
    case "success":
      return "✅";
    case "error":
      return "❌";
    case "running":
      return "⏵";
    case "canceled":
      return "⏸";
    default:
      return "○";
  }
}

export function statusTagColor(status: ExecutionStatus): string {
  switch (status) {
    case "success":
      return "var(--gc-color-success, #16a34a)";
    case "error":
      return "var(--gc-color-error, #dc2626)";
    case "running":
      return "var(--gc-color-info, #2563eb)";
    case "canceled":
      return "var(--gc-color-muted, #6b7280)";
    default:
      return "var(--gc-color-muted, #6b7280)";
  }
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "—";
  }
  if (ms < 1000) {
    return `${Math.round(ms)} ms`;
  }
  const s = ms / 1000;
  if (s < 60) {
    return `${s.toFixed(2)} s`;
  }
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m ${rem}s`;
}
