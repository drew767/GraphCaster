// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

import { useHeaderSlotStore } from "../headerSlotStore";

function HeaderSlotsView() {
  const left = useHeaderSlotStore((s) => s.left);
  const center = useHeaderSlotStore((s) => s.center);
  const right = useHeaderSlotStore((s) => s.right);
  return (
    <div>
      <div data-testid="slot-left">{left}</div>
      <div data-testid="slot-center">{center}</div>
      <div data-testid="slot-right">{right}</div>
    </div>
  );
}

describe("headerSlotStore", () => {
  beforeEach(() => {
    useHeaderSlotStore.getState().clear();
  });

  it("starts with empty slots", () => {
    const { left, center, right } = useHeaderSlotStore.getState();
    expect(left).toBeNull();
    expect(center).toBeNull();
    expect(right).toBeNull();
  });

  it("setSlots merges partial slots", () => {
    act(() => {
      useHeaderSlotStore.getState().setSlots({ left: "L", right: "R" });
    });
    expect(useHeaderSlotStore.getState().left).toBe("L");
    expect(useHeaderSlotStore.getState().right).toBe("R");
    expect(useHeaderSlotStore.getState().center).toBeNull();

    act(() => {
      useHeaderSlotStore.getState().setSlots({ center: "C" });
    });
    expect(useHeaderSlotStore.getState().left).toBe("L");
    expect(useHeaderSlotStore.getState().center).toBe("C");
  });

  it("clear resets all slots to null", () => {
    act(() => {
      useHeaderSlotStore.getState().setSlots({
        left: "L",
        center: "C",
        right: "R",
      });
    });
    act(() => {
      useHeaderSlotStore.getState().clear();
    });
    expect(useHeaderSlotStore.getState().left).toBeNull();
    expect(useHeaderSlotStore.getState().center).toBeNull();
    expect(useHeaderSlotStore.getState().right).toBeNull();
  });

  it("renders react nodes from the store", () => {
    act(() => {
      useHeaderSlotStore.getState().setSlots({
        left: <span data-testid="left-marker">left-content</span>,
        right: <span data-testid="right-marker">right-content</span>,
      });
    });
    render(<HeaderSlotsView />);
    expect(screen.getByTestId("left-marker")).toHaveTextContent("left-content");
    expect(screen.getByTestId("right-marker")).toHaveTextContent("right-content");
  });
});
