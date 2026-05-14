// Copyright Aura. All Rights Reserved.

import { describe, it, expect } from "vitest";
import {
  getNodeCategoryColor,
  NODE_CATEGORY_COLORS,
  type NodeCategoryColorId,
} from "./nodeCategoryColors";

describe("nodeCategoryColors", () => {
  it("returns color for 'flow' category", () => {
    expect(getNodeCategoryColor("flow")).toBe(NODE_CATEGORY_COLORS.flow);
  });

  it("returns color for 'run_ai' category", () => {
    expect(getNodeCategoryColor("run_ai")).toBe(NODE_CATEGORY_COLORS.run_ai);
  });

  it("returns color for 'nested' category", () => {
    expect(getNodeCategoryColor("nested")).toBe(NODE_CATEGORY_COLORS.nested);
  });

  it("returns color for 'notes' category", () => {
    expect(getNodeCategoryColor("notes")).toBe(NODE_CATEGORY_COLORS.notes);
  });

  it("returns default color for unknown category", () => {
    expect(getNodeCategoryColor("unknown" as NodeCategoryColorId)).toBe(
      NODE_CATEGORY_COLORS.default,
    );
  });
});
