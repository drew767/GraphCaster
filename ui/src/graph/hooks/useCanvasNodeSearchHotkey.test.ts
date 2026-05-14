// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { isHotkeyEligible } from "./useCanvasNodeSearchHotkey";

describe("isHotkeyEligible", () => {
  it("is not eligible when no node is selected", () => {
    const res = isHotkeyEligible([], []);
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("none-selected");
  });

  it("is not eligible when multiple nodes are selected", () => {
    const res = isHotkeyEligible(
      [
        { id: "a", type: "gcNode" },
        { id: "b", type: "gcNode" },
      ],
      [],
    );
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("multi-selected");
  });

  it("is not eligible for frame nodes (comment/group)", () => {
    expect(isHotkeyEligible([{ id: "c", type: "gcComment" }], []).reason).toBe("frame-node");
    expect(isHotkeyEligible([{ id: "g", type: "gcGroup" }], []).reason).toBe("frame-node");
  });

  it("is not eligible when the selected node has an outgoing edge on out_default", () => {
    const res = isHotkeyEligible(
      [{ id: "a", type: "gcNode" }],
      [{ source: "a", sourceHandle: "out_default" }],
    );
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("has-outgoing");
  });

  it("is eligible when the selected node has no outgoing main-handle edge", () => {
    const res = isHotkeyEligible(
      [{ id: "a", type: "gcNode" }],
      [{ source: "a", sourceHandle: "out_error" }],
    );
    expect(res.eligible).toBe(true);
  });

  it("treats a missing sourceHandle as out_default", () => {
    const res = isHotkeyEligible(
      [{ id: "a", type: "gcNode" }],
      [{ source: "a" }],
    );
    expect(res.eligible).toBe(false);
    expect(res.reason).toBe("has-outgoing");
  });
});
