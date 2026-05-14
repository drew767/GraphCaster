// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import {
  areNodePropsEqual,
  createMemoizedNode,
  type NodeRenderProps,
} from "./MemoizedNode";

type ClickableProps = NodeRenderProps & {
  data: { onClick: () => void; label: string };
};

function ClickableNodeImpl({ data }: ClickableProps) {
  return (
    <button type="button" onClick={data.onClick} data-testid="memo-click">
      {data.label}
    </button>
  );
}

const MemoClickableNode = createMemoizedNode(ClickableNodeImpl as never);

describe("areNodePropsEqual", () => {
  const base: NodeRenderProps = {
    id: "n",
    selected: false,
    data: { x: 1 },
  };

  it("returns true for identical primitive props and the same data object", () => {
    expect(areNodePropsEqual(base, { ...base })).toBe(true);
  });

  it("returns false when id changes", () => {
    expect(areNodePropsEqual(base, { ...base, id: "other" })).toBe(false);
  });

  it("returns false when selected changes", () => {
    expect(areNodePropsEqual(base, { ...base, selected: true })).toBe(false);
  });

  it("returns false when dragging changes", () => {
    expect(areNodePropsEqual({ ...base, dragging: false }, { ...base, dragging: true })).toBe(
      false,
    );
  });

  it("returns false when width or height changes", () => {
    expect(areNodePropsEqual({ ...base, width: 100 }, { ...base, width: 120 })).toBe(false);
    expect(areNodePropsEqual({ ...base, height: 40 }, { ...base, height: 48 })).toBe(false);
  });

  it("returns false when absolute position changes", () => {
    expect(
      areNodePropsEqual(
        { ...base, positionAbsoluteX: 0, positionAbsoluteY: 0 },
        { ...base, positionAbsoluteX: 10, positionAbsoluteY: 0 },
      ),
    ).toBe(false);
    expect(
      areNodePropsEqual(
        { ...base, positionAbsoluteX: 0, positionAbsoluteY: 0 },
        { ...base, positionAbsoluteX: 0, positionAbsoluteY: 5 },
      ),
    ).toBe(false);
  });

  it("returns false when a function-valued data entry has a new reference (stale closure guard)", () => {
    const a = () => "old";
    const b = () => "new";
    expect(
      areNodePropsEqual({ ...base, data: { onClick: a } }, { ...base, data: { onClick: b } }),
    ).toBe(false);
  });

  it("returns true when data has identical function references", () => {
    const cb = () => undefined;
    expect(
      areNodePropsEqual({ ...base, data: { onClick: cb } }, { ...base, data: { onClick: cb } }),
    ).toBe(true);
  });
});

describe("createMemoizedNode handler refresh", () => {
  it("invokes the latest handler reference after the parent passes a fresh data object", () => {
    const stale = vi.fn();
    const fresh = vi.fn();

    const { getByTestId, rerender } = render(
      <MemoClickableNode
        id="n1"
        selected={false}
        data={{ onClick: stale, label: "click me" }}
      />,
    );
    fireEvent.click(getByTestId("memo-click"));
    expect(stale).toHaveBeenCalledTimes(1);
    expect(fresh).not.toHaveBeenCalled();

    rerender(
      <MemoClickableNode
        id="n1"
        selected={false}
        data={{ onClick: fresh, label: "click me" }}
      />,
    );
    fireEvent.click(getByTestId("memo-click"));
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(stale).toHaveBeenCalledTimes(1);
  });
});
