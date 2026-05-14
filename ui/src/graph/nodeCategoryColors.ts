// Copyright Aura. All Rights Reserved.

/**
 * Color mapping for node categories in the palette sidebar.
 * Colors are CSS variable references for theme compatibility.
 */

export type NodeCategoryColorId = "flow" | "run_ai" | "nested" | "notes" | "default";

export const NODE_CATEGORY_COLORS: Record<NodeCategoryColorId, string> = {
  flow: "var(--gc-category-flow, #3b82f6)",       // Blue - flow control nodes
  run_ai: "var(--gc-category-run-ai, #8b5cf6)",   // Purple - AI and execution nodes
  nested: "var(--gc-category-nested, #10b981)",   // Green - nested graph references
  notes: "var(--gc-category-notes, #f59e0b)",     // Amber - comments and groups
  default: "var(--gc-category-default, #6b7280)", // Gray - fallback
};

export function getNodeCategoryColor(category: NodeCategoryColorId): string {
  return NODE_CATEGORY_COLORS[category] ?? NODE_CATEGORY_COLORS.default;
}
