// Copyright GraphCaster. All Rights Reserved.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title", () => {
    render(<EmptyState title="No items found" />);
    expect(screen.getByText("No items found")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(
      <EmptyState
        title="No items"
        description="Add some items to get started."
      />,
    );
    expect(
      screen.getByText("Add some items to get started."),
    ).toBeInTheDocument();
  });

  it("renders primary action button and calls onClick", () => {
    const handleClick = vi.fn();
    render(
      <EmptyState
        title="Empty"
        action={{ label: "Create item", onClick: handleClick }}
      />,
    );
    const btn = screen.getByRole("button", { name: "Create item" });
    fireEvent.click(btn);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("renders secondary action link", () => {
    const handleClick = vi.fn();
    render(
      <EmptyState
        title="Empty"
        secondaryAction={{ label: "Browse templates", onClick: handleClick }}
      />,
    );
    const link = screen.getByRole("link", { name: "Browse templates" });
    expect(link).toBeInTheDocument();
    fireEvent.click(link);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("applies size class", () => {
    const { container } = render(<EmptyState title="Empty" size="large" />);
    expect(container.firstChild).toHaveClass("gc-empty-state--large");
  });

  it("renders custom illustration instead of icon", () => {
    render(
      <EmptyState
        title="Custom"
        illustration={<svg data-testid="custom-svg" />}
      />,
    );
    expect(screen.getByTestId("custom-svg")).toBeInTheDocument();
  });
});
