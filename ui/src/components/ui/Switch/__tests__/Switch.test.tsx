// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { Switch } from "../Switch";

describe("Switch", () => {
  it("renders the switch button", () => {
    render(<Switch data-testid="sw" />);
    expect(screen.getByTestId("sw")).toBeInTheDocument();
  });

  it("renders label when provided", () => {
    render(<Switch label="Enable notifications" />);
    expect(screen.getByText("Enable notifications")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(<Switch description="Receive push notifications" />);
    expect(screen.getByText("Receive push notifications")).toBeInTheDocument();
  });

  it("shows checked state", () => {
    render(
      <Switch checked onCheckedChange={vi.fn()} data-testid="sw" />,
    );
    expect(screen.getByTestId("sw")).toHaveAttribute("data-state", "checked");
  });

  it("shows unchecked state", () => {
    render(
      <Switch checked={false} onCheckedChange={vi.fn()} data-testid="sw" />,
    );
    expect(screen.getByTestId("sw")).toHaveAttribute("data-state", "unchecked");
  });

  it("calls onCheckedChange when clicked", () => {
    const onChange = vi.fn();
    render(
      <Switch checked={false} onCheckedChange={onChange} data-testid="sw" />,
    );
    fireEvent.click(screen.getByTestId("sw"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("is disabled when disabled prop set", () => {
    render(<Switch disabled data-testid="sw" />);
    expect(screen.getByTestId("sw")).toBeDisabled();
  });

  it("applies medium size class by default", () => {
    render(<Switch data-testid="sw" />);
    expect(screen.getByTestId("sw")).toHaveClass("gc-switch-track--medium");
  });

  it("applies large size class", () => {
    render(<Switch size="large" data-testid="sw" />);
    expect(screen.getByTestId("sw")).toHaveClass("gc-switch-track--large");
  });

  it("applies small size class", () => {
    render(<Switch size="small" data-testid="sw" />);
    expect(screen.getByTestId("sw")).toHaveClass("gc-switch-track--small");
  });

  it("has displayName", () => {
    expect(Switch.displayName).toBe("Switch");
  });
});
