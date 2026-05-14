// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { Select } from "../Select";

const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma", disabled: true },
];

describe("Select", () => {
  it("renders trigger with placeholder when no value", () => {
    render(
      <Select
        options={OPTIONS}
        placeholder="Pick one"
        data-testid="sel"
      />,
    );
    expect(screen.getByTestId("sel")).toBeInTheDocument();
    expect(screen.getByText("Pick one")).toBeInTheDocument();
  });

  it("renders trigger with selected label", () => {
    render(
      <Select
        options={OPTIONS}
        value="b"
        onValueChange={vi.fn()}
        data-testid="sel"
      />,
    );
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("trigger is disabled when disabled prop is set", () => {
    render(
      <Select options={OPTIONS} disabled data-testid="sel" />,
    );
    expect(screen.getByTestId("sel")).toHaveAttribute("data-disabled");
  });

  it("opens dropdown on click", () => {
    render(
      <Select options={OPTIONS} placeholder="Pick" data-testid="sel" />,
    );
    fireEvent.click(screen.getByTestId("sel"));
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("applies error variant class", () => {
    render(
      <Select options={OPTIONS} variant="error" data-testid="sel" />,
    );
    expect(screen.getByTestId("sel")).toHaveClass("gc-select-trigger--error");
  });

  it("applies size class", () => {
    render(
      <Select options={OPTIONS} size="large" data-testid="sel" />,
    );
    expect(screen.getByTestId("sel")).toHaveClass("gc-select-trigger--large");
  });

  it("shows search input when searchable=true and opened", () => {
    render(
      <Select options={OPTIONS} searchable placeholder="Pick" data-testid="sel" />,
    );
    fireEvent.click(screen.getByTestId("sel"));
    expect(screen.getByRole("textbox", { name: /search/i })).toBeInTheDocument();
  });

  it("logs error when multi=true", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<Select options={OPTIONS} multi data-testid="sel" />);
    expect(spy).toHaveBeenCalledWith(
      "[Select] multi is not yet supported (TODO)",
    );
    spy.mockRestore();
  });
});
