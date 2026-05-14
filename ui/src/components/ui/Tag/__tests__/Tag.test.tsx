// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { Tag } from "../Tag";

describe("Tag", () => {
  it("renders children", () => {
    render(<Tag>Label</Tag>);
    expect(screen.getByText("Label")).not.toBeNull();
  });

  it("applies variant class", () => {
    const { container } = render(<Tag variant="success">ok</Tag>);
    expect(container.firstChild).toHaveClass("gc-tag--success");
  });

  it("applies size class", () => {
    const { container } = render(<Tag size="small">sm</Tag>);
    expect(container.firstChild).toHaveClass("gc-tag--small");
  });

  it("renders close button when closable", () => {
    render(<Tag closable>x</Tag>);
    expect(screen.getByRole("button", { name: /remove/i })).not.toBeNull();
  });

  it("calls onClose when close button clicked", () => {
    const onClose = vi.fn();
    render(
      <Tag closable onClose={onClose}>
        x
      </Tag>
    );
    fireEvent.click(screen.getByRole("button", { name: /remove/i }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders icon when icon prop is provided", () => {
    const { container } = render(<Tag icon="check">done</Tag>);
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
      const { container } = render(<Tag variant={v}>{v}</Tag>);
      expect(container.firstChild).not.toBeNull();
    }
  });
});
