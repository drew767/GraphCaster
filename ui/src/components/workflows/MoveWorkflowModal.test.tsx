// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

import { MoveWorkflowModal } from "./MoveWorkflowModal";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const PROJECTS = [
  {
    id: "p1",
    name: "Project One",
    folders: [
      { id: "f1", name: "Folder A" },
      { id: "f2", name: "Folder B", children: [{ id: "f2a", name: "Nested" }] },
    ],
  },
];

describe("MoveWorkflowModal", () => {
  it("selects a folder when clicked", () => {
    render(
      <MoveWorkflowModal
        open
        workflowId="wf-1"
        projects={PROJECTS}
        onClose={() => {}}
      />,
    );
    const submit = screen.getByRole("button", { name: "moveWorkflow.submit" });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByText("Folder A"));
    expect(submit).not.toBeDisabled();
  });

  it("calls api.move with selection", async () => {
    const api = {
      updateSettings: vi.fn(),
      duplicate: vi.fn(),
      move: vi.fn().mockResolvedValue(undefined),
      get: vi.fn(),
      create: vi.fn(),
      list: vi.fn(),
    };
    const onMoved = vi.fn();
    render(
      <MoveWorkflowModal
        open
        workflowId="wf-9"
        projects={PROJECTS}
        onClose={() => {}}
        onMoved={onMoved}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        api={api as any}
      />,
    );
    fireEvent.click(screen.getByText("Nested"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "moveWorkflow.submit" }));
    });
    expect(api.move).toHaveBeenCalledWith("wf-9", { projectId: "p1", folderId: "f2a" });
    expect(onMoved).toHaveBeenCalled();
  });
});
