// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { DuplicateWorkflowModal } from "./DuplicateWorkflowModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("DuplicateWorkflowModal", () => {
  it("seeds name with '<orig> copy'", () => {
    render(
      <DuplicateWorkflowModal
        open
        workflowId="wf-1"
        originalName="My Flow"
        onClose={() => {}}
      />,
    );
    const input = screen.getByTestId("gc-duplicate-name") as HTMLInputElement;
    expect(input.value).toBe("My Flow duplicateWorkflow.copySuffix");
  });

  it("submits via api.duplicate", async () => {
    const api = {
      updateSettings: vi.fn(),
      duplicate: vi
        .fn()
        .mockResolvedValue({ id: "wf-2", name: "My Flow copy" }),
      move: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      list: vi.fn(),
    };
    const onDuplicated = vi.fn();
    const onClose = vi.fn();
    render(
      <DuplicateWorkflowModal
        open
        workflowId="wf-1"
        originalName="My Flow"
        onClose={onClose}
        onDuplicated={onDuplicated}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        api={api as any}
      />,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "duplicateWorkflow.submit" }),
      );
    });
    expect(api.duplicate).toHaveBeenCalledWith(
      "wf-1",
      expect.objectContaining({ name: expect.stringContaining("My Flow") }),
    );
    expect(onDuplicated).toHaveBeenCalledWith({ id: "wf-2", name: "My Flow copy" });
    expect(onClose).toHaveBeenCalled();
  });
});
