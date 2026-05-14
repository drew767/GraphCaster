// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { Breadcrumbs } from "../Breadcrumbs";

const items = [
  { label: "Home", href: "/" },
  { label: "Projects", href: "/projects" },
  { label: "Graph" },
];

describe("Breadcrumbs", () => {
  it("renders all items", () => {
    render(<Breadcrumbs items={items} />);
    expect(screen.getByText("Home")).not.toBeNull();
    expect(screen.getByText("Projects")).not.toBeNull();
    expect(screen.getByText("Graph")).not.toBeNull();
  });

  it("marks last item as current page", () => {
    render(<Breadcrumbs items={items} />);
    expect(screen.getByText("Graph").closest("[aria-current='page']")).not.toBeNull();
  });

  it("renders links for non-last items with href", () => {
    render(<Breadcrumbs items={items} />);
    const homeLink = screen.getByText("Home").closest("a");
    expect(homeLink?.getAttribute("href")).toBe("/");
  });

  it("renders button for non-last items without href", () => {
    const clickItems = [
      { label: "Home", onClick: vi.fn() },
      { label: "End" },
    ];
    render(<Breadcrumbs items={clickItems} />);
    expect(screen.getByRole("button", { name: "Home" })).not.toBeNull();
  });

  it("calls onClick on link click", () => {
    const onClick = vi.fn();
    render(
      <Breadcrumbs
        items={[{ label: "Home", href: "/", onClick }, { label: "End" }]}
      />
    );
    fireEvent.click(screen.getByText("Home"));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("collapses middle items with ellipsis when maxItems is set", () => {
    const manyItems = [
      { label: "A", href: "/" },
      { label: "B", href: "/b" },
      { label: "C", href: "/c" },
      { label: "D", href: "/d" },
      { label: "E" },
    ];
    const { container } = render(
      <Breadcrumbs items={manyItems} maxItems={3} />
    );
    expect(container.querySelector(".gc-breadcrumbs__ellipsis")).not.toBeNull();
  });

  it("renders custom separator", () => {
    render(<Breadcrumbs items={items} separator={<span>/</span>} />);
    expect(screen.getAllByText("/").length).toBeGreaterThan(0);
  });
});
