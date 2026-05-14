// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { Pill } from "../Pill";

describe("Pill", () => {
  it("renders children", () => {
    render(<Pill>Active</Pill>);
    expect(screen.getByText("Active")).not.toBeNull();
  });

  it("has pill border-radius via css class", () => {
    const { container } = render(<Pill>Active</Pill>);
    expect(container.firstChild).toHaveClass("gc-pill");
  });

  it("applies variant class", () => {
    const { container } = render(<Pill variant="warning">warn</Pill>);
    expect(container.firstChild).toHaveClass("gc-pill--warning");
  });

  it("applies size class", () => {
    const { container } = render(<Pill size="small">sm</Pill>);
    expect(container.firstChild).toHaveClass("gc-pill--small");
  });

  it("renders dot indicator when dot=true", () => {
    const { container } = render(<Pill dot>Online</Pill>);
    expect(container.querySelector(".gc-pill__dot")).not.toBeNull();
  });

  it("renders icon when icon prop provided and dot=false", () => {
    const { container } = render(<Pill icon="check">ok</Pill>);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders all variants without crashing", () => {
    const variants = [
      "default",
      "primary",
      "success",
      "warning",
      "danger",
      "info",
    ] as const;
    for (const v of variants) {
      const { container } = render(<Pill variant={v}>{v}</Pill>);
      expect(container.firstChild).not.toBeNull();
    }
  });
});
