// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { AlertDialog } from "../AlertDialog";

describe("AlertDialog", () => {
  it("renders title and default confirm/cancel labels", () => {
    render(
      <AlertDialog
        open
        title="Delete workflow?"
        onConfirm={vi.fn()}
      />
    );
    expect(screen.getByText("Delete workflow?")).toBeInTheDocument();
    expect(screen.getByText("Confirm")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls onConfirm when confirm button is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <AlertDialog
        open
        title="Are you sure?"
        onConfirm={onConfirm}
        confirmLabel="Yes, delete"
      />
    );
    fireEvent.click(screen.getByText("Yes, delete"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel and closes when cancel is clicked", () => {
    const onCancel = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <AlertDialog
        open
        title="Confirm?"
        onConfirm={vi.fn()}
        onCancel={onCancel}
        onOpenChange={onOpenChange}
      />
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("applies destructive variant data attribute to confirm button when destructive=true", () => {
    render(
      <AlertDialog
        open
        title="Delete?"
        onConfirm={vi.fn()}
        destructive
        confirmLabel="Delete"
      />
    );
    const confirmBtn = screen.getByText("Delete").closest("button");
    expect(confirmBtn).toHaveAttribute("data-variant", "destructive");
  });

  it("disables confirm button and shows loading state when loading=true", () => {
    render(
      <AlertDialog
        open
        title="Processing"
        onConfirm={vi.fn()}
        confirmLabel="Submit"
        loading
      />
    );
    // Button is disabled when loading
    const confirmBtn = screen.getByText("Submit").closest("button");
    expect(confirmBtn).toBeDisabled();
    // Button sets aria-busy
    expect(confirmBtn).toHaveAttribute("aria-busy", "true");
  });

  it("renders custom confirmLabel and cancelLabel", () => {
    render(
      <AlertDialog
        open
        title="Custom labels"
        onConfirm={vi.fn()}
        confirmLabel="Proceed"
        cancelLabel="Go back"
      />
    );
    expect(screen.getByText("Proceed")).toBeInTheDocument();
    expect(screen.getByText("Go back")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(
      <AlertDialog
        open
        title="Sure?"
        description="This action cannot be undone."
        onConfirm={vi.fn()}
      />
    );
    expect(
      screen.getByText("This action cannot be undone.")
    ).toBeInTheDocument();
  });

  it("has role alertdialog on the content element", () => {
    render(
      <AlertDialog
        open
        title="Danger!"
        onConfirm={vi.fn()}
      />
    );
    const alertDialog = document.querySelector('[role="alertdialog"]');
    expect(alertDialog).not.toBeNull();
  });
});
