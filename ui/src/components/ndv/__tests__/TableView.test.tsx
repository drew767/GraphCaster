// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

import { TableView } from "../dataViews/TableView";

describe("TableView", () => {
  it("renders one row per item with union of keys", () => {
    const data = [
      { name: "Alice", age: 30 },
      { name: "Bob", city: "NYC" },
    ];
    render(<TableView data={data} />);
    // Headers
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("age")).toBeInTheDocument();
    expect(screen.getByText("city")).toBeInTheDocument();
    // Row values
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("NYC")).toBeInTheDocument();
  });

  it("wraps single object as one row", () => {
    render(<TableView data={{ k: "v" }} />);
    expect(screen.getByText("k")).toBeInTheDocument();
    expect(screen.getByText("v")).toBeInTheDocument();
  });
});
