// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { STICKY_COLORS, StickyNoteToolbar } from "../StickyNoteToolbar";

describe("StickyNoteToolbar", () => {
  it("renders all 6 color swatches", () => {
    const onSelect = vi.fn();
    render(<StickyNoteToolbar selected="yellow" onSelect={onSelect} />);
    for (const color of STICKY_COLORS) {
      expect(screen.getByTestId(`sticky-color-${color}`)).not.toBeNull();
    }
    expect(STICKY_COLORS.length).toBe(6);
  });

  it("marks the selected swatch via aria-pressed", () => {
    const onSelect = vi.fn();
    render(<StickyNoteToolbar selected="blue" onSelect={onSelect} />);
    const blue = screen.getByTestId("sticky-color-blue");
    const yellow = screen.getByTestId("sticky-color-yellow");
    expect(blue.getAttribute("aria-pressed")).toBe("true");
    expect(yellow.getAttribute("aria-pressed")).toBe("false");
  });

  it("invokes onSelect with the clicked color", () => {
    const onSelect = vi.fn();
    render(<StickyNoteToolbar selected="yellow" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("sticky-color-green"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("green");
  });
});
