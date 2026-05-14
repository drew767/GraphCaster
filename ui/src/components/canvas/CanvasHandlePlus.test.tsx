// Copyright GraphCaster. All Rights Reserved.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CanvasHandlePlus } from "./CanvasHandlePlus";

describe("CanvasHandlePlus", () => {
  it("adds the pulsing class when pulsing is true", () => {
    render(<CanvasHandlePlus pulsing testId="hp1" />);
    const btn = screen.getByTestId("hp1");
    expect(btn.className).toContain("gc-handle-plus--pulsing");
    expect(btn.getAttribute("data-pulsing")).toBe("true");
  });

  it("does not pulse when pulsing is false", () => {
    render(<CanvasHandlePlus testId="hp2" />);
    const btn = screen.getByTestId("hp2");
    expect(btn.className).not.toContain("gc-handle-plus--pulsing");
  });

  it("cancels the pulse on the first pointerdown", () => {
    render(<CanvasHandlePlus pulsing testId="hp3" />);
    const btn = screen.getByTestId("hp3");
    expect(btn.className).toContain("gc-handle-plus--pulsing");
    fireEvent.pointerDown(btn, { button: 0 });
    expect(btn.className).not.toContain("gc-handle-plus--pulsing");
    expect(btn.getAttribute("data-pulsing")).toBe("false");
  });
});
