// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";

import { InfoTip } from "../InfoTip";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe("InfoTip", () => {
  it("renders an icon trigger", () => {
    const { container } = render(<InfoTip>Tip text</InfoTip>);
    expect(container.querySelector(".gc-infotip")).not.toBeNull();
  });

  it("renders an SVG icon", () => {
    const { container } = render(<InfoTip>Info</InfoTip>);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("has aria-label on the trigger", () => {
    render(<InfoTip>Help</InfoTip>);
    expect(screen.getByRole("button", { name: /more information/i })).not.toBeNull();
  });

  it("accepts a custom icon name", () => {
    const { container } = render(<InfoTip icon="circle-help">Help</InfoTip>);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("accepts custom iconSize without throwing", () => {
    const { container } = render(<InfoTip iconSize={20}>Sized</InfoTip>);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("20px");
  });

  it("renders children as tooltip content — children are React nodes", () => {
    const { container } = render(<InfoTip><span data-testid="tip">Detailed</span></InfoTip>);
    expect(container.querySelector(".gc-infotip")).not.toBeNull();
  });
});
