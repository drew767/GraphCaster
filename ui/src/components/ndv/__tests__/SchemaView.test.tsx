// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

import { SchemaView } from "../dataViews/SchemaView";

describe("SchemaView", () => {
  it("renders top-level keys with type chips", () => {
    render(<SchemaView data={{ name: "Alice", age: 30, active: true }} />);
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("age")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("string")).toBeInTheDocument();
    expect(screen.getByText("number")).toBeInTheDocument();
    expect(screen.getByText("boolean")).toBeInTheDocument();
  });

  it("truncates long string preview to 40 chars", () => {
    const longString = "x".repeat(80);
    render(<SchemaView data={{ msg: longString }} />);
    const preview = screen.getByText(/^"x{40}…"$/);
    expect(preview).toBeInTheDocument();
  });

  it("renders nested object on expand", () => {
    render(
      <SchemaView
        data={{
          outer: { inner: "value", count: 5 },
        }}
      />,
    );
    // outer is expandable, default expanded at depth 0
    expect(screen.getByText("outer")).toBeInTheDocument();
    // children visible
    expect(screen.getByText("inner")).toBeInTheDocument();
    expect(screen.getByText("count")).toBeInTheDocument();
  });

  it("toggles expansion on click", () => {
    render(
      <SchemaView
        data={{
          parent: { child: { deep: "v" } },
        }}
      />,
    );
    // The nested 'child' is collapsed by default (depth 1).
    // It is expandable, click to expand.
    const childRow = screen.getByTestId("schema-row-child");
    fireEvent.click(childRow);
    expect(screen.getByText("deep")).toBeInTheDocument();
  });

  it("renders empty placeholder for null", () => {
    render(<SchemaView data={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
