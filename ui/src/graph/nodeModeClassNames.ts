// Copyright GraphCaster. All Rights Reserved.

/**
 * Single source of truth for the CSS class names applied to a node based on
 * its execution mode and visual flags (UX127–UX130). Used by both the initial
 * hydration (`toReactFlow.ts`) and the live mutation handler in `GraphCanvas`.
 */

import type { GcNodeMode } from "./toReactFlow";

const NODE_MODES_SET: ReadonlySet<string> = new Set([
  "normal",
  "bypass",
  "mute",
  "disabled",
]);

export function coerceGcNodeMode(value: unknown): GcNodeMode {
  if (typeof value === "string" && NODE_MODES_SET.has(value)) {
    return value as GcNodeMode;
  }
  return "normal";
}

export function gcNodeClassNamesFor(
  mode: GcNodeMode,
  collapsed: boolean,
  pinned: boolean,
): string | undefined {
  const modeCls =
    mode === "bypass"
      ? "gc-node--bypass"
      : mode === "mute" || mode === "disabled"
        ? "gc-node--mute"
        : "";
  const parts = [
    modeCls,
    collapsed ? "gc-node--collapsed" : "",
    pinned ? "gc-node--pinned" : "",
  ].filter((s) => s !== "");
  return parts.length > 0 ? parts.join(" ") : undefined;
}
