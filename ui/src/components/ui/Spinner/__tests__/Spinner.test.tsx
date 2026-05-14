// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { Spinner } from "../Spinner";

describe("Spinner", () => {
  it("renders an SVG element", () => {
    const { container } = render(<Spinner />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("has role=status for screen readers", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).not.toBeNull();
  });

  it("uses default label 'Loading'", () => {
    render(<Spinner />);
    expect(screen.getByLabelText("Loading")).not.toBeNull();
  });

  it("accepts custom label", () => {
    render(<Spinner label="Please wait" />);
    expect(screen.getByLabelText("Please wait")).not.toBeNull();
  });

  it("applies numeric size as px", () => {
    const { container } = render(<Spinner size={24} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("24px");
    expect(svg?.getAttribute("height")).toBe("24px");
  });

  it("applies string size directly", () => {
    const { container } = render(<Spinner size="2rem" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("2rem");
  });
});
