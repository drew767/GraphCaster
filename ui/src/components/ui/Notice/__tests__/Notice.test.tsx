// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { Notice } from "../Notice";

describe("Notice", () => {
  it("renders children text", () => {
    render(<Notice type="info">Check your input</Notice>);
    expect(screen.getByText("Check your input")).not.toBeNull();
  });

  it("has role=note", () => {
    render(<Notice type="warning">Warning text</Notice>);
    expect(screen.getByRole("note")).not.toBeNull();
  });

  it("shows icon by default", () => {
    const { container } = render(<Notice type="success">Good</Notice>);
    expect(container.querySelector(".gc-notice__icon")).not.toBeNull();
  });

  it("hides icon when showIcon=false", () => {
    const { container } = render(<Notice type="error" showIcon={false}>Bad</Notice>);
    expect(container.querySelector(".gc-notice__icon")).toBeNull();
  });

  it("applies type class", () => {
    const { container } = render(<Notice type="error">Err</Notice>);
    expect(container.querySelector(".gc-notice--error")).not.toBeNull();
  });

  it("applies custom className", () => {
    const { container } = render(<Notice type="info" className="my-notice">Hi</Notice>);
    expect(container.querySelector(".my-notice")).not.toBeNull();
  });
});
