// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("../components/ui/Icon/Icon", () => ({
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

vi.mock("../components/ui/DropdownMenu/DropdownMenu", () => ({
  DropdownMenu: ({ trigger }: { trigger: React.ReactElement }) => <>{trigger}</>,
}));

const mockFitView = vi.fn().mockResolvedValue(undefined);
const mockZoomIn = vi.fn().mockResolvedValue(undefined);
const mockZoomOut = vi.fn().mockResolvedValue(undefined);
const mockGetNodes = vi.fn(() => []);
const mockGetEdges = vi.fn(() => []);
const mockSetNodes = vi.fn();

vi.mock("@xyflow/react", () => ({
  useReactFlow: () => ({
    fitView: mockFitView,
    zoomIn: mockZoomIn,
    zoomOut: mockZoomOut,
    getNodes: mockGetNodes,
    getEdges: mockGetEdges,
    setNodes: mockSetNodes,
  }),
}));

import { CanvasControlsPanel } from "./CanvasControlsPanel";
import { useEditorUiStore } from "../app/stores/editorUiStore";

const defaultProps = {
  canUndo: true,
  canRedo: true,
  onUndo: vi.fn(),
  onRedo: vi.fn(),
  onAddSticky: vi.fn(),
};

describe("CanvasControlsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorUiStore.setState({ snapToGrid: false, canvasLocked: false });
    if (typeof window !== "undefined") {
      window.localStorage.clear();
    }
  });

  it("renders all expected control buttons", () => {
    const { getByTestId } = render(<CanvasControlsPanel {...defaultProps} />);
    expect(getByTestId("canvas-controls-panel")).not.toBeNull();
    expect(getByTestId("canvas-controls-fit")).not.toBeNull();
    expect(getByTestId("canvas-controls-zoom-in")).not.toBeNull();
    expect(getByTestId("canvas-controls-zoom-out")).not.toBeNull();
    expect(getByTestId("canvas-controls-lock")).not.toBeNull();
    expect(getByTestId("canvas-controls-undo")).not.toBeNull();
    expect(getByTestId("canvas-controls-redo")).not.toBeNull();
    expect(getByTestId("canvas-controls-snap")).not.toBeNull();
    expect(getByTestId("canvas-controls-sticky")).not.toBeNull();
    expect(getByTestId("canvas-controls-layout")).not.toBeNull();
  });

  it("invokes fitView, zoomIn, zoomOut on click", () => {
    const { getByTestId } = render(<CanvasControlsPanel {...defaultProps} />);
    fireEvent.click(getByTestId("canvas-controls-fit"));
    fireEvent.click(getByTestId("canvas-controls-zoom-in"));
    fireEvent.click(getByTestId("canvas-controls-zoom-out"));
    expect(mockFitView).toHaveBeenCalledTimes(1);
    expect(mockZoomIn).toHaveBeenCalledTimes(1);
    expect(mockZoomOut).toHaveBeenCalledTimes(1);
  });

  it("undo / redo invoke their callbacks; disabled when not available", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const { getByTestId, rerender } = render(
      <CanvasControlsPanel {...defaultProps} onUndo={onUndo} onRedo={onRedo} />,
    );
    fireEvent.click(getByTestId("canvas-controls-undo"));
    fireEvent.click(getByTestId("canvas-controls-redo"));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);

    rerender(
      <CanvasControlsPanel
        {...defaultProps}
        canUndo={false}
        canRedo={false}
        onUndo={onUndo}
        onRedo={onRedo}
      />,
    );
    expect((getByTestId("canvas-controls-undo") as HTMLButtonElement).disabled).toBe(true);
    expect((getByTestId("canvas-controls-redo") as HTMLButtonElement).disabled).toBe(true);
  });

  it("snap and lock buttons toggle editorUiStore state", () => {
    const { getByTestId } = render(<CanvasControlsPanel {...defaultProps} />);

    expect(useEditorUiStore.getState().snapToGrid).toBe(false);
    fireEvent.click(getByTestId("canvas-controls-snap"));
    expect(useEditorUiStore.getState().snapToGrid).toBe(true);

    expect(useEditorUiStore.getState().canvasLocked).toBe(false);
    fireEvent.click(getByTestId("canvas-controls-lock"));
    expect(useEditorUiStore.getState().canvasLocked).toBe(true);
  });

  it("sticky button invokes onAddSticky", () => {
    const onAddSticky = vi.fn();
    const { getByTestId } = render(
      <CanvasControlsPanel {...defaultProps} onAddSticky={onAddSticky} />,
    );
    fireEvent.click(getByTestId("canvas-controls-sticky"));
    expect(onAddSticky).toHaveBeenCalledTimes(1);
  });
});
