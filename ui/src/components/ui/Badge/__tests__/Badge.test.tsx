// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { Badge } from "../Badge";

describe("Badge", () => {
  it("renders count", () => {
    render(<Badge count={5} />);
    expect(screen.getByText("5")).not.toBeNull();
  });

  it("renders max+ when count exceeds max", () => {
    render(<Badge count={150} max={99} />);
    expect(screen.getByText("99+")).not.toBeNull();
  });

  it("respects custom max", () => {
    render(<Badge count={20} max={10} />);
    expect(screen.getByText("10+")).not.toBeNull();
  });

  it("renders text label", () => {
    render(<Badge text="new" />);
    expect(screen.getByText("new")).not.toBeNull();
  });

  it("renders dot mode with no text", () => {
    const { container } = render(<Badge dot count={5} />);
    expect(container.firstChild).toHaveClass("gc-badge--dot");
    expect(container.firstChild?.textContent).toBe("");
  });

  it("applies variant class", () => {
    const { container } = render(<Badge count={1} variant="danger" />);
    expect(container.firstChild).toHaveClass("gc-badge--danger");
  });

  it("applies size class", () => {
    const { container } = render(<Badge count={1} size="small" />);
    expect(container.firstChild).toHaveClass("gc-badge--small");
  });
});
