// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { type ColumnDef } from "@tanstack/react-table";

import {
  Avatar,
  Badge,
  Button,
  DataTableServer,
  Dialog,
  Heading,
  Input,
  Popover,
  RadioGroup,
  Select,
  Tag,
  Text,
  Tooltip,
} from "../../components/ui";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditResult = "success" | "failure";

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: {
    id: string;
    name: string;
    avatarUrl?: string;
  };
  action: string;
  targetKind: string;
  targetId: string;
  result: AuditResult;
  ip?: string;
  metadata?: Record<string, unknown>;
}

export interface AuditPage {
  items: AuditEntry[];
  total: number;
  nextCursor?: string;
}

interface AuditFilters {
  actor: string;
  action: string;
  targetKind: string;
  since: string;
  until: string;
  result: "all" | "success" | "failure";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ALL_ACTIONS = "__all_actions__";
const ALL_TARGETS = "__all_targets__";

const AUDIT_ACTIONS = [
  { value: ALL_ACTIONS, label: "All actions" },
  { value: "auth.login_success", label: "auth.login_success" },
  { value: "auth.login_failure", label: "auth.login_failure" },
  { value: "auth.logout", label: "auth.logout" },
  { value: "graph.create", label: "graph.create" },
  { value: "graph.update", label: "graph.update" },
  { value: "graph.delete", label: "graph.delete" },
  { value: "graph.run", label: "graph.run" },
  { value: "credential.create", label: "credential.create" },
  { value: "credential.use", label: "credential.use" },
  { value: "credential.delete", label: "credential.delete" },
  { value: "user.invite", label: "user.invite" },
  { value: "user.role_change", label: "user.role_change" },
  { value: "project.create", label: "project.create" },
  { value: "project.delete", label: "project.delete" },
  { value: "api_key.create", label: "api_key.create" },
  { value: "api_key.revoke", label: "api_key.revoke" },
];

const TARGET_KINDS = [
  { value: ALL_TARGETS, label: "All targets" },
  { value: "graph", label: "Graph" },
  { value: "credential", label: "Credential" },
  { value: "user", label: "User" },
  { value: "project", label: "Project" },
  { value: "api_key", label: "API Key" },
  { value: "execution", label: "Execution" },
];

const RESULT_OPTIONS = [
  { value: "all", label: "All" },
  { value: "success", label: "Success" },
  { value: "failure", label: "Failure" },
];

const PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAbsolute(iso: string): string {
  return new Date(iso).toLocaleString();
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

function actionVariant(action: string): "default" | "primary" | "success" | "warning" | "danger" | "info" {
  if (action.startsWith("auth.login_failure")) return "danger";
  if (action.startsWith("auth.")) return "info";
  if (action.startsWith("graph.delete") || action.startsWith("credential.delete") || action.startsWith("project.delete")) return "danger";
  if (action.startsWith("graph.run") || action.startsWith("graph.create")) return "success";
  if (action.startsWith("credential.")) return "warning";
  if (action.startsWith("user.") || action.startsWith("api_key.")) return "primary";
  return "default";
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchAuditLog(params: {
  actor?: string;
  action?: string;
  target?: string;
  since?: string;
  until?: string;
  result?: string;
  limit?: number;
  cursor?: string;
}): Promise<AuditPage> {
  const sp = new URLSearchParams();
  if (params.actor) sp.set("actor", params.actor);
  if (params.action) sp.set("action", params.action);
  if (params.target) sp.set("target", params.target);
  if (params.since) sp.set("since", params.since);
  if (params.until) sp.set("until", params.until);
  if (params.result && params.result !== "all") sp.set("result", params.result);
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.cursor) sp.set("cursor", params.cursor);

  const resp = await fetch(`/api/v1/audit?${sp.toString()}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<AuditPage>;
}

async function verifyAuditChain(): Promise<{ ok: boolean; message: string }> {
  const resp = await fetch("/api/v1/audit/verify");
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<{ ok: boolean; message: string }>;
}

async function exportAuditCsv(filters: AuditFilters): Promise<void> {
  const sp = new URLSearchParams();
  if (filters.actor) sp.set("actor", filters.actor);
  if (filters.action && filters.action !== ALL_ACTIONS) sp.set("action", filters.action);
  if (filters.targetKind && filters.targetKind !== ALL_TARGETS) sp.set("target", filters.targetKind);
  if (filters.since) sp.set("since", filters.since);
  if (filters.until) sp.set("until", filters.until);
  if (filters.result !== "all") sp.set("result", filters.result);
  sp.set("format", "csv");

  const resp = await fetch(`/api/v1/audit?${sp.toString()}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// MetadataPopover
// ---------------------------------------------------------------------------

function MetadataPopover({ metadata }: { metadata: Record<string, unknown> }) {
  const { t } = useTranslation();
  return (
    <Popover
      trigger={
        <Button variant="ghost" size="xsmall" iconLeft="code-2">
          {t("app.settings.audit.metadata")}
        </Button>
      }
      width={320}
      align="end"
    >
      <div style={{ padding: "8px", maxHeight: 300, overflow: "auto" }}>
        <pre style={{ fontSize: 11, margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
          {JSON.stringify(metadata, null, 2)}
        </pre>
      </div>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Verify modal
// ---------------------------------------------------------------------------

interface VerifyModalProps {
  open: boolean;
  onClose: () => void;
  result: { ok: boolean; message: string } | null;
  loading: boolean;
}

function VerifyModal({ open, onClose, result, loading }: VerifyModalProps) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!v) onClose(); }}
      title={t("app.settings.audit.verifyTitle")}
      size="small"
      footer={
        <Button variant="outline" size="small" onClick={onClose}>
          {t("app.settings.audit.close")}
        </Button>
      }
    >
      {loading ? (
        <Text color="subtle">{t("app.settings.audit.verifying")}</Text>
      ) : result ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Tag variant={result.ok ? "success" : "danger"} size="medium">
            {result.ok ? t("app.settings.audit.verifyOk") : t("app.settings.audit.verifyFail")}
          </Tag>
          <Text size="small" color="subtle">{result.message}</Text>
        </div>
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

function buildColumns(t: (key: string) => string): ColumnDef<AuditEntry>[] {
  return [
    {
      id: "timestamp",
      header: t("app.settings.audit.columns.timestamp"),
      accessorKey: "timestamp",
      cell: ({ row }) => (
        <Tooltip content={formatAbsolute(row.original.timestamp)}>
          <span style={{ whiteSpace: "nowrap" }}>{formatRelative(row.original.timestamp)}</span>
        </Tooltip>
      ),
    },
    {
      id: "actor",
      header: t("app.settings.audit.columns.actor"),
      accessorKey: "actor",
      cell: ({ row }) => (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Avatar
            src={row.original.actor.avatarUrl}
            fallback={row.original.actor.name}
            size="xsmall"
          />
          <span>{row.original.actor.name}</span>
        </span>
      ),
    },
    {
      id: "action",
      header: t("app.settings.audit.columns.action"),
      accessorKey: "action",
      cell: ({ row }) => (
        <Tag variant={actionVariant(row.original.action)} size="small">
          {row.original.action}
        </Tag>
      ),
    },
    {
      id: "target",
      header: t("app.settings.audit.columns.target"),
      cell: ({ row }) => (
        <span style={{ display: "flex", gap: 4 }}>
          <Badge text={row.original.targetKind} variant="neutral" size="small" />
          <code style={{ fontSize: 11 }}>{row.original.targetId.slice(0, 8)}</code>
        </span>
      ),
    },
    {
      id: "result",
      header: t("app.settings.audit.columns.result"),
      accessorKey: "result",
      cell: ({ row }) => (
        <Tag
          variant={row.original.result === "success" ? "success" : "danger"}
          size="small"
          icon={row.original.result === "success" ? "circle-check" : "circle-x"}
        >
          {row.original.result}
        </Tag>
      ),
    },
    {
      id: "ip",
      header: t("app.settings.audit.columns.ip"),
      cell: ({ row }) =>
        row.original.ip ? (
          <code style={{ fontSize: 11 }}>{row.original.ip}</code>
        ) : (
          <span style={{ color: "var(--gc-text-muted)" }}>—</span>
        ),
    },
    {
      id: "metadata",
      header: "",
      cell: ({ row }) =>
        row.original.metadata && Object.keys(row.original.metadata).length > 0 ? (
          <MetadataPopover metadata={row.original.metadata} />
        ) : null,
      size: 80,
      enableSorting: false,
    },
  ];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function AuditLogPage() {
  const { t } = useTranslation();

  const [filters, setFilters] = useState<AuditFilters>({
    actor: "",
    action: ALL_ACTIONS,
    targetKind: ALL_TARGETS,
    since: "",
    until: "",
    result: "all",
  });

  const [page, setPage] = useState(0);
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [verifyLoading, setVerifyLoading] = useState(false);
  const [exportWorking, setExportWorking] = useState(false);

  const loadPage = useCallback(
    async (pageIndex: number, cursorList: string[], f: AuditFilters) => {
      setLoading(true);
      setError(null);
      try {
        const cursor = pageIndex > 0 ? cursorList[pageIndex - 1] : undefined;
        const data = await fetchAuditLog({
          actor: f.actor || undefined,
          action: f.action && f.action !== ALL_ACTIONS ? f.action : undefined,
          target: f.targetKind && f.targetKind !== ALL_TARGETS ? f.targetKind : undefined,
          since: f.since || undefined,
          until: f.until || undefined,
          result: f.result !== "all" ? f.result : undefined,
          limit: PAGE_SIZE,
          cursor,
        });
        setItems(data.items);
        setTotal(data.total);
        if (data.nextCursor && pageIndex >= cursorList.length) {
          setCursors((prev) => {
            const next = [...prev];
            next[pageIndex] = data.nextCursor as string;
            return next;
          });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : t("app.settings.audit.loadError"));
      } finally {
        setLoading(false);
      }
    },
    [t],
  );

  React.useEffect(() => {
    void loadPage(0, [], filters);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFilterChange(next: Partial<AuditFilters>) {
    const merged = { ...filters, ...next };
    setFilters(merged);
    setPage(0);
    setCursors([]);
    void loadPage(0, [], merged);
  }

  function handlePageChange(p: number) {
    setPage(p);
    void loadPage(p, cursors, filters);
  }

  async function handleVerify() {
    setVerifyOpen(true);
    setVerifyResult(null);
    setVerifyLoading(true);
    try {
      const res = await verifyAuditChain();
      setVerifyResult(res);
    } catch {
      setVerifyResult({ ok: false, message: t("app.settings.audit.verifyError") });
    } finally {
      setVerifyLoading(false);
    }
  }

  async function handleExport() {
    setExportWorking(true);
    try {
      await exportAuditCsv(filters);
    } finally {
      setExportWorking(false);
    }
  }

  const columns = buildColumns(t);

  const emptyState = (
    <Text color="subtle">{t("app.settings.audit.empty")}</Text>
  );

  return (
    <div className="gc-audit-page" data-testid="audit-log-page">
      <div className="gc-audit-page__header">
        <Heading level={2} size="xl">
          {t("app.settings.audit.title")}
        </Heading>
        <div style={{ display: "flex", gap: 8 }}>
          <Button
            variant="outline"
            size="small"
            iconLeft="download"
            onClick={handleExport}
            loading={exportWorking}
          >
            {t("app.settings.audit.exportCsv")}
          </Button>
          <Button
            variant="outline"
            size="small"
            iconLeft="shield"
            onClick={handleVerify}
          >
            {t("app.settings.audit.verifyChain")}
          </Button>
        </div>
      </div>

      <div className="gc-audit-page__filters" data-testid="audit-filters">
        <Input
          value={filters.actor}
          onChange={(e) => handleFilterChange({ actor: e.target.value })}
          placeholder={t("app.settings.audit.filterActor")}
          size="small"
          clearable
          onClear={() => handleFilterChange({ actor: "" })}
          aria-label={t("app.settings.audit.filterActor")}
        />
        <Select
          value={filters.action}
          onValueChange={(v) => handleFilterChange({ action: v })}
          options={AUDIT_ACTIONS}
          placeholder={t("app.settings.audit.filterAction")}
          size="small"
          aria-label={t("app.settings.audit.filterAction")}
        />
        <Select
          value={filters.targetKind}
          onValueChange={(v) => handleFilterChange({ targetKind: v })}
          options={TARGET_KINDS}
          placeholder={t("app.settings.audit.filterTargetKind")}
          size="small"
          aria-label={t("app.settings.audit.filterTargetKind")}
        />
        <Input
          type="date"
          value={filters.since}
          onChange={(e) => handleFilterChange({ since: e.target.value })}
          placeholder={t("app.settings.audit.filterSince")}
          size="small"
          aria-label={t("app.settings.audit.filterSince")}
        />
        <Input
          type="date"
          value={filters.until}
          onChange={(e) => handleFilterChange({ until: e.target.value })}
          placeholder={t("app.settings.audit.filterUntil")}
          size="small"
          aria-label={t("app.settings.audit.filterUntil")}
        />
        <RadioGroup
          value={filters.result}
          onValueChange={(v) => handleFilterChange({ result: v as AuditFilters["result"] })}
          options={RESULT_OPTIONS}
          orientation="horizontal"
          size="small"
          aria-label={t("app.settings.audit.filterResult")}
        />
      </div>

      {error && (
        <div role="alert" style={{ marginBottom: 8 }}>
          <Text color="danger">{error}</Text>
        </div>
      )}

      <DataTableServer
        data={items}
        columns={columns}
        totalRows={total}
        currentPage={page}
        onPageChange={handlePageChange}
        pageSize={PAGE_SIZE}
        loading={loading}
        emptyState={emptyState}
        size="small"
        striped
      />

      <VerifyModal
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        result={verifyResult}
        loading={verifyLoading}
      />
    </div>
  );
}
