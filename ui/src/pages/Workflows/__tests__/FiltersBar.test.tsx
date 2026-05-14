// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Workflows } from "../Workflows";
import { makeWorkflow, seedWorkflowsStore } from "./testHelpers";

describe("FiltersBar", () => {
  beforeEach(() => {
    seedWorkflowsStore({
      tags: ["alpha", "beta"],
      workflows: [
        makeWorkflow({ id: "a1", name: "Alpha", status: "active", tags: ["alpha"] }),
        makeWorkflow({ id: "a2", name: "Beta", status: "inactive", tags: ["beta"] }),
        makeWorkflow({ id: "a3", name: "Gamma", status: "active", tags: [] }),
      ],
    });
  });

  it("status filter narrows visible cards", () => {
    render(<Workflows initialSearch="" />);
    expect(screen.getByTestId("workflow-card-a1")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-card-a2")).toBeInTheDocument();
    expect(screen.getByTestId("workflow-card-a3")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("filter-status"), { target: { value: "active" } });
    expect(screen.getByTestId("workflow-card-a1")).toBeInTheDocument();
    expect(screen.queryByTestId("workflow-card-a2")).toBeNull();
    expect(screen.getByTestId("workflow-card-a3")).toBeInTheDocument();
  });

  it("tag chip toggles state and clear filters resets", () => {
    render(<Workflows initialSearch="" />);
    fireEvent.click(screen.getByTestId("filter-tags-toggle"));
    fireEvent.click(screen.getByTestId("filter-tag-alpha"));
    expect(screen.getByTestId("workflow-card-a1")).toBeInTheDocument();
    expect(screen.queryByTestId("workflow-card-a2")).toBeNull();
    expect(screen.queryByTestId("workflow-card-a3")).toBeNull();
    // toggle off
    fireEvent.click(screen.getByTestId("filter-tag-alpha"));
    expect(screen.getByTestId("workflow-card-a2")).toBeInTheDocument();
    // now apply alpha then clear
    fireEvent.click(screen.getByTestId("filter-tag-alpha"));
    expect(screen.queryByTestId("workflow-card-a2")).toBeNull();
    fireEvent.click(screen.getByTestId("filters-clear"));
    expect(screen.getByTestId("workflow-card-a2")).toBeInTheDocument();
  });

  it("search filter matches name", () => {
    render(<Workflows initialSearch="" />);
    fireEvent.change(screen.getByTestId("filter-search"), { target: { value: "gamm" } });
    expect(screen.queryByTestId("workflow-card-a1")).toBeNull();
    expect(screen.getByTestId("workflow-card-a3")).toBeInTheDocument();
  });
});
