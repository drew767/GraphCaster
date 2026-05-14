// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { Alert } from "../Alert";

describe("Alert", () => {
  it("renders with role=alert", () => {
    render(<Alert type="info" title="Hello" />);
    expect(screen.getByRole("alert")).not.toBeNull();
  });

  it("renders title and description", () => {
    render(<Alert type="success" title="Done" description="All good" />);
    expect(screen.getByText("Done")).not.toBeNull();
    expect(screen.getByText("All good")).not.toBeNull();
  });

  it("shows icon by default", () => {
    const { container } = render(<Alert type="error" title="Oops" />);
    expect(container.querySelector(".gc-alert__icon")).not.toBeNull();
  });

  it("hides icon when showIcon=false", () => {
    const { container } = render(<Alert type="warning" title="Warn" showIcon={false} />);
    expect(container.querySelector(".gc-alert__icon")).toBeNull();
  });

  it("renders close button when closable and calls onClose", () => {
    const onClose = vi.fn();
    render(<Alert type="info" title="Note" closable onClose={onClose} />);
    const btn = screen.getByRole("button", { name: /dismiss/i });
    expect(btn).not.toBeNull();
    fireEvent.click(btn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("applies variant class", () => {
    const { container } = render(<Alert type="success" variant="filled" title="OK" />);
    expect(container.querySelector(".gc-alert--filled")).not.toBeNull();
  });

  it("renders action slot", () => {
    render(
      <Alert type="warning" title="Watch out" action={<button>Undo</button>} />
    );
    expect(screen.getByText("Undo")).not.toBeNull();
  });

  it("applies data-type attribute", () => {
    const { container } = render(<Alert type="error" title="Error" />);
    expect(container.querySelector("[data-type='error']")).not.toBeNull();
  });
});
