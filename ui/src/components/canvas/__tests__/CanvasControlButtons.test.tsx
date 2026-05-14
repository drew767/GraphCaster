// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../../ui/Icon/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

vi.mock("@radix-ui/react-tooltip", () => ({
  Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Trigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Portal: () => null,
  Content: () => null,
  Arrow: () => null,
}));

const mockFitView = vi.fn().mockResolvedValue(undefined);
const mockZoomIn = vi.fn().mockResolvedValue(undefined);
const mockZoomOut = vi.fn().mockResolvedValue(undefined);
const mockZoomTo = vi.fn().mockResolvedValue(undefined);
let mockZoom = 1;

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({
    fitView: mockFitView,
    zoomIn: mockZoomIn,
    zoomOut: mockZoomOut,
    zoomTo: mockZoomTo,
  }),
  useStore: (selector: (s: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, mockZoom] }),
}));

import { CanvasControlButtons } from "../CanvasControlButtons";

describe("CanvasControlButtons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockZoom = 1;
  });

  it("renders the control button group", () => {
    const { getByTestId } = render(<CanvasControlButtons />);
    expect(getByTestId("canvas-control-buttons")).not.toBeNull();
  });

  it("fit-view button calls fitView", () => {
    render(<CanvasControlButtons />);
    fireEvent.click(screen.getByTestId("canvas-ctrl-fit"));
    expect(mockFitView).toHaveBeenCalledTimes(1);
  });

  it("zoom-in button calls zoomIn", () => {
    render(<CanvasControlButtons />);
    fireEvent.click(screen.getByTestId("canvas-ctrl-zoom-in"));
    expect(mockZoomIn).toHaveBeenCalledTimes(1);
  });

  it("zoom-out button calls zoomOut", () => {
    render(<CanvasControlButtons />);
    fireEvent.click(screen.getByTestId("canvas-ctrl-zoom-out"));
    expect(mockZoomOut).toHaveBeenCalledTimes(1);
  });

  it("reset-zoom button hidden when zoom is 1, shown when zoom != 1", () => {
    mockZoom = 1;
    const { queryByTestId, rerender } = render(<CanvasControlButtons />);
    expect(queryByTestId("canvas-ctrl-reset-zoom")).toBeNull();
    mockZoom = 0.5;
    rerender(<CanvasControlButtons />);
    expect(queryByTestId("canvas-ctrl-reset-zoom")).not.toBeNull();
  });

  it("auto-layout button calls onAutoLayout callback", () => {
    const onAutoLayout = vi.fn();
    render(<CanvasControlButtons onAutoLayout={onAutoLayout} />);
    fireEvent.click(screen.getByTestId("canvas-ctrl-auto-layout"));
    expect(onAutoLayout).toHaveBeenCalledTimes(1);
  });

  it("auto-layout button is disabled when structureLocked", () => {
    const onAutoLayout = vi.fn();
    render(<CanvasControlButtons onAutoLayout={onAutoLayout} structureLocked />);
    const btn = screen.getByTestId("canvas-ctrl-auto-layout") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
