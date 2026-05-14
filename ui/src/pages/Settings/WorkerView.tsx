// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";

import {
  Button,
  DataTable,
  EmptyState,
  Heading,
  Switch,
  Tag,
} from "../../components/ui";
import {
  workersApi,
  statusFromHeartbeat,
  relativeTimeAgo,
  type Worker,
  type WorkerStatus,
} from "../../api/workers";

const REFRESH_INTERVAL_MS = 5_000;

function statusVariant(status: WorkerStatus): "default" | "success" | "warning" | "danger" {
  switch (status) {
    case "online":
      return "success";
    case "stale":
      return "warning";
    case "offline":
      return "danger";
    default:
      return "default";
  }
}

function truncateId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 10)}…`;
}

export default function WorkerViewPage() {
  const { t } = useTranslation();
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [tick, setTick] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await workersApi.list();
      setWorkers(data);
      setTick((n) => n + 1);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    intervalRef.current = setInterval(() => {
      void refresh();
    }, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoRefresh, refresh]);

  const now = Date.now();

  const columns: ColumnDef<Worker>[] = [
    {
      id: "id",
      header: t("app.settings.workers.col.id"),
      cell: ({ row }) => (
        <span style={{ fontFamily: "monospace", fontSize: 13 }} title={row.original.id}>
          {truncateId(row.original.id)}
        </span>
      ),
    },
    {
      id: "host",
      header: t("app.settings.workers.col.host"),
      accessorKey: "host",
      cell: ({ row }) => (
        <span style={{ fontFamily: "monospace", fontSize: 13 }}>
          {row.original.host}
        </span>
      ),
    },
    {
      id: "status",
      header: t("app.settings.workers.col.status"),
      cell: ({ row }) => {
        const status = statusFromHeartbeat(row.original.lastHeartbeat, now);
        return (
          <span data-testid={`worker-status-${row.original.id}`} data-status={status}>
            <Tag size="small" variant={statusVariant(status)}>
              {t(`app.settings.workers.status.${status}`)}
            </Tag>
          </span>
        );
      },
      enableSorting: false,
    },
    {
      id: "lastHeartbeat",
      header: t("app.settings.workers.col.lastHeartbeat"),
      cell: ({ row }) => (
        <span style={{ fontSize: 13, color: "var(--color--text--tint-2, rgba(28,28,30,0.55))" }}>
          {relativeTimeAgo(row.original.lastHeartbeat, now)}
        </span>
      ),
    },
    {
      id: "runningRuns",
      header: t("app.settings.workers.col.runningRuns"),
      cell: ({ row }) =>
        row.original.runningRuns > 0 ? (
          <RouterLink
            to={`/home/executions?workerId=${encodeURIComponent(row.original.id)}&status=running`}
            data-testid={`worker-runs-link-${row.original.id}`}
            style={{ color: "var(--color--accent, #0a84ff)", textDecoration: "none" }}
          >
            {row.original.runningRuns}
          </RouterLink>
        ) : (
          <span style={{ fontSize: 13, color: "var(--color--text--tint-2, rgba(28,28,30,0.55))" }}>
            0
          </span>
        ),
    },
    {
      id: "version",
      header: t("app.settings.workers.col.version"),
      cell: ({ row }) => <span style={{ fontSize: 13 }}>{row.original.version}</span>,
    },
  ];

  const emptyState = (
    <EmptyState
      icon="server"
      title={t("app.settings.workers.emptyTitle")}
      description={t("app.settings.workers.emptyDescription")}
    />
  );

  return (
    <div data-testid="workers-page" data-refresh-tick={tick}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <Heading level={2} size="xl">
          {t("app.settings.workers.title")}
        </Heading>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Switch
            checked={autoRefresh}
            onCheckedChange={setAutoRefresh}
            label={t("app.settings.workers.autoRefresh")}
            data-testid="workers-auto-refresh-toggle"
          />
          <Button
            variant="outline"
            size="small"
            iconLeft="refresh-cw"
            onClick={() => void refresh()}
            loading={loading}
            data-testid="workers-refresh-btn"
          >
            {t("app.settings.workers.refresh")}
          </Button>
        </div>
      </div>

      <DataTable<Worker>
        data={workers}
        columns={columns}
        loading={loading && workers.length === 0}
        emptyState={emptyState}
        sortable
        bordered
        rowKey={(row) => row.id}
      />
    </div>
  );
}
