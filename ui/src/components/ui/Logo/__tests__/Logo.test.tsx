// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Logo } from "../Logo";

describe("Logo", () => {
  it("renders icon variant: SVG present, no wordmark text", () => {
    render(<Logo variant="icon" />);
    expect(screen.getByTestId("gc-logo-glyph")).toBeInTheDocument();
    expect(screen.queryByTestId("gc-logo-wordmark")).not.toBeInTheDocument();
  });

  it("renders wordmark variant: text 'GraphCaster' present, no glyph", () => {
    render(<Logo variant="wordmark" />);
    expect(screen.getByTestId("gc-logo-wordmark")).toBeInTheDocument();
    expect(screen.getByText("GraphCaster")).toBeInTheDocument();
    expect(screen.queryByTestId("gc-logo-glyph")).not.toBeInTheDocument();
  });

  it("renders full variant: both glyph and wordmark present", () => {
    render(<Logo variant="full" />);
    expect(screen.getByTestId("gc-logo-glyph")).toBeInTheDocument();
    expect(screen.getByTestId("gc-logo-wordmark")).toBeInTheDocument();
    expect(screen.getByText("GraphCaster")).toBeInTheDocument();
  });

  it("defaults to full variant when variant is omitted", () => {
    render(<Logo />);
    expect(screen.getByTestId("gc-logo-glyph")).toBeInTheDocument();
    expect(screen.getByTestId("gc-logo-wordmark")).toBeInTheDocument();
  });

  it("applies custom size to the glyph wrapper", () => {
    render(<Logo variant="icon" size={48} />);
    const glyph = screen.getByTestId("gc-logo-glyph");
    expect(glyph).toHaveStyle({ width: "48px", height: "48px" });
  });

  it("propagates className to the root element", () => {
    render(<Logo className="my-custom-class" />);
    const root = screen.getByTestId("gc-logo");
    expect(root).toHaveClass("my-custom-class");
  });

  it("renders an SVG element inside the glyph", () => {
    const { container } = render(<Logo variant="icon" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("uses size=24 by default", () => {
    render(<Logo variant="icon" />);
    const glyph = screen.getByTestId("gc-logo-glyph");
    expect(glyph).toHaveStyle({ width: "24px", height: "24px" });
  });
});
