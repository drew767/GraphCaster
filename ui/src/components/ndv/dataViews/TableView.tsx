// Copyright GraphCaster. All Rights Reserved.

import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";

import { DataTable } from "../../ui/DataTable/DataTable";

export interface TableViewProps {
  data: unknown;
  emptyLabel?: string;
}

type Row = Record<string, unknown> & { __index: number };

function toRows(data: unknown): Row[] {
  if (Array.isArray(data)) {
    return data.map((item, i) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return { __index: i, ...(item as Record<string, unknown>) };
      }
      return { __index: i, value: item } as Row;
    });
  }
  if (data && typeof data === "object") {
    return [{ __index: 0, ...(data as Record<string, unknown>) }];
  }
  return [{ __index: 0, value: data } as Row];
}

function formatCell(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function TableView({ data, emptyLabel }: TableViewProps) {
  const rows = useMemo(() => toRows(data), [data]);

  const columns = useMemo<ColumnDef<Row>[]>(() => {
    const keys = new Set<string>();
    rows.forEach((r) => {
      Object.keys(r).forEach((k) => {
        if (k !== "__index") keys.add(k);
      });
    });
    const keyList = Array.from(keys);
    if (keyList.length === 0) keyList.push("value");
    return keyList.map((key) => ({
      id: key,
      accessorKey: key,
      header: key,
      cell: ({ row }) => formatCell(row.original[key]),
    }));
  }, [rows]);

  if (rows.length === 0) {
    return <div className="gc-table-view__empty">{emptyLabel ?? "—"}</div>;
  }

  return (
    <div className="gc-table-view" data-testid="table-view">
      <DataTable<Row>
        data={rows}
        columns={columns}
        rowKey={(r) => String(r.__index)}
        size="small"
        bordered
      />
    </div>
  );
}
