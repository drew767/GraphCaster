// Copyright GraphCaster. All Rights Reserved.

import type { Node } from "@xyflow/react";

import type { NodeRunPhase } from "../run/nodeRunOverlay";
import {
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_COMMENT,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_GRAPH_REF,
  GRAPH_NODE_TYPE_GROUP,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_HTTP_REQUEST,
  GRAPH_NODE_TYPE_RAG_QUERY,
  GRAPH_NODE_TYPE_DELAY,
  GRAPH_NODE_TYPE_DEBOUNCE,
  GRAPH_NODE_TYPE_WAIT_FOR,
  GRAPH_NODE_TYPE_SET_VARIABLE,
  GRAPH_NODE_TYPE_PYTHON_CODE,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_TASK,
} from "./nodeKinds";
import type { GcNodeData } from "./toReactFlow";

/**
 * MiniMap node rectangles (`MiniMap` `nodeColor` / `nodeStrokeColor`).
 *
 * **SSOT for canvas chrome:** `ui/src/styles/app.css` — `.gc-flow-node--*` **border-color** hex values
 * (and `var(--gc-accent)` for **task**). This module repeats those literals so SVG MiniMap can use
 * opaque `#rrggbb` without `getComputedStyle`. When you change a type color on the canvas, update
 * `MINIMAP_FILL_BY_GRAPH_TYPE` (+ **`#3b82f6`** for task = default `--gc-accent` in `app.css`).
 *
 * Run overlay tints apply only to **executable** nodes, not comment/group frames.
 */
const MINIMAP_FILL_BY_GRAPH_TYPE: Readonly<Record<string, string>> = {
  [GRAPH_NODE_TYPE_START]: "#34c759",
  [GRAPH_NODE_TYPE_EXIT]: "#ff3b30",
  [GRAPH_NODE_TYPE_TASK]: "#3b82f6",
  [GRAPH_NODE_TYPE_LLM_AGENT]: "#5ac8fa",
  [GRAPH_NODE_TYPE_GRAPH_REF]: "#af52de",
  [GRAPH_NODE_TYPE_MERGE]: "#0a84ff",
  [GRAPH_NODE_TYPE_FORK]: "#34c759",
  [GRAPH_NODE_TYPE_AI_ROUTE]: "#f5b041",
  [GRAPH_NODE_TYPE_MCP_TOOL]: "#ff9f0a",
  [GRAPH_NODE_TYPE_HTTP_REQUEST]: "#06b6d4",
  [GRAPH_NODE_TYPE_RAG_QUERY]: "#8b5cf6",
  [GRAPH_NODE_TYPE_DELAY]: "#64748b",
  [GRAPH_NODE_TYPE_DEBOUNCE]: "#f59e0b",
  [GRAPH_NODE_TYPE_WAIT_FOR]: "#14b8a6",
  [GRAPH_NODE_TYPE_SET_VARIABLE]: "#d946ef",
  [GRAPH_NODE_TYPE_PYTHON_CODE]: "#a3e635",
};

/** Sticky comment / group frames — muted fills distinct from executable nodes (`gc-flow-comment` / `gc-flow-group`). */
const MINIMAP_COMMENT_FILL = "#e8eef8";
const MINIMAP_GROUP_FILL = "#e8e8ea";

const UNKNOWN_FILL = "#e2e2e2";

const OVERLAY_TINT: Readonly<Record<NodeRunPhase, string>> = {
  running: "#2563eb",
  success: "#34c759",
  failed: "#ff3b30",
  skipped: "#8e8e93",
};

const OVERLAY_MIX = 0.4;

function parseRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.trim();
  if (!h.startsWith("#") || h.length !== 7) {
    return null;
  }
  const r = Number.parseInt(h.slice(1, 3), 16);
  const g = Number.parseInt(h.slice(3, 5), 16);
  const b = Number.parseInt(h.slice(5, 7), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) {
    return null;
  }
  return { r, g, b };
}

function mixHex(base: string, onto: string, t: number): string {
  const a = parseRgb(base);
  const b = parseRgb(onto);
  if (a == null || b == null) {
    return base;
  }
  const u = Math.min(1, Math.max(0, t));
  const r = Math.round(a.r + (b.r - a.r) * u);
  const g = Math.round(a.g + (b.g - a.g) * u);
  const bl = Math.round(a.b + (b.b - a.b) * u);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

/** Base minimap fill for a document `graphNodeType` string (executable kinds only). */
export function minimapBaseFillForGraphNodeType(graphNodeType: string): string {
  return MINIMAP_FILL_BY_GRAPH_TYPE[graphNodeType] ?? UNKNOWN_FILL;
}

function isGcMinimapFrameNode(node: Node<GcNodeData>): boolean {
  return (
    node.type === "gcComment" ||
    node.type === "gcGroup" ||
    node.data?.graphNodeType === GRAPH_NODE_TYPE_COMMENT ||
    node.data?.graphNodeType === GRAPH_NODE_TYPE_GROUP
  );
}

function minimapBaseFill(node: Node<GcNodeData>): string {
  if (node.type === "gcComment" || node.data?.graphNodeType === GRAPH_NODE_TYPE_COMMENT) {
    return MINIMAP_COMMENT_FILL;
  }
  if (node.type === "gcGroup" || node.data?.graphNodeType === GRAPH_NODE_TYPE_GROUP) {
    return MINIMAP_GROUP_FILL;
  }
  const gt = node.data?.graphNodeType ?? "unknown";
  return minimapBaseFillForGraphNodeType(gt);
}

/**
 * MiniMap `nodeColor` value: type fill plus optional run-overlay tint from `data.runOverlayPhase`.
 */
export function minimapNodeFill(node: Node<GcNodeData>): string {
  const base = minimapBaseFill(node);
  if (isGcMinimapFrameNode(node)) {
    return base;
  }
  const phase = node.data?.runOverlayPhase;
  if (phase && OVERLAY_TINT[phase]) {
    return mixHex(base, OVERLAY_TINT[phase], OVERLAY_MIX);
  }
  return base;
}

/** MiniMap `nodeStrokeColor` — darkened fill for contrast on the minimap background. */
export function minimapNodeStroke(node: Node<GcNodeData>): string {
  return mixHex(minimapNodeFill(node), "#000000", 0.38);
}
