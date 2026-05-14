// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { Loading } from "../Loading";

describe("Loading", () => {
  it("renders nothing when visible=false", () => {
    const { container } = render(<Loading visible={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders when visible=true (default)", () => {
    const { container } = render(<Loading />);
    expect(container.querySelector(".gc-loading")).not.toBeNull();
  });

  it("has aria-busy=true", () => {
    const { container } = render(<Loading />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
  });

  it("renders label text", () => {
    render(<Loading label="Please wait" />);
    expect(screen.getByText("Please wait")).not.toBeNull();
  });

  it("applies fullscreen variant class", () => {
    const { container } = render(<Loading variant="fullscreen" />);
    expect(container.querySelector(".gc-loading--fullscreen")).not.toBeNull();
  });

  it("renders circle spinner variant", () => {
    const { container } = render(<Loading spinner="circle" />);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("renders dots spinner variant", () => {
    const { container } = render(<Loading spinner="dots" />);
    expect(container.querySelector(".gc-loading__dots")).not.toBeNull();
  });
});
