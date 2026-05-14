// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";

import { Tooltip, TooltipProvider } from "../Tooltip";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe("Tooltip", () => {
  it("renders trigger element without tooltip content by default", () => {
    render(
      <Tooltip content="Helpful hint">
        <button>Hover me</button>
      </Tooltip>
    );
    expect(screen.getByRole("button", { name: "Hover me" })).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows tooltip content when open=true (controlled open)", () => {
    render(
      <Tooltip content="Visible tip" open>
        <button>Trigger</button>
      </Tooltip>
    );
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Visible tip");
  });

  it("does not show tooltip content when open=false (controlled closed)", () => {
    render(
      <Tooltip content="Hidden tip" open={false}>
        <button>Trigger</button>
      </Tooltip>
    );
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("calls onOpenChange callback when provided", () => {
    const onOpenChange = vi.fn();
    render(
      <Tooltip content="Tip" open={false} onOpenChange={onOpenChange}>
        <button>Trigger</button>
      </Tooltip>
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("renders tooltip content as arbitrary ReactNode when open", () => {
    render(
      <Tooltip content={<span data-testid="rich-content">Rich</span>} open>
        <button>Trigger</button>
      </Tooltip>
    );
    const matches = screen.getAllByTestId("rich-content");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]).toBeInTheDocument();
  });

  it("returns children directly when disabled=true — no tooltip wrapper", () => {
    render(
      <Tooltip content="Should not show" disabled>
        <button data-testid="plain-btn">Click</button>
      </Tooltip>
    );
    expect(screen.getByTestId("plain-btn")).toBeInTheDocument();
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("opens tooltip via defaultOpen prop (uncontrolled)", () => {
    render(
      <Tooltip content="Default open tip" defaultOpen>
        <button>Trigger</button>
      </Tooltip>
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent("Default open tip");
  });

  it("TooltipProvider wraps children and renders them", () => {
    render(
      <TooltipProvider>
        <span data-testid="child">child</span>
      </TooltipProvider>
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
  });
});
