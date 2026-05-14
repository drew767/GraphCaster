// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@radix-ui/react-tooltip", () => ({
  Provider: ({ children }: { children: React.ReactNode }) => children,
  Root: ({ children }: { children: React.ReactNode }) => children,
  Trigger: ({ children }: { children: React.ReactNode }) => children,
  Portal: ({ children }: { children: React.ReactNode }) => null,
  Content: () => null,
  Arrow: () => null,
}));

import { CanvasNodeAddNodes } from "../CanvasNodeAddNodes";

describe("CanvasNodeAddNodes", () => {
  const onOpen = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the add-nodes button", () => {
    render(<CanvasNodeAddNodes onOpen={onOpen} />);
    expect(screen.getByTestId("canvas-add-nodes-btn")).toBeInTheDocument();
  });

  it("calls onOpen when the button is clicked", () => {
    render(<CanvasNodeAddNodes onOpen={onOpen} />);
    fireEvent.click(screen.getByTestId("canvas-add-nodes-btn"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("shows the first-step label text", () => {
    render(<CanvasNodeAddNodes onOpen={onOpen} />);
    expect(screen.getByText("app.canvas.addNodes.firstStep")).toBeInTheDocument();
  });

  it("has accessible aria-label on the container", () => {
    render(<CanvasNodeAddNodes onOpen={onOpen} />);
    const el = screen.getByLabelText("app.canvas.addNodes.panelLabel");
    expect(el).toBeInTheDocument();
  });
});
