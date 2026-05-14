// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { Dialog, type DialogSize } from "../Dialog";

// Radix Dialog uses a portal — jsdom handles it fine via @radix-ui/react-dialog.

describe("Dialog", () => {
  it("renders children when open", () => {
    render(
      <Dialog open title="Test Dialog">
        <p>Body content</p>
      </Dialog>
    );
    expect(screen.getByText("Body content")).toBeInTheDocument();
  });

  it("renders title and close button by default", () => {
    render(
      <Dialog open title="My Title">
        <span>Content</span>
      </Dialog>
    );
    expect(screen.getByText("My Title")).toBeInTheDocument();
    expect(screen.getByLabelText("Close")).toBeInTheDocument();
  });

  it("hides close button when showCloseButton=false", () => {
    render(
      <Dialog open title="No Close" showCloseButton={false}>
        <span>Content</span>
      </Dialog>
    );
    expect(screen.queryByLabelText("Close")).not.toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(
      <Dialog open title="Title" description="A helpful description">
        <span>Body</span>
      </Dialog>
    );
    expect(screen.getByText("A helpful description")).toBeInTheDocument();
  });

  it("renders footer slot when provided", () => {
    render(
      <Dialog open title="Title" footer={<button>Save</button>}>
        <span>Body</span>
      </Dialog>
    );
    expect(screen.getByText("Save")).toBeInTheDocument();
  });

  it("calls onOpenChange when close button is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open title="Title" onOpenChange={onOpenChange}>
        <span>Body</span>
      </Dialog>
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not render content when closed (defaultOpen not set, open=false)", () => {
    render(
      <Dialog open={false} title="Hidden">
        <span>Hidden body</span>
      </Dialog>
    );
    expect(screen.queryByText("Hidden body")).not.toBeInTheDocument();
  });

  it("renders a trigger and opens on click (uncontrolled)", () => {
    render(
      <Dialog title="Triggered" trigger={<button>Open me</button>}>
        <span>Uncontrolled body</span>
      </Dialog>
    );
    expect(screen.queryByText("Uncontrolled body")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Open me"));
    expect(screen.getByText("Uncontrolled body")).toBeInTheDocument();
  });

  it("applies the correct size class for each size variant", () => {
    const sizes: DialogSize[] = [
      "small",
      "medium",
      "large",
      "xlarge",
      "2xlarge",
      "fit",
      "full",
      "cover",
    ];

    sizes.forEach((size) => {
      const { unmount } = render(
        <Dialog open title={`${size} dialog`} size={size}>
          <span>body</span>
        </Dialog>
      );
      const content = document
        .querySelector(`.gc-dialog-content--${size}`);
      expect(content).not.toBeNull();
      unmount();
    });
  });

  it("prevents overlay click close when closeOnOverlayClick=false", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog
        open
        title="No overlay close"
        onOpenChange={onOpenChange}
        closeOnOverlayClick={false}
      >
        <span>Body</span>
      </Dialog>
    );
    // Simulate pointerdown outside — Radix fires onPointerDownOutside
    const overlay = document.querySelector(".gc-dialog-overlay");
    if (overlay) {
      fireEvent.pointerDown(overlay);
    }
    // onOpenChange should NOT be called (default prevents it)
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("applies ariaLabel to content when no title is provided", () => {
    render(
      <Dialog open ariaLabel="Custom dialog label">
        <span>Content</span>
      </Dialog>
    );
    const content = document.querySelector('[aria-label="Custom dialog label"]');
    expect(content).not.toBeNull();
  });
});
