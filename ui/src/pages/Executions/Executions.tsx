// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { type ColumnDef } from "@tanstack/react-table";

import {
  DataTableServer,
  Tag,
  Tooltip,
  Checkbox,
  Button,
  DropdownMenu,
  Heading,
  Text,
  Link,
  Spinner,
} from "../../components/ui";
import { EmptyState } from "../../components/ui/EmptyState/EmptyState";
import { BulkActionsBar, type BulkAction } from "../../components/ui/BulkActionsBar/BulkActionsBar";

import { ExecutionsFilter, type ExecutionsFilterValue } from "./ExecutionsFilter";
import { useExecutionsData, deleteExecution, retryExecution } from "./useExecutionsData";
import type { ExecutionSummary } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_VARIANT: Record<
  ExecutionSummary["status"],
  "success" | "danger" | "warning" | "info" | "default" | "primary"
> = {
  success: "success",
  failed: "danger",
  cancelled: "warning",
  running: "primary",
  waiting: "info",
  queued: "default",
};

const STATUS_ICON: Record<ExecutionSummary["status"], string> = {
  success: "check-circle",
  failed: "x-circle",
  cancelled: "slash",
  running: "loader",
  waiting: "clock",
  queued: "list",
} as const;

const MODE_VARIANT: Record<
  ExecutionSummary["mode"],
  "success" | "danger" | "warning" | "info" | "default" | "primary"
> = {
  manual: "default",
  webhook: "info",
  schedule: "primary",
  trigger: "warning",
  api: "success",
};

function formatDuration(ms?: number): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "just now";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString();
}

function truncateId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Column definitions (factory — needs t & nav & selection helpers)
// ---------------------------------------------------------------------------

function buildColumns(opts: {
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (all: boolean) => void;
  allSelected: boolean;
  someSelected: boolean;
  navigate: ReturnType<typeof useNavigate>;
  onDelete: (id: string) => void;
  onRetry: (id: string) => void;
  t: (key: any, fallback?: any) => any;
}): ColumnDef<ExecutionSummary>[] {
  const { selected, onToggle, onToggleAll, allSelected, someSelected, navigate, onDelete, onRetry, t } = opts;
  return [
    {
      id: "__sel__",
      header: () => (
        <Checkbox
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={(val) => onToggleAll(val)}
          label={t("app.executions.columns.selectAll", "Select all")}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={selected.has(row.original.id)}
          onCheckedChange={() => onToggle(row.original.id)}
          label={t("app.executions.columns.selectRow", "Select row")}
        />
      ),
      size: 40,
      enableSorting: false,
    },
    {
      id: "status",
      header: t("app.executions.columns.status", "Status"),
      accessorKey: "status",
      cell: ({ row }) => {
        const s = row.original.status;
        return (
          <Tag variant={STATUS_VARIANT[s]} size="small" icon={STATUS_ICON[s] as never}>
            {s}
          </Tag>
        );
      },
    },
    {
      id: "graphName",
      header: t("app.executions.columns.workflow", "Workflow"),
      accessorKey: "graphName",
      cell: ({ row }) => (
        <Link href={`/workflow/${row.original.graphId}`}>{row.original.graphName}</Link>
      ),
    },
    {
      id: "runId",
      header: t("app.executions.columns.runId", "Run ID"),
      accessorKey: "id",
      cell: ({ row }) => (
        <code className="gc-executions__run-id">{truncateId(row.original.id)}</code>
      ),
    },
    {
      id: "startedAt",
      header: t("app.executions.columns.started", "Started"),
      accessorKey: "startedAt",
      cell: ({ row }) => (
        <Tooltip content={formatAbsolute(row.original.startedAt)}>
          <span>{formatRelative(row.original.startedAt)}</span>
        </Tooltip>
      ),
    },
    {
      id: "duration",
      header: t("app.executions.columns.duration", "Duration"),
      accessorKey: "durationMs",
      cell: ({ row }) => <span>{formatDuration(row.original.durationMs)}</span>,
    },
    {
      id: "mode",
      header: t("app.executions.columns.mode", "Mode"),
      accessorKey: "mode",
      cell: ({ row }) => (
        <Tag variant={MODE_VARIANT[row.original.mode]} size="small">
          {row.original.mode}
        </Tag>
      ),
    },
    {
      id: "tokens",
      header: t("app.executions.columns.tokens", "Tokens"),
      accessorKey: "totalTokens",
      cell: ({ row }) =>
        row.original.totalTokens != null ? (
          <span>{row.original.totalTokens.toLocaleString()}</span>
        ) : (
          <span className="gc-executions__empty-cell">—</span>
        ),
    },
    {
      id: "__actions__",
      header: "",
      cell: ({ row }) => {
        const ex = row.original;
        return (
          <DropdownMenu
            trigger={
              <Button
                variant="ghost"
                size="xsmall"
                iconLeft="more-horizontal"
                aria-label={t("app.executions.actions.menu", "Actions")}
              />
            }
            items={[
              {
                id: "view",
                label: t("app.executions.actions.view", "View"),
                icon: "eye",
                onSelect: () => navigate(`/home/executions/${ex.id}`),
              },
              {
                id: "retry",
                label: t("app.executions.actions.retry", "Retry"),
                icon: "refresh-cw",
                onSelect: () => onRetry(ex.id),
              },
              {
                id: "sep-delete",
                separator: true,
              } as never,
              {
                id: "delete",
                label: t("app.executions.actions.delete", "Delete"),
                icon: "trash-2",
                destructive: true,
                onSelect: () => onDelete(ex.id),
              },
            ]}
          />
        );
      },
      size: 48,
      enableSorting: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Default filter state (sync from URL)
// ---------------------------------------------------------------------------

function filterFromSearchParams(sp: URLSearchParams): ExecutionsFilterValue {
  return {
    graphId: sp.get("graphId") ?? "",
    status: sp.get("status") ?? "",
    since: sp.get("since") ?? "",
    until: sp.get("until") ?? "",
    metaKey: sp.get("metaKey") ?? "",
    metaValue: sp.get("metaValue") ?? "",
  };
}

function filterToSearchParams(f: ExecutionsFilterValue): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.graphId) sp.set("graphId", f.graphId);
  if (f.status) sp.set("status", f.status);
  if (f.since) sp.set("since", f.since);
  if (f.until) sp.set("until", f.until);
  if (f.metaKey) sp.set("metaKey", f.metaKey);
  if (f.metaValue) sp.set("metaValue", f.metaValue);
  return sp;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ExecutionsView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [filter, setFilter] = React.useState<ExecutionsFilterValue>(() =>
    filterFromSearchParams(searchParams),
  );
  const [page, setPage] = React.useState(0);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = React.useState<{ id: string; desc: boolean } | null>(null);
  const [bulkWorking, setBulkWorking] = React.useState(false);

  const { items, total, loading, error, refresh } = useExecutionsData({
    graphId: filter.graphId || undefined,
    status: filter.status || undefined,
    since: filter.since || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  function handleFilterChange(next: ExecutionsFilterValue) {
    setFilter(next);
    setPage(0);
    setSelected(new Set());
    setSearchParams(filterToSearchParams(next), { replace: true });
  }

  function handleToggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleToggleAll(all: boolean) {
    if (all) {
      setSelected(new Set(items.map((i) => i.id)));
    } else {
      setSelected(new Set());
    }
  }

  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));
  const someSelected = !allSelected && items.some((i) => selected.has(i.id));

  async function handleDelete(id: string) {
    await deleteExecution(id).catch(() => null);
    refresh();
  }

  async function handleRetry(id: string) {
    await retryExecution(id).catch(() => null);
    refresh();
  }

  async function handleBulkDelete() {
    setBulkWorking(true);
    await Promise.allSettled([...selected].map((id) => deleteExecution(id)));
    setSelected(new Set());
    setBulkWorking(false);
    refresh();
  }

  async function handleBulkRetry() {
    setBulkWorking(true);
    await Promise.allSettled([...selected].map((id) => retryExecution(id)));
    setSelected(new Set());
    setBulkWorking(false);
    refresh();
  }

  const columns = buildColumns({
    selected,
    onToggle: handleToggleRow,
    onToggleAll: handleToggleAll,
    allSelected,
    someSelected,
    navigate,
    onDelete: handleDelete,
    onRetry: handleRetry,
    t,
  });

  const emptyState = (
    <EmptyState
      icon="list"
      title={t("app.empty.executions.title")}
      description={t("app.empty.executions.description")}
      action={{
        label: t("app.empty.executions.action"),
        href: "/home/workflows",
        variant: "outline",
      }}
    />
  );

  return (
    <div className="gc-executions-page">
      <div className="gc-executions-page__header">
        <Heading level={1} size="xl">
          {t("app.executions.title", "Executions")}
        </Heading>
        <Button
          variant="ghost"
          size="small"
          iconLeft="refresh-cw"
          onClick={refresh}
          aria-label={t("app.executions.refresh", "Refresh")}
          loading={loading}
        />
      </div>

      <ExecutionsFilter value={filter} onChange={handleFilterChange} />

      <BulkActionsBar
        selectedCount={selected.size}
        totalCount={items.length}
        actions={[
          {
            id: "retry",
            label: t("app.executions.bulkActions.retry", "Retry selected"),
            icon: "refresh-cw",
            onClick: handleBulkRetry,
          },
          {
            id: "delete",
            label: t("app.executions.bulkActions.delete", "Delete selected"),
            icon: "trash-2",
            destructive: true,
            onClick: handleBulkDelete,
          },
        ] satisfies BulkAction[]}
        onClearSelection={() => setSelected(new Set())}
      />

      {error && (
        <div className="gc-executions__error" role="alert">
          <Text color="danger">{error}</Text>
        </div>
      )}

      <DataTableServer
        data={items}
        columns={columns}
        totalRows={total}
        currentPage={page}
        onPageChange={setPage}
        pageSize={PAGE_SIZE}
        sortBy={sortBy}
        onSortChange={setSortBy}
        loading={loading}
        emptyState={emptyState}
        onRowClick={(row) => navigate(`/home/executions/${row.id}`)}
        size="small"
        striped
      />
    </div>
  );
}
