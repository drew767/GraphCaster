// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { InputNumber } from "../InputNumber";

describe("InputNumber", () => {
  it("renders a number input", () => {
    render(<InputNumber data-testid="inp" />);
    expect(screen.getByTestId("inp")).toHaveAttribute("type", "number");
  });

  it("shows current value", () => {
    render(<InputNumber value={42} onChange={vi.fn()} data-testid="inp" />);
    expect(screen.getByTestId("inp")).toHaveValue(42);
  });

  it("calls onChange with parsed number on change", () => {
    const onChange = vi.fn();
    render(<InputNumber value={0} onChange={onChange} data-testid="inp" />);
    fireEvent.change(screen.getByTestId("inp"), { target: { value: "7" } });
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("calls onChange with null on empty input", () => {
    const onChange = vi.fn();
    render(<InputNumber value={5} onChange={onChange} data-testid="inp" />);
    fireEvent.change(screen.getByTestId("inp"), { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("is disabled when disabled prop is set", () => {
    render(<InputNumber data-testid="inp" disabled />);
    expect(screen.getByTestId("inp")).toBeDisabled();
  });

  it("renders stepper buttons by default", () => {
    render(<InputNumber />);
    expect(
      screen.getByRole("button", { name: /increment/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /decrement/i }),
    ).toBeInTheDocument();
  });

  it("does not render stepper buttons when showButtons=false", () => {
    render(<InputNumber showButtons={false} />);
    expect(
      screen.queryByRole("button", { name: /increment/i }),
    ).not.toBeInTheDocument();
  });

  it("increment button calls onChange with value+step", () => {
    const onChange = vi.fn();
    render(
      <InputNumber value={3} step={2} onChange={onChange} showButtons />,
    );
    fireEvent.click(screen.getByRole("button", { name: /increment/i }));
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("decrement button calls onChange with value-step", () => {
    const onChange = vi.fn();
    render(
      <InputNumber value={10} step={3} onChange={onChange} showButtons />,
    );
    fireEvent.click(screen.getByRole("button", { name: /decrement/i }));
    expect(onChange).toHaveBeenCalledWith(7);
  });

  it("clamps increment to max", () => {
    const onChange = vi.fn();
    render(
      <InputNumber value={9} max={10} step={5} onChange={onChange} showButtons />,
    );
    fireEvent.click(screen.getByRole("button", { name: /increment/i }));
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it("has displayName", () => {
    expect(InputNumber.displayName).toBe("InputNumber");
  });
});
