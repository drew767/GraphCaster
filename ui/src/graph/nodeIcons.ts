// Copyright Aura. All Rights Reserved.

import type { NodeCategoryColorId } from "./nodeCategoryColors";

/**
 * Emoji/symbol icons for node types in the palette sidebar.
 * Using emoji for simplicity; can be replaced with SVG/Lucide icons later.
 */

export const NODE_ICONS: Record<string, string> = {
  // Flow control
  start: "▶️",
  exit: "🏁",
  fork: "🔀",
  merge: "🔗",

  // Execution
  task: "⚙️",
  mcp_tool: "🔧",

  // AI
  ai_route: "🧠",
  llm_agent: "🤖",

  // Nested
  graph_ref: "📂",

  // Notes
  comment: "💬",
  group: "📦",

  // Default
  default: "⬡",
};

export function getNodeIcon(nodeType: string): string {
  return NODE_ICONS[nodeType] ?? NODE_ICONS.default;
}

export function getNodeCategoryFromType(nodeType: string): NodeCategoryColorId {
  switch (nodeType) {
    case "start":
    case "exit":
    case "fork":
    case "merge":
      return "flow";
    case "task":
    case "mcp_tool":
    case "ai_route":
    case "llm_agent":
      return "run_ai";
    case "graph_ref":
      return "nested";
    case "comment":
    case "group":
      return "notes";
    default:
      return "default";
  }
}
