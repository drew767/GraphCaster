// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { CanvasHandlePlus } from "../CanvasHandlePlus";

describe("CanvasHandlePlus", () => {
  const onOpen = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a button with aria-label", () => {
    render(
      <CanvasHandlePlus sourceNodeId="n1" sourceHandle="out_default" onOpen={onOpen} />,
    );
    const btn = screen.getByTestId("handle-plus");
    expect(btn).toBeInTheDocument();
    expect(btn.tagName).toBe("BUTTON");
    expect(btn).toHaveAttribute("aria-label", "app.canvas.handlePlus.label");
  });

  it("calls onOpen with sourceNodeId and sourceHandle when clicked", () => {
    render(
      <CanvasHandlePlus sourceNodeId="node-1" sourceHandle="out_default" onOpen={onOpen} />,
    );
    fireEvent.click(screen.getByTestId("handle-plus"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith("node-1", "out_default");
  });

  it("applies --small size class when size=small", () => {
    const { container } = render(
      <CanvasHandlePlus sourceNodeId="n1" sourceHandle="out_default" size="small" onOpen={onOpen} />,
    );
    expect(container.querySelector(".gc-handle-plus--small")).not.toBeNull();
  });

  it("applies --large size class when size=large", () => {
    const { container } = render(
      <CanvasHandlePlus sourceNodeId="n1" sourceHandle="out_default" size="large" onOpen={onOpen} />,
    );
    expect(container.querySelector(".gc-handle-plus--large")).not.toBeNull();
  });

  it("defaults to medium size", () => {
    const { container } = render(
      <CanvasHandlePlus sourceNodeId="n1" sourceHandle="out_default" onOpen={onOpen} />,
    );
    expect(container.querySelector(".gc-handle-plus--medium")).not.toBeNull();
  });
});
