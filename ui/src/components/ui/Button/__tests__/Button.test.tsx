// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { Button, type ButtonVariant, type ButtonSize } from "../Button";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByText("Click me")).not.toBeNull();
  });

  it("calls onClick when clicked", () => {
    const handler = vi.fn();
    render(<Button onClick={handler}>Go</Button>);
    fireEvent.click(screen.getByRole("button"));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire click when disabled", () => {
    const handler = vi.fn();
    render(
      <Button disabled onClick={handler}>
        No
      </Button>,
    );
    const btn = screen.getByRole("button");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(handler).not.toHaveBeenCalled();
  });

  it("shows spinner when loading and hides icons", () => {
    const { container } = render(
      <Button loading iconLeft="check" iconRight="x">
        Save
      </Button>,
    );
    const spinner = container.querySelector(".btn__spinner");
    expect(spinner).not.toBeNull();

    const innerIcons = container.querySelectorAll(".btn__inner:not(.btn__inner--hidden) svg");
    expect(innerIcons.length).toBe(0);
  });

  it("disables the button when loading", () => {
    render(<Button loading>Wait</Button>);
    const btn = screen.getByRole("button");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });

  it("does not fire click when loading", () => {
    const handler = vi.fn();
    render(
      <Button loading onClick={handler}>
        Busy
      </Button>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(handler).not.toHaveBeenCalled();
  });

  const variants: ButtonVariant[] = [
    "solid",
    "subtle",
    "ghost",
    "outline",
    "destructive",
    "success",
  ];

  for (const variant of variants) {
    it(`applies data-variant="${variant}"`, () => {
      render(<Button variant={variant}>v</Button>);
      const btn = screen.getByRole("button");
      expect(btn.getAttribute("data-variant")).toBe(variant);
    });
  }

  const sizes: ButtonSize[] = [
    "xmini",
    "mini",
    "xsmall",
    "small",
    "medium",
    "large",
    "xlarge",
  ];

  for (const size of sizes) {
    it(`applies data-size="${size}"`, () => {
      render(<Button size={size}>s</Button>);
      const btn = screen.getByRole("button");
      expect(btn.getAttribute("data-size")).toBe(size);
    });
  }

  it("renders iconLeft", () => {
    const { container } = render(<Button iconLeft="check">Go</Button>);
    const inner = container.querySelector(".btn__inner");
    expect(inner?.querySelector("svg")).not.toBeNull();
  });

  it("renders iconRight", () => {
    const { container } = render(<Button iconRight="arrow-right">Next</Button>);
    const inner = container.querySelector(".btn__inner");
    expect(inner?.querySelector("svg")).not.toBeNull();
  });

  it("renders with asChild using an anchor element", () => {
    const { container } = render(
      <Button asChild>
        <a href="/home">Home</a>
      </Button>,
    );
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute("href")).toBe("/home");
    expect(anchor?.classList.contains("btn")).toBe(true);
  });

  it("propagates aria-label for icon-only usage", () => {
    render(<Button aria-label="Close dialog" />);
    const btn = screen.getByRole("button", { name: "Close dialog" });
    expect(btn).not.toBeNull();
  });

  it("defaults to type=button", () => {
    render(<Button>Submit</Button>);
    const btn = screen.getByRole("button");
    expect((btn as HTMLButtonElement).type).toBe("button");
  });

  it("renders type=submit when specified", () => {
    render(<Button type="submit">Submit</Button>);
    const btn = screen.getByRole("button");
    expect((btn as HTMLButtonElement).type).toBe("submit");
  });

  it("applies btn--full-width class when fullWidth", () => {
    render(<Button fullWidth>Wide</Button>);
    const btn = screen.getByRole("button");
    expect(btn.classList.contains("btn--full-width")).toBe(true);
  });

  it("type-only: Button with onClick compiles and renders", () => {
    const handler = () => {};
    render(<Button onClick={handler} />);
    expect(screen.getByRole("button")).not.toBeNull();
  });
});
