// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Workflows } from "../Workflows";
import { makeWorkflow, seedWorkflowsStore } from "./testHelpers";

describe("Sort dropdown", () => {
  beforeEach(() => {
    if (typeof localStorage !== "undefined") localStorage.clear();
    seedWorkflowsStore({
      workflows: [
        makeWorkflow({ id: "s1", name: "Cherry", updatedAt: 100 }),
        makeWorkflow({ id: "s2", name: "Apple", updatedAt: 300 }),
        makeWorkflow({ id: "s3", name: "Banana", updatedAt: 200 }),
      ],
    });
  });

  function listIds(): string[] {
    return Array.from(document.querySelectorAll("[data-testid^='workflow-card-']")).map((el) =>
      (el.getAttribute("data-testid") ?? "").replace("workflow-card-", ""),
    );
  }

  it("default sort is updated-desc", () => {
    render(<Workflows initialSearch="" />);
    expect(listIds()).toEqual(["s2", "s3", "s1"]);
  });

  it("name ascending reorders cards alphabetically", () => {
    render(<Workflows initialSearch="" />);
    fireEvent.change(screen.getByTestId("sort-dropdown"), { target: { value: "name-asc" } });
    expect(listIds()).toEqual(["s2", "s3", "s1"]);
  });

  it("name descending reorders cards reverse", () => {
    render(<Workflows initialSearch="" />);
    fireEvent.change(screen.getByTestId("sort-dropdown"), { target: { value: "name-desc" } });
    expect(listIds()).toEqual(["s1", "s3", "s2"]);
  });

  it("persists choice to localStorage", () => {
    render(<Workflows initialSearch="" />);
    fireEvent.change(screen.getByTestId("sort-dropdown"), { target: { value: "name-desc" } });
    expect(localStorage.getItem("gc.workflows.sort")).toBe("name-desc");
  });
});
