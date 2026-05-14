// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { Input } from "../Input";

describe("Input", () => {
  it("renders a text input by default", () => {
    render(<Input data-testid="inp" />);
    expect(screen.getByTestId("inp")).toBeInTheDocument();
  });

  it("applies size class", () => {
    render(<Input data-testid="inp" size="large" />);
    expect(screen.getByTestId("inp")).toHaveClass("gc-input--large");
  });

  it("applies default size medium", () => {
    render(<Input data-testid="inp" />);
    expect(screen.getByTestId("inp")).toHaveClass("gc-input--medium");
  });

  it("applies error variant class", () => {
    render(<Input data-testid="inp" variant="error" />);
    expect(screen.getByTestId("inp")).toHaveClass("gc-input--error");
  });

  it("applies success variant class", () => {
    render(<Input data-testid="inp" variant="success" />);
    expect(screen.getByTestId("inp")).toHaveClass("gc-input--success");
  });

  it("calls onChange when user types", () => {
    const onChange = vi.fn();
    render(<Input data-testid="inp" value="" onChange={onChange} />);
    fireEvent.change(screen.getByTestId("inp"), { target: { value: "hello" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("is disabled when disabled prop set", () => {
    render(<Input data-testid="inp" disabled />);
    expect(screen.getByTestId("inp")).toBeDisabled();
  });

  it("shows clear button when clearable and value non-empty", () => {
    render(
      <Input value="foo" clearable onClear={vi.fn()} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /clear/i })).toBeInTheDocument();
  });

  it("calls onClear when clear button clicked", () => {
    const onClear = vi.fn();
    render(
      <Input value="foo" clearable onClear={onClear} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("does not show clear button when value is empty", () => {
    render(<Input value="" clearable onClear={vi.fn()} onChange={vi.fn()} />);
    expect(
      screen.queryByRole("button", { name: /clear/i }),
    ).not.toBeInTheDocument();
  });

  it("has displayName", () => {
    expect(Input.displayName).toBe("Input");
  });
});
