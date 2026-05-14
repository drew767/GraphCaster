// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { Callout } from "../Callout";

describe("Callout", () => {
  it("renders title", () => {
    render(<Callout type="info" title="Note" />);
    expect(screen.getByText("Note")).not.toBeNull();
  });

  it("renders children content", () => {
    render(<Callout type="warning">Read carefully</Callout>);
    expect(screen.getByText("Read carefully")).not.toBeNull();
  });

  it("shows icon by default", () => {
    const { container } = render(<Callout type="success" title="OK" />);
    expect(container.querySelector(".gc-callout__icon")).not.toBeNull();
  });

  it("hides icon when showIcon=false", () => {
    const { container } = render(<Callout type="error" showIcon={false} title="Err" />);
    expect(container.querySelector(".gc-callout__icon")).toBeNull();
  });

  it("applies type class for border-left styling", () => {
    const { container } = render(<Callout type="error" title="Err" />);
    expect(container.querySelector(".gc-callout--error")).not.toBeNull();
  });

  it("renders both title and children together", () => {
    render(<Callout type="info" title="Header">Body text here</Callout>);
    expect(screen.getByText("Header")).not.toBeNull();
    expect(screen.getByText("Body text here")).not.toBeNull();
  });
});
