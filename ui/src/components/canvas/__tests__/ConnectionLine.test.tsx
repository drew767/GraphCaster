// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { Position } from "@xyflow/react";

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    getBezierPath: (params: {
      sourceX: number;
      sourceY: number;
      targetX: number;
      targetY: number;
    }) => [`M${params.sourceX},${params.sourceY} C ${params.targetX},${params.targetY}`, 0, 0],
  };
});

import { ConnectionLine } from "../ConnectionLine";

function makeProps(): Parameters<typeof ConnectionLine>[0] {
  return {
    fromX: 10,
    fromY: 20,
    fromPosition: Position.Right,
    toX: 200,
    toY: 20,
    toPosition: Position.Left,
    connectionLineType: "bezier" as const,
    connectionLineStyle: {},
    fromNode: undefined,
    fromHandle: undefined,
  } as Parameters<typeof ConnectionLine>[0];
}

describe("ConnectionLine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not render path before 300ms delay", () => {
    const { container } = render(<ConnectionLine {...makeProps()} />);
    expect(container.querySelector("path")).toBeNull();
  });

  it("renders path after 300ms delay", () => {
    const { container } = render(<ConnectionLine {...makeProps()} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(container.querySelector("path")).not.toBeNull();
  });

  it("uses smart bezier path (getBezierPath) matching UX68 routing", () => {
    const { container } = render(<ConnectionLine {...makeProps()} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const path = container.querySelector("path");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("d")).toMatch(/M10,20/);
  });

  it("applies var(--color--primary, #007aff) stroke at 0.6 opacity", () => {
    const { container } = render(<ConnectionLine {...makeProps()} />);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const path = container.querySelector("path");
    expect(path?.getAttribute("stroke")).toBe("var(--color--primary, #007aff)");
    expect(path?.getAttribute("stroke-opacity")).toBe("0.6");
    expect(path?.getAttribute("stroke-width")).toBe("2");
  });
});
