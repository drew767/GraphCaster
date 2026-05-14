// Copyright GraphCaster. All Rights Reserved.

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Card } from "./Card";

describe("Card", () => {
  it("renders children", () => {
    render(
      <Card>
        <Card.Body>Hello</Card.Body>
      </Card>,
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("renders Header with title and actions", () => {
    render(
      <Card>
        <Card.Header title="My Title" actions={<button>Act</button>} />
        <Card.Body>body</Card.Body>
      </Card>,
    );
    expect(screen.getByText("My Title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Act" })).toBeInTheDocument();
  });

  it("renders Footer slot", () => {
    render(
      <Card>
        <Card.Body>body</Card.Body>
        <Card.Footer>Footer text</Card.Footer>
      </Card>,
    );
    expect(screen.getByText("Footer text")).toBeInTheDocument();
  });

  it("applies variant class", () => {
    const { container } = render(<Card variant="elevated">content</Card>);
    expect(container.firstChild).toHaveClass("gc-card--elevated");
  });

  it("applies padding class", () => {
    const { container } = render(<Card padding="large">content</Card>);
    expect(container.firstChild).toHaveClass("gc-card--padding-large");
  });

  it("adds hoverable class and calls onClick", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Card hoverable onClick={onClick}>
        clickable
      </Card>,
    );
    expect(container.firstChild).toHaveClass("gc-card--hoverable");
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
