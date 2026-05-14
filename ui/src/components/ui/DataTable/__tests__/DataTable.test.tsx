// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { type ColumnDef } from "@tanstack/react-table";

import { DataTable } from "../DataTable";

interface Row {
  id: string;
  name: string;
  value: number;
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: "name", header: "Name" },
  { accessorKey: "value", header: "Value" },
];

const data: Row[] = [
  { id: "1", name: "Alpha", value: 30 },
  { id: "2", name: "Beta", value: 10 },
  { id: "3", name: "Gamma", value: 20 },
];

describe("DataTable", () => {
  it("renders column headers and row data", () => {
    render(<DataTable data={data} columns={columns} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Value")).toBeInTheDocument();
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();
  });

  it("sorts by column ascending/descending when sortable", () => {
    render(<DataTable data={data} columns={columns} sortable />);
    const nameHeader = screen.getByText("Name").closest("th")!;
    fireEvent.click(nameHeader);
    const cells = screen.getAllByRole("cell", { name: /Alpha|Beta|Gamma/i }).map(
      (c) => c.textContent,
    );
    expect(cells[0]).toBe("Alpha");

    fireEvent.click(nameHeader);
    const cellsDesc = screen
      .getAllByRole("cell", { name: /Alpha|Beta|Gamma/i })
      .map((c) => c.textContent);
    expect(cellsDesc[0]).toBe("Gamma");
  });

  it("renders selection checkboxes and fires onSelectionChange", () => {
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        data={data}
        columns={columns}
        selectable
        selectedRows={new Set()}
        onSelectionChange={onSelectionChange}
        rowKey={(r) => r.id}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[1]);
    expect(onSelectionChange).toHaveBeenCalled();
  });

  it("shows pagination controls and navigates pages when paginated", () => {
    const manyData: Row[] = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      name: `Row ${i}`,
      value: i,
    }));
    render(
      <DataTable
        data={manyData}
        columns={columns}
        paginated
        pageSize={10}
      />,
    );
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    const nextBtn = screen.getByRole("button", { name: /next page/i });
    fireEvent.click(nextBtn);
    expect(screen.getByText(/Page 2 of 3/)).toBeInTheDocument();
  });

  it("changes page size when a new option is selected", () => {
    const manyData: Row[] = Array.from({ length: 30 }, (_, i) => ({
      id: String(i),
      name: `Row ${i}`,
      value: i,
    }));
    render(
      <DataTable
        data={manyData}
        columns={columns}
        paginated
        pageSize={10}
        pageSizeOptions={[10, 25]}
      />,
    );
    expect(screen.getByText(/Page 1 of 3/)).toBeInTheDocument();
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "25" } });
    expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument();
  });

  it("shows empty state when data is empty", () => {
    render(
      <DataTable
        data={[]}
        columns={columns}
        emptyState={<span>Nothing here</span>}
      />,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("shows default empty text when no emptyState and data is empty", () => {
    render(<DataTable data={[]} columns={columns} />);
    expect(screen.getByText("No data")).toBeInTheDocument();
  });

  it("renders loading skeleton rows when loading is true", () => {
    const { container } = render(
      <DataTable data={[]} columns={columns} loading pageSize={5} />,
    );
    const skeletonRows = container.querySelectorAll(".gc-data-table__skeleton-row");
    expect(skeletonRows.length).toBe(5);
  });

  it("calls onRowClick with the clicked row data", () => {
    const onRowClick = vi.fn();
    render(
      <DataTable data={data} columns={columns} onRowClick={onRowClick} />,
    );
    fireEvent.click(screen.getByText("Alpha").closest("tr")!);
    expect(onRowClick).toHaveBeenCalledWith(data[0]);
  });

  it("filters rows by globalFilter prop", () => {
    render(
      <DataTable data={data} columns={columns} globalFilter="Alpha" />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Beta")).not.toBeInTheDocument();
  });

  it("renders virtualized table without errors", () => {
    const manyData: Row[] = Array.from({ length: 50 }, (_, i) => ({
      id: String(i),
      name: `VRow ${i}`,
      value: i,
    }));
    const { container } = render(
      <DataTable data={manyData} columns={columns} virtualized />,
    );
    expect(container.querySelector(".gc-data-table")).toBeInTheDocument();
  });

  it("applies bordered and striped modifier classes", () => {
    const { container } = render(
      <DataTable data={data} columns={columns} bordered striped />,
    );
    const table = container.querySelector(".gc-data-table");
    expect(table).toHaveClass("gc-data-table--bordered");
    expect(table).toHaveClass("gc-data-table--striped");
  });

  it("uses custom rowKey function for selection keys", () => {
    const onSelectionChange = vi.fn();
    render(
      <DataTable
        data={data}
        columns={columns}
        selectable
        selectedRows={new Set(["1"])}
        onSelectionChange={onSelectionChange}
        rowKey={(r) => r.id}
      />,
    );
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBeGreaterThan(1);
  });
});
