// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { RadioGroup } from "../RadioGroup";

const OPTIONS = [
  { value: "a", label: "Apple" },
  { value: "b", label: "Banana" },
  { value: "c", label: "Cherry", description: "A small red fruit", disabled: true },
];

describe("RadioGroup", () => {
  it("renders all options", () => {
    render(<RadioGroup options={OPTIONS} data-testid="rg" />);
    expect(screen.getByText("Apple")).toBeInTheDocument();
    expect(screen.getByText("Banana")).toBeInTheDocument();
    expect(screen.getByText("Cherry")).toBeInTheDocument();
  });

  it("renders description text when provided", () => {
    render(<RadioGroup options={OPTIONS} />);
    expect(screen.getByText("A small red fruit")).toBeInTheDocument();
  });

  it("shows selected item", () => {
    render(
      <RadioGroup
        options={OPTIONS}
        value="b"
        onValueChange={vi.fn()}
        data-testid="rg"
      />,
    );
    const banana = screen.getByRole("radio", { name: "Banana" });
    expect(banana).toHaveAttribute("data-state", "checked");
  });

  it("calls onValueChange when option clicked", () => {
    const onChange = vi.fn();
    render(
      <RadioGroup options={OPTIONS} onValueChange={onChange} data-testid="rg" />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Apple" }));
    expect(onChange).toHaveBeenCalledWith("a");
  });

  it("disabled option cannot be clicked", () => {
    const onChange = vi.fn();
    render(
      <RadioGroup options={OPTIONS} onValueChange={onChange} />,
    );
    const cherry = screen.getByRole("radio", { name: "Cherry" });
    expect(cherry).toBeDisabled();
  });

  it("whole group is disabled when disabled=true", () => {
    render(<RadioGroup options={OPTIONS} disabled data-testid="rg" />);
    const radios = screen.getAllByRole("radio");
    radios.forEach((r) => expect(r).toBeDisabled());
  });

  it("applies horizontal orientation class", () => {
    render(
      <RadioGroup options={OPTIONS} orientation="horizontal" data-testid="rg" />,
    );
    expect(screen.getByTestId("rg")).toHaveClass("gc-radio-group--horizontal");
  });

  it("applies vertical orientation class by default", () => {
    render(<RadioGroup options={OPTIONS} data-testid="rg" />);
    expect(screen.getByTestId("rg")).toHaveClass("gc-radio-group--vertical");
  });
});
