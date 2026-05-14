// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Workflows } from "../Workflows";
import { makeWorkflow, seedWorkflowsStore } from "./testHelpers";

describe("Pagination", () => {
  beforeEach(() => {
    const items = [];
    for (let i = 0; i < 30; i++) {
      items.push(makeWorkflow({ id: `p${i}`, name: `Flow ${i}`, updatedAt: 1000 - i }));
    }
    seedWorkflowsStore({ workflows: items });
  });

  it("renders 25 items per page when perPage=25 is set", () => {
    render(<Workflows initialSearch="?perPage=25" />);
    const cards = document.querySelectorAll("[data-testid^='workflow-card-']");
    expect(cards.length).toBe(25);
  });

  it("next button advances to page 2", () => {
    render(<Workflows initialSearch="?perPage=25" />);
    expect(screen.getByTestId("pagination-page-info").textContent).toContain("1");
    fireEvent.click(screen.getByTestId("pagination-next"));
    expect(screen.getByTestId("pagination-page-info").textContent).toContain("2");
    const cards = document.querySelectorAll("[data-testid^='workflow-card-']");
    expect(cards.length).toBe(5);
  });

  it("changing per-page resets to page 1", () => {
    render(<Workflows initialSearch="?perPage=25&page=2" />);
    expect(screen.getByTestId("pagination-page-info").textContent).toContain("2");
    fireEvent.change(screen.getByTestId("pagination-per-page"), { target: { value: "50" } });
    expect(screen.getByTestId("pagination-page-info").textContent).toContain("1");
  });
});
