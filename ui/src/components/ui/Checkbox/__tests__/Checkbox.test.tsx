// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { Checkbox } from "../Checkbox";

describe("Checkbox", () => {
  it("renders a checkbox button", () => {
    render(<Checkbox data-testid="cb" />);
    expect(screen.getByTestId("cb")).toBeInTheDocument();
  });

  it("renders label text when label prop provided", () => {
    render(<Checkbox label="Accept terms" />);
    expect(screen.getByText("Accept terms")).toBeInTheDocument();
  });

  it("renders description text", () => {
    render(<Checkbox description="By checking this you agree." />);
    expect(screen.getByText("By checking this you agree.")).toBeInTheDocument();
  });

  it("is disabled when disabled prop set", () => {
    render(<Checkbox disabled data-testid="cb" />);
    expect(screen.getByTestId("cb")).toBeDisabled();
  });

  it("applies checked state", () => {
    render(<Checkbox checked onCheckedChange={vi.fn()} data-testid="cb" />);
    expect(screen.getByTestId("cb")).toHaveAttribute("data-state", "checked");
  });

  it("calls onCheckedChange when toggled", () => {
    const onChange = vi.fn();
    render(
      <Checkbox checked={false} onCheckedChange={onChange} data-testid="cb" />,
    );
    fireEvent.click(screen.getByTestId("cb"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("shows indeterminate state", () => {
    render(
      <Checkbox
        checked="indeterminate"
        onCheckedChange={vi.fn()}
        data-testid="cb"
      />,
    );
    expect(screen.getByTestId("cb")).toHaveAttribute(
      "data-state",
      "indeterminate",
    );
  });

  it("applies medium size class by default", () => {
    render(<Checkbox data-testid="cb" />);
    expect(screen.getByTestId("cb")).toHaveClass("gc-checkbox-box--medium");
  });

  it("applies large size class", () => {
    render(<Checkbox size="large" data-testid="cb" />);
    expect(screen.getByTestId("cb")).toHaveClass("gc-checkbox-box--large");
  });

  it("has displayName", () => {
    expect(Checkbox.displayName).toBe("Checkbox");
  });
});
