// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeAll } from "vitest";

import { Popover } from "../Popover";

beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

describe("Popover", () => {
  it("renders trigger without popover content by default", () => {
    render(
      <Popover trigger={<button>Open</button>}>
        <div>Popover body</div>
      </Popover>
    );
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
    expect(screen.queryByText("Popover body")).not.toBeInTheDocument();
  });

  it("shows popover content when open=true (controlled)", () => {
    render(
      <Popover trigger={<button>Open</button>} open>
        <div>Popover body</div>
      </Popover>
    );
    expect(screen.getByText("Popover body")).toBeInTheDocument();
  });

  it("hides popover content when open=false (controlled)", () => {
    render(
      <Popover trigger={<button>Open</button>} open={false}>
        <div>Popover body</div>
      </Popover>
    );
    expect(screen.queryByText("Popover body")).not.toBeInTheDocument();
  });

  it("opens popover by clicking trigger (uncontrolled)", () => {
    render(
      <Popover trigger={<button>Toggle</button>}>
        <div>Click content</div>
      </Popover>
    );
    expect(screen.queryByText("Click content")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Toggle" }));
    expect(screen.getByText("Click content")).toBeInTheDocument();
  });

  it("calls onOpenChange with true when trigger is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <Popover trigger={<button>Btn</button>} onOpenChange={onOpenChange}>
        <div>Content</div>
      </Popover>
    );
    fireEvent.click(screen.getByRole("button", { name: "Btn" }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("renders children as arbitrary ReactNode", () => {
    render(
      <Popover trigger={<button>X</button>} open>
        <ul>
          <li data-testid="item-1">One</li>
          <li data-testid="item-2">Two</li>
        </ul>
      </Popover>
    );
    expect(screen.getByTestId("item-1")).toBeInTheDocument();
    expect(screen.getByTestId("item-2")).toBeInTheDocument();
  });

  it("applies custom numeric width via style", () => {
    render(
      <Popover trigger={<button>W</button>} open width={320}>
        <div>Wide content</div>
      </Popover>
    );
    const content = screen.getByText("Wide content").closest(".gc-popover-content");
    expect(content).toHaveStyle({ width: "320px" });
  });

  it("applies custom string width via style", () => {
    render(
      <Popover trigger={<button>W</button>} open width="50vw">
        <div>Fluid content</div>
      </Popover>
    );
    const content = screen.getByText("Fluid content").closest(".gc-popover-content");
    expect(content).toHaveStyle({ width: "50vw" });
  });

  it("renders with defaultOpen showing content immediately (uncontrolled)", () => {
    render(
      <Popover trigger={<button>Btn</button>} defaultOpen>
        <div>Pre-opened</div>
      </Popover>
    );
    expect(screen.getByText("Pre-opened")).toBeInTheDocument();
  });
});
