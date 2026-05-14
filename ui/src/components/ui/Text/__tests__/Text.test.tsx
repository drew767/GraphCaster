// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { Text } from "../Text";

describe("Text", () => {
  it("renders as <p> by default", () => {
    const { container } = render(<Text>Hello</Text>);
    expect(container.querySelector("p")).not.toBeNull();
  });

  it("renders as custom tag", () => {
    const { container } = render(<Text as="span">Label</Text>);
    expect(container.querySelector("span")).not.toBeNull();
  });

  it("applies size class", () => {
    const { container } = render(<Text size="sm">Small</Text>);
    expect(container.querySelector(".gc-text--sm")).not.toBeNull();
  });

  it("applies color class", () => {
    const { container } = render(<Text color="danger">Error text</Text>);
    expect(container.querySelector(".gc-text--danger")).not.toBeNull();
  });

  it("applies truncate class for boolean truncate", () => {
    const { container } = render(<Text truncate>Long text</Text>);
    expect(container.querySelector(".gc-text--truncate")).not.toBeNull();
  });

  it("applies clamp class and inline style for numeric truncate", () => {
    const { container } = render(<Text truncate={3}>Three lines max</Text>);
    const el = container.querySelector(".gc-text--clamp") as HTMLElement | null;
    expect(el).not.toBeNull();
    expect(el?.style.webkitLineClamp).toBe("3");
  });

  it("renders children text", () => {
    render(<Text>Content here</Text>);
    expect(screen.getByText("Content here")).not.toBeNull();
  });
});
