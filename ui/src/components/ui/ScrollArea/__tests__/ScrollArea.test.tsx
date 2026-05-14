// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { ScrollArea } from "../ScrollArea";

describe("ScrollArea", () => {
  it("renders children inside the viewport", () => {
    render(
      <ScrollArea>
        <p>Scroll content</p>
      </ScrollArea>,
    );
    expect(screen.getByText("Scroll content")).toBeInTheDocument();
  });

  it("applies custom className to root", () => {
    const { container } = render(
      <ScrollArea className="my-scroll">
        <p>Content</p>
      </ScrollArea>,
    );
    expect(container.querySelector(".gc-scroll-area.my-scroll")).toBeInTheDocument();
  });

  it("applies maxHeight as inline style when provided as number", () => {
    const { container } = render(
      <ScrollArea maxHeight={300}>
        <p>Content</p>
      </ScrollArea>,
    );
    const root = container.querySelector(".gc-scroll-area") as HTMLElement;
    expect(root.style.maxHeight).toBe("300px");
  });

  it("applies maxHeight as inline style when provided as string", () => {
    const { container } = render(
      <ScrollArea maxHeight="50vh">
        <p>Content</p>
      </ScrollArea>,
    );
    const root = container.querySelector(".gc-scroll-area") as HTMLElement;
    expect(root.style.maxHeight).toBe("50vh");
  });

  it("applies scrollbar size modifier class", () => {
    const { container } = render(
      <ScrollArea scrollbarSize="thin">
        <p>Content</p>
      </ScrollArea>,
    );
    expect(
      container.querySelector(".gc-scroll-area--scrollbar-thin"),
    ).toBeInTheDocument();
  });
});
