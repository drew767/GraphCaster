// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { CircleLoader } from "../CircleLoader";

describe("CircleLoader", () => {
  it("renders an SVG", () => {
    const { container } = render(<CircleLoader />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("has role=status", () => {
    render(<CircleLoader />);
    expect(screen.getByRole("status")).not.toBeNull();
  });

  it("defaults to label 'Loading'", () => {
    render(<CircleLoader />);
    expect(screen.getByLabelText("Loading")).not.toBeNull();
  });

  it("accepts custom label", () => {
    render(<CircleLoader label="Fetching data" />);
    expect(screen.getByLabelText("Fetching data")).not.toBeNull();
  });

  it("renders two circles (track + arc)", () => {
    const { container } = render(<CircleLoader />);
    const circles = container.querySelectorAll("circle");
    expect(circles.length).toBe(2);
  });

  it("applies numeric size as px dimensions", () => {
    const { container } = render(<CircleLoader size={48} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("48px");
    expect(svg?.getAttribute("height")).toBe("48px");
  });
});
