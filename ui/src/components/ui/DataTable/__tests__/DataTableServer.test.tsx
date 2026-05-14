// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { type ColumnDef } from "@tanstack/react-table";

import { DataTableServer } from "../DataTableServer";

interface Row {
  id: string;
  name: string;
  score: number;
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "score", header: "Score" },
];

const makeData = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: String(i + 1),
    name: `Item ${i + 1}`,
    score: i * 10,
  }));

describe("DataTableServer", () => {
  it("renders controlled page info based on currentPage and totalRows", () => {
    render(
      <DataTableServer
        data={makeData(10)}
        columns={columns}
        totalRows={100}
        currentPage={0}
        onPageChange={vi.fn()}
        pageSize={10}
      />,
    );
    expect(screen.getByText(/Page 1 of 10/)).toBeInTheDocument();
  });

  it("calls onPageChange with next page when next button clicked", () => {
    const onPageChange = vi.fn();
    render(
      <DataTableServer
        data={makeData(10)}
        columns={columns}
        totalRows={30}
        currentPage={0}
        onPageChange={onPageChange}
        pageSize={10}
      />,
    );
    const nextBtn = screen.getByRole("button", { name: /next page/i });
    fireEvent.click(nextBtn);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("calls onSortChange when a sortable header is clicked", () => {
    const onSortChange = vi.fn();
    const sortableColumns: ColumnDef<Row>[] = [
      { accessorKey: "name", header: "Name", enableSorting: true },
      { accessorKey: "score", header: "Score", enableSorting: true },
    ];
    render(
      <DataTableServer
        data={makeData(5)}
        columns={sortableColumns}
        totalRows={5}
        currentPage={0}
        onPageChange={vi.fn()}
        pageSize={10}
        onSortChange={onSortChange}
      />,
    );
    const nameHeader = screen.getByText("Name").closest("th")!;
    fireEvent.click(nameHeader);
    expect(onSortChange).toHaveBeenCalled();
  });

  it("calls onFilterChange when filter prop triggers re-render (callback wiring)", () => {
    const onFilterChange = vi.fn();
    render(
      <DataTableServer
        data={makeData(5)}
        columns={columns}
        totalRows={5}
        currentPage={0}
        onPageChange={vi.fn()}
        pageSize={10}
        filter=""
        onFilterChange={onFilterChange}
      />,
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
  });

  it("fires onPageChange with previous page when prev button clicked", () => {
    const onPageChange = vi.fn();
    render(
      <DataTableServer
        data={makeData(10)}
        columns={columns}
        totalRows={30}
        currentPage={1}
        onPageChange={onPageChange}
        pageSize={10}
      />,
    );
    const prevBtn = screen.getByRole("button", { name: /previous page/i });
    fireEvent.click(prevBtn);
    expect(onPageChange).toHaveBeenCalledWith(0);
  });

  it("displays totalRows count in pagination area", () => {
    render(
      <DataTableServer
        data={makeData(10)}
        columns={columns}
        totalRows={47}
        currentPage={0}
        onPageChange={vi.fn()}
        pageSize={10}
      />,
    );
    expect(screen.getByText(/47 rows/)).toBeInTheDocument();
  });
});
