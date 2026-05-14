// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

vi.mock("@radix-ui/react-tooltip", () => ({
  Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Root: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Trigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Portal: () => null,
  Content: () => null,
  Arrow: () => null,
}));

vi.mock("../../ui/Icon/Icon", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
}));

vi.mock("../../../lib/isTextEditingTarget", () => ({
  isTextEditingTarget: () => false,
}));

import { CanvasRunWorkflowButton } from "../CanvasRunWorkflowButton";

describe("CanvasRunWorkflowButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders idle run button", () => {
    const onRun = vi.fn();
    const { getByTestId } = render(<CanvasRunWorkflowButton onRun={onRun} />);
    expect(getByTestId("canvas-run-workflow-button")).not.toBeNull();
    expect(getByTestId("canvas-run-btn-primary")).not.toBeNull();
  });

  it("calls onRun when clicked in idle state", () => {
    const onRun = vi.fn();
    render(<CanvasRunWorkflowButton onRun={onRun} />);
    fireEvent.click(screen.getByTestId("canvas-run-btn-primary"));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("shows spinner/disabled state when running=true", () => {
    const onRun = vi.fn();
    render(<CanvasRunWorkflowButton onRun={onRun} running />);
    const btn = screen.getByTestId("canvas-run-btn-primary") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute("aria-busy")).toBe("true");
  });

  it("shows split-button arrow when multiple triggers provided", () => {
    const onRun = vi.fn();
    const triggers = [
      { id: "t1", label: "Webhook" },
      { id: "t2", label: "Schedule" },
    ];
    render(
      <CanvasRunWorkflowButton
        onRun={onRun}
        triggerOptions={triggers}
      />,
    );
    expect(screen.getByTestId("canvas-run-btn-arrow")).not.toBeNull();
  });

  it("opens trigger dropdown and calls onRunFromTrigger on selection", () => {
    const onRun = vi.fn();
    const onRunFromTrigger = vi.fn();
    const triggers = [
      { id: "t1", label: "Webhook" },
      { id: "t2", label: "Schedule" },
    ];
    render(
      <CanvasRunWorkflowButton
        onRun={onRun}
        triggerOptions={triggers}
        onRunFromTrigger={onRunFromTrigger}
      />,
    );
    fireEvent.click(screen.getByTestId("canvas-run-btn-arrow"));
    const dropdown = screen.getByTestId("canvas-run-btn-dropdown");
    expect(dropdown).not.toBeNull();
    const options = dropdown.querySelectorAll('[role="option"]');
    expect(options.length).toBe(2);
    fireEvent.click(options[1]);
    expect(onRunFromTrigger).toHaveBeenCalledWith("t2");
  });

  it("fires onRun on Ctrl+Enter keydown", () => {
    const onRun = vi.fn();
    render(<CanvasRunWorkflowButton onRun={onRun} />);
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});
