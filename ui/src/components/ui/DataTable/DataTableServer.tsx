// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useTranslation } from "react-i18next";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";

import { Button } from "../Button/Button";
import { Icon } from "../Icon/Icon";
import "./DataTable.css";

export interface DataTableServerProps<T> {
  data: T[];
  columns: ColumnDef<T>[];
  totalRows: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  sortBy?: { id: string; desc: boolean } | null;
  onSortChange?: (sort: { id: string; desc: boolean } | null) => void;
  filter?: string;
  onFilterChange?: (filter: string) => void;
  loading?: boolean;
  emptyState?: React.ReactNode;
  onRowClick?: (row: T) => void;
  size?: "small" | "medium" | "large";
  bordered?: boolean;
  striped?: boolean;
  className?: string;
}

export function DataTableServer<T>({
  data,
  columns,
  totalRows,
  currentPage,
  onPageChange,
  pageSize,
  sortBy,
  onSortChange,
  filter,
  onFilterChange,
  loading = false,
  emptyState,
  onRowClick,
  size = "medium",
  bordered = false,
  striped = false,
  className,
}: DataTableServerProps<T>) {
  const { t } = useTranslation();
  const sorting: SortingState = sortBy ? [{ id: sortBy.id, desc: sortBy.desc }] : [];

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      pagination: { pageIndex: currentPage, pageSize },
      globalFilter: filter ?? "",
    },
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    pageCount: Math.ceil(totalRows / pageSize),
    enableSorting: !!onSortChange,
    onSortingChange: (updater) => {
      if (!onSortChange) return;
      const next =
        typeof updater === "function" ? updater(sorting) : updater;
      if (next.length === 0) {
        onSortChange(null);
      } else {
        onSortChange({ id: next[0].id, desc: next[0].desc });
      }
    },
    onGlobalFilterChange: onFilterChange,
    getCoreRowModel: getCoreRowModel(),
  });

  const rows = table.getRowModel().rows;
  const pageCount = Math.ceil(totalRows / pageSize);

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
              {columns.map((_, j) => (
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
            <td colSpan={columns.length} className="gc-data-table__empty">
              {emptyState ?? (
                <span className="gc-data-table__empty-text">{t("app.ui.dataTable.noData")}</span>
              )}
            </td>
          </tr>
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

  return (
    <div className="gc-data-table-wrapper">
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

      <div className="gc-data-table__pagination">
        <div className="gc-data-table__page-size">
          <span className="gc-data-table__pagination-label">
            {totalRows} row{totalRows !== 1 ? "s" : ""}
          </span>
        </div>

        <div className="gc-data-table__page-nav">
          <span className="gc-data-table__pagination-label">
            {pageCount > 0
              ? `Page ${currentPage + 1} of ${pageCount}`
              : "No pages"}
          </span>
          <Button
            variant="ghost"
            size="xsmall"
            iconLeft="chevron-left"
            disabled={currentPage <= 0}
            onClick={() => onPageChange(currentPage - 1)}
            aria-label={t("app.ui.dataTable.previousPage")}
          />
          <Button
            variant="ghost"
            size="xsmall"
            iconLeft="chevron-right"
            disabled={currentPage >= pageCount - 1}
            onClick={() => onPageChange(currentPage + 1)}
            aria-label={t("app.ui.dataTable.nextPage")}
          />
        </div>
      </div>
    </div>
  );
}
