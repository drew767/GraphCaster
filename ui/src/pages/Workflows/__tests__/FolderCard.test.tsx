// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { FolderCard } from "../FolderCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === "app.workflows.folder.workflowCount")
        return `${opts?.count} workflows`;
      if (key === "app.workflows.folder.subFolderCount")
        return `${opts?.count} folders`;
      if (key === "app.workflows.folder.ariaLabel") return `Folder: ${opts?.name}`;
      return key;
    },
  }),
}));

// DropdownMenu uses PointerEvent
function setupPointerEventPolyfill() {
  if (typeof window !== "undefined" && !window.PointerEvent) {
    // @ts-expect-error jsdom polyfill
    window.PointerEvent = class PointerEvent extends MouseEvent {
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).hasPointerCapture = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).releasePointerCapture = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.HTMLElement.prototype as any).setPointerCapture = vi.fn();
  }
}
setupPointerEventPolyfill();

describe("FolderCard", () => {
  it("renders folder name and workflow count", () => {
    render(
      <FolderCard
        path="marketing"
        name="Marketing"
        workflowCount={5}
        onClick={vi.fn()}
      />
    );
    expect(screen.getByText("Marketing")).toBeInTheDocument();
    expect(screen.getByText(/5 workflows/i)).toBeInTheDocument();
  });

  it("calls onClick when card is clicked", () => {
    const onClick = vi.fn();
    render(
      <FolderCard
        path="marketing"
        name="Marketing"
        workflowCount={3}
        onClick={onClick}
      />
    );
    fireEvent.click(screen.getByTestId("folder-card"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("calls onClick on Enter keydown", () => {
    const onClick = vi.fn();
    render(
      <FolderCard
        path="marketing"
        name="Marketing"
        workflowCount={3}
        onClick={onClick}
      />
    );
    fireEvent.keyDown(screen.getByTestId("folder-card"), { key: "Enter" });
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("calls onRename with new name after rename action is selected", () => {
    const onRename = vi.fn();
    render(
      <FolderCard
        path="marketing"
        name="Marketing"
        workflowCount={2}
        onClick={vi.fn()}
        onRename={onRename}
      />
    );
    // Open the actions dropdown
    const moreBtn = screen.getByRole("button", { name: /app.workflows.folder.moreActions/i });
    act(() => {
      fireEvent.pointerDown(moreBtn, { button: 0, ctrlKey: false });
      fireEvent.click(moreBtn);
    });
    fireEvent.click(screen.getByText("app.workflows.folder.rename"));
    // Now renaming mode: InlineTextEdit is in display state (role=button shows current name)
    // The InlineTextEdit shows a div[role=button] with the name, click to enter edit
    const iteDisplay = screen.getByRole("button", { name: "Marketing" });
    fireEvent.click(iteDisplay);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "Email Campaigns" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("Email Campaigns");
  });
});
