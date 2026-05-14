// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useTranslation } from "react-i18next";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type RowSelectionState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";

import { Button } from "../Button/Button";
import { Checkbox } from "../Checkbox/Checkbox";
import { Icon } from "../Icon/Icon";
import "./DataTable.css";

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  sortable?: boolean;
  defaultSort?: { id: string; desc: boolean };
  selectable?: boolean;
  selectedRows?: Set<string>;
  onSelectionChange?: (selected: Set<string>) => void;
  rowKey?: (row: T) => string;
  paginated?: boolean;
  pageSize?: number;
  pageSizeOptions?: number[];
  virtualized?: boolean;
  emptyState?: React.ReactNode;
  loading?: boolean;
  onRowClick?: (row: T) => void;
  globalFilter?: string;
  size?: "small" | "medium" | "large";
  bordered?: boolean;
  striped?: boolean;
  className?: string;
}

function defaultRowKey<T>(row: T, index: number): string {
  if (row && typeof row === "object" && "id" in row) {
    return String((row as Record<string, unknown>).id);
  }
  return String(index);
}

export function DataTable<T>({
  data,
  columns,
  sortable = false,
  defaultSort,
  selectable = false,
  selectedRows,
  onSelectionChange,
  rowKey,
  paginated = false,
  pageSize: initialPageSize = 10,
  pageSizeOptions = [10, 25, 50, 100],
  virtualized = false,
  emptyState,
  loading = false,
  onRowClick,
  globalFilter = "",
  size = "medium",
  bordered = false,
  striped = false,
  className,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [sorting, setSorting] = React.useState<SortingState>(
    defaultSort ? [{ id: defaultSort.id, desc: defaultSort.desc }] : [],
  );
  const [pageSize, setPageSize] = React.useState(initialPageSize);
  const [pageIndex, setPageIndex] = React.useState(0);

  const rowSelectionState = React.useMemo<RowSelectionState>(() => {
    if (!selectedRows) return {};
    const state: RowSelectionState = {};
    data.forEach((row, index) => {
      const key = rowKey ? rowKey(row) : defaultRowKey(row, index);
      if (selectedRows.has(key)) {
        state[index] = true;
      }
    });
    return state;
  }, [selectedRows, data, rowKey]);

  const selectionColumn: ColumnDef<T> = {
    id: "__selection__",
    header: ({ table }) => {
      const allSelected = table.getIsAllPageRowsSelected();
      const someSelected = table.getIsSomePageRowsSelected();
      return (
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={(val) => table.toggleAllPageRowsSelected(val)}
          aria-label={t("app.ui.dataTable.selectAll")}
        />
      );
    },
    cell: ({ row }) => (
      <Checkbox
        checked={row.getIsSelected()}
        onCheckedChange={(val) => row.toggleSelected(val)}
        aria-label={t("app.ui.dataTable.selectRow")}
      />
    ),
    size: 40,
    enableSorting: false,
  };

  const resolvedColumns = selectable ? [selectionColumn, ...columns] : columns;

  const table = useReactTable({
    data,
    columns: resolvedColumns,
    state: {
      sorting,
      rowSelection: rowSelectionState,
      globalFilter,
      pagination: paginated ? { pageIndex, pageSize } : undefined,
    },
    enableSorting: sortable,
    enableRowSelection: selectable,
    onSortingChange: setSorting,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function"
          ? updater({ pageIndex, pageSize })
          : updater;
      setPageIndex(next.pageIndex);
      setPageSize(next.pageSize);
    },
    onRowSelectionChange: (updater) => {
      if (!onSelectionChange) return;
      const next =
        typeof updater === "function" ? updater(rowSelectionState) : updater;
      const selected = new Set<string>();
      Object.keys(next).forEach((indexStr) => {
        if (next[indexStr]) {
          const index = parseInt(indexStr, 10);
          const row = data[index];
          if (row !== undefined) {
            selected.add(rowKey ? rowKey(row) : defaultRowKey(row, index));
          }
        }
      });
      onSelectionChange(selected);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: sortable ? getSortedRowModel() : undefined,
    getPaginationRowModel: paginated ? getPaginationRowModel() : undefined,
    getFilteredRowModel: getFilteredRowModel(),
    manualPagination: false,
  });

  const rows = paginated
    ? table.getRowModel().rows
    : table.getRowModel().rows;

  const tbodyRef = React.useRef<HTMLTableSectionElement>(null);
  const parentRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: virtualized ? rows.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => (size === "small" ? 32 : size === "large" ? 56 : 44),
    overscan: 5,
  });

  const tableClasses = [
    "gc-data-table",
    `gc-data-table--${size}`,
    bordered ? "gc-data-table--bordered" : "",
    striped ? "gc-data-table--striped" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const renderBody = () => {
    if (loading) {
      return (
        <tbody>
          {Array.from({ length: pageSize }).map((_, i) => (
            <tr key={i} className="gc-data-table__skeleton-row">
              {resolvedColumns.map((col, j) => (
                <td key={j} className="gc-data-table__cell">
                  <div className="gc-data-table__skeleton-cell" />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      );
    }

    if (rows.length === 0) {
      return (
        <tbody>
          <tr>
            <td
              colSpan={resolvedColumns.length}
              className="gc-data-table__empty"
            >
              {emptyState ?? (
                <span className="gc-data-table__empty-text">{t("app.ui.dataTable.noData")}</span>
              )}
            </td>
          </tr>
        </tbody>
      );
    }

    if (virtualized) {
      const virtualItems = virtualizer.getVirtualItems();
      const totalSize = virtualizer.getTotalSize();
      return (
        <tbody ref={tbodyRef} style={{ position: "relative", height: `${totalSize}px` }}>
          {virtualItems.map((vItem) => {
            const row = rows[vItem.index];
            return (
              <tr
                key={row.id}
                className={[
                  "gc-data-table__row",
                  onRowClick ? "gc-data-table__row--clickable" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={{
                  position: "absolute",
                  top: 0,
                  transform: `translateY(${vItem.start}px)`,
                  width: "100%",
                }}
                onClick={() => onRowClick?.(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="gc-data-table__cell">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      );
    }

    return (
      <tbody>
        {rows.map((row) => (
          <tr
            key={row.id}
            className={[
              "gc-data-table__row",
              onRowClick ? "gc-data-table__row--clickable" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onRowClick?.(row.original)}
          >
            {row.getVisibleCells().map((cell) => (
              <td key={cell.id} className="gc-data-table__cell">
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    );
  };

  const currentPageIndex = paginated ? pageIndex : 0;
  const filteredRowCount = table.getFilteredRowModel().rows.length;
  const pageCount = paginated ? Math.max(1, Math.ceil(filteredRowCount / pageSize)) : 1;

  return (
    <div className="gc-data-table-wrapper">
      {virtualized ? (
        <div ref={parentRef} className="gc-data-table-scroll-container">
          <table className={tableClasses}>
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="gc-data-table__header-row">
                  {hg.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sortDir = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        className={[
                          "gc-data-table__th",
                          canSort ? "gc-data-table__th--sortable" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={
                          canSort
                            ? header.column.getToggleSortingHandler()
                            : undefined
                        }
                        aria-sort={
                          sortDir === "asc"
                            ? "ascending"
                            : sortDir === "desc"
                              ? "descending"
                              : undefined
                        }
                      >
                        <span className="gc-data-table__th-content">
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                          {canSort && (
                            <span className="gc-data-table__sort-icon">
                              {sortDir === "asc" ? (
                                <Icon name="chevron-up" size={12} />
                              ) : sortDir === "desc" ? (
                                <Icon name="chevron-down" size={12} />
                              ) : (
                                <Icon name="chevrons-up-down" size={12} />
                              )}
                            </span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            {renderBody()}
          </table>
        </div>
      ) : (
        <div className="gc-data-table-scroll-container">
          <table className={tableClasses}>
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="gc-data-table__header-row">
                  {hg.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    const sortDir = header.column.getIsSorted();
                    return (
                      <th
                        key={header.id}
                        className={[
                          "gc-data-table__th",
                          canSort ? "gc-data-table__th--sortable" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        onClick={
                          canSort
                            ? header.column.getToggleSortingHandler()
                            : undefined
                        }
                        aria-sort={
                          sortDir === "asc"
                            ? "ascending"
                            : sortDir === "desc"
                              ? "descending"
                              : undefined
                        }
                      >
                        <span className="gc-data-table__th-content">
                          {header.isPlaceholder
                            ? null
                            : flexRender(
                                header.column.columnDef.header,
                                header.getContext(),
                              )}
                          {canSort && (
                            <span className="gc-data-table__sort-icon">
                              {sortDir === "asc" ? (
                                <Icon name="chevron-up" size={12} />
                              ) : sortDir === "desc" ? (
                                <Icon name="chevron-down" size={12} />
                              ) : (
                                <Icon name="chevrons-up-down" size={12} />
                              )}
                            </span>
                          )}
                        </span>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            {renderBody()}
          </table>
        </div>
      )}

      {paginated && (
        <div className="gc-data-table__pagination">
          <div className="gc-data-table__page-size">
            <span className="gc-data-table__pagination-label">{t("app.ui.dataTable.rowsPerPage")}</span>
            <select
              className="gc-data-table__page-size-select"
              value={pageSize}
              onChange={(e) => {
                const newSize = Number(e.target.value);
                setPageSize(newSize);
                setPageIndex(0);
              }}
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>

          <div className="gc-data-table__page-nav">
            <span className="gc-data-table__pagination-label">
              {pageCount > 0
                ? `Page ${currentPageIndex + 1} of ${pageCount}`
                : "No pages"}
            </span>
            <Button
              variant="ghost"
              size="xsmall"
              iconLeft="chevron-left"
              disabled={currentPageIndex <= 0}
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              aria-label={t("app.ui.dataTable.previousPage")}
            />
            <Button
              variant="ghost"
              size="xsmall"
              iconLeft="chevron-right"
              disabled={currentPageIndex >= pageCount - 1}
              onClick={() => setPageIndex((p) => Math.min(pageCount - 1, p + 1))}
              aria-label={t("app.ui.dataTable.nextPage")}
            />
          </div>
        </div>
      )}
    </div>
  );
}
