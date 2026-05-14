// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { Icon } from "../Icon";

describe("Icon", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a known Lucide icon with default size", () => {
    const { container } = render(<Icon name="circle-alert" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("width")).toBe("16px");
    expect(svg?.getAttribute("height")).toBe("16px");
  });

  it("renders with numeric size", () => {
    const { container } = render(<Icon name="circle-alert" size={24} />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("24px");
    expect(svg?.getAttribute("height")).toBe("24px");
  });

  it("renders with string size", () => {
    const { container } = render(<Icon name="circle-alert" size="2rem" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("2rem");
    expect(svg?.getAttribute("height")).toBe("2rem");
  });

  it("renders a custom SVG icon (node-success)", () => {
    const { container } = render(<Icon name="node-success" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
  });

  it("is aria-hidden by default (decorative)", () => {
    const { container } = render(<Icon name="check" />);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });

  it("sets aria-label when provided and removes aria-hidden", () => {
    render(<Icon name="check" ariaLabel="Done" />);
    const svg = screen.getByLabelText("Done");
    expect(svg).not.toBeNull();
    expect(svg.getAttribute("aria-hidden")).toBeNull();
  });

  it("returns null for unknown icon name and logs warning in dev", () => {
    vi.stubEnv("NODE_ENV", "development");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { container } = render(
      <Icon name={"not-an-icon" as Parameters<typeof Icon>[0]["name"]} />
    );
    expect(container.firstChild).toBeNull();
    expect(warn).toHaveBeenCalledWith("[Icon] unknown icon: not-an-icon");

    vi.unstubAllEnvs();
  });

  it("does not log warning for unknown icon in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(
      <Icon name={"not-an-icon" as Parameters<typeof Icon>[0]["name"]} />
    );
    expect(warn).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });
});
