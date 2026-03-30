// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MemoizedNode, areNodePropsEqual } from "../../components/canvas/MemoizedNode";

describe("areNodePropsEqual", () => {
  it("returns true for identical props", () => {
    const props = {
      id: "node-1",
      data: { label: "Test" },
      selected: false,
      dragging: false,
    };
    expect(areNodePropsEqual(props, props)).toBe(true);
  });

  it("returns false when selected changes", () => {
    const prev = { id: "node-1", data: { label: "Test" }, selected: false, dragging: false };
    const next = { id: "node-1", data: { label: "Test" }, selected: true, dragging: false };
    expect(areNodePropsEqual(prev, next)).toBe(false);
  });

  it("returns false when data changes", () => {
    const prev = { id: "node-1", data: { label: "Test" }, selected: false, dragging: false };
    const next = { id: "node-1", data: { label: "Changed" }, selected: false, dragging: false };
    expect(areNodePropsEqual(prev, next)).toBe(false);
  });

  it("returns true when position changes (handled by reactflow)", () => {
    const prev = {
      id: "node-1",
      data: { label: "Test" },
      selected: false,
      dragging: false,
      xPos: 0,
    };
    const next = {
      id: "node-1",
      data: { label: "Test" },
      selected: false,
      dragging: false,
      xPos: 100,
    };
    expect(areNodePropsEqual(prev, next)).toBe(true);
  });

  it("returns false when dragging changes", () => {
    const prev = { id: "node-1", data: { label: "Test" }, selected: false, dragging: false };
    const next = { id: "node-1", data: { label: "Test" }, selected: false, dragging: true };
    expect(areNodePropsEqual(prev, next)).toBe(false);
  });
});

describe("MemoizedNode", () => {
  it("renders without re-render on unchanged props", () => {
    let renderCount = 0;
    const TestNode = () => {
      renderCount += 1;
      return <div>Test</div>;
    };

    const MemoizedTestNode = MemoizedNode(TestNode as React.ComponentType<{ id: string; data: { label: string }; selected: boolean }>);

    const { rerender } = render(<MemoizedTestNode id="1" data={{ label: "Test" }} selected={false} />);

    expect(renderCount).toBe(1);

    rerender(<MemoizedTestNode id="1" data={{ label: "Test" }} selected={false} />);

    expect(renderCount).toBe(1);
  });
});
