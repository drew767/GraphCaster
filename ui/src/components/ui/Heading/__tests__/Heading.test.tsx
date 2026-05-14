// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { Heading } from "../Heading";

describe("Heading", () => {
  it("renders default h2", () => {
    const { container } = render(<Heading>Title</Heading>);
    expect(container.querySelector("h2")).not.toBeNull();
  });

  it("renders correct semantic element for level", () => {
    const { container } = render(<Heading level={3}>Sub</Heading>);
    expect(container.querySelector("h3")).not.toBeNull();
  });

  it("applies size class independent of level", () => {
    const { container } = render(<Heading level={1} size="sm">Sm h1</Heading>);
    expect(container.querySelector(".gc-heading--sm")).not.toBeNull();
  });

  it("applies weight class", () => {
    const { container } = render(<Heading weight="medium">Mid</Heading>);
    expect(container.querySelector(".gc-heading--medium")).not.toBeNull();
  });

  it("applies color class", () => {
    const { container } = render(<Heading color="secondary">Gray</Heading>);
    expect(container.querySelector(".gc-heading--secondary")).not.toBeNull();
  });

  it("renders children text", () => {
    render(<Heading>Hello world</Heading>);
    expect(screen.getByText("Hello world")).not.toBeNull();
  });
});
