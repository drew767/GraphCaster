// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { WorkflowSettingsModal } from "./WorkflowSettingsModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("WorkflowSettingsModal", () => {
  it("switches between tabs", () => {
    render(
      <WorkflowSettingsModal open workflowId="wf-1" onClose={() => {}} />,
    );
    expect(screen.getByText("workflowSettings.description")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "workflowSettings.tabExecution" }));
    expect(screen.getByText("workflowSettings.timezone")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "workflowSettings.tabCallerPolicy" }));
    expect(screen.getByText("workflowSettings.callerPolicyLegend")).toBeInTheDocument();
  });

  it("calls api.updateSettings on save", async () => {
    const api = {
      updateSettings: vi.fn().mockResolvedValue(undefined),
      duplicate: vi.fn(),
      move: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      list: vi.fn(),
    };
    const onClose = vi.fn();
    render(
      <WorkflowSettingsModal
        open
        workflowId="wf-1"
        onClose={onClose}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        api={api as any}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "workflowSettings.save" }));
    });
    expect(api.updateSettings).toHaveBeenCalledWith("wf-1", expect.any(Object));
    expect(onClose).toHaveBeenCalled();
  });
});
