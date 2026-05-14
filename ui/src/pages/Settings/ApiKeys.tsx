// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";

import { Button, DataTable, Heading, Tag, Text } from "../../components/ui";
import { useUIStore } from "../../app/stores/uiStore";
import { useToast } from "../../toast/ToastProvider";
import { useApiKeysData, type ApiKey } from "../../hooks/useApiKeysData";
import type { CreateApiKeyResult } from "../../hooks/useApiKeysData";
import { CreateApiKeyModal, API_KEY_CREATE_MODAL } from "./CreateApiKeyModal";

function relativeTime(dateStr: string | null, t: (k: string) => string): string {
  if (!dateStr) return t("app.settings.apiKeys.never");
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return t("app.settings.apiKeys.justNow");
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h`;
    const day = Math.floor(hr / 24);
    return `${day}d`;
  } catch {
    return dateStr;
  }
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return dateStr;
  }
}

function MaskedKey({ keyMasked }: { keyMasked: string }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "monospace", fontSize: 12 }}>
      <span data-testid="key-masked-value">{revealed ? keyMasked : "•".repeat(Math.min(keyMasked.length, 24))}</span>
      <button
        type="button"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "var(--color--text--tint-2, rgba(28,28,30,0.55))" }}
        onClick={() => setRevealed((v) => !v)}
        aria-label={revealed ? t("app.settings.apiKeys.action.hideKey") : t("app.settings.apiKeys.action.showKey")}
        data-testid="key-reveal-btn"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {revealed ? (
            <>
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </>
          ) : (
            <>
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </>
          )}
        </svg>
      </button>
    </span>
  );
}

export default function ApiKeysPage() {
  const { t } = useTranslation();
  const { keys, loading, error, createKey, revokeKey } = useApiKeysData();
  const openModal = useUIStore((s) => s.openModal);
  const { toast } = useToast();

  const handleCreate = useCallback(
    async (label: string, scopes: string[]): Promise<CreateApiKeyResult> => {
      const result = await createKey(label, scopes);
      toast.success(t("app.settings.apiKeys.toast.created"));
      return result;
    },
    [createKey, t, toast],
  );

  const handleRevoke = useCallback(
    async (id: string) => {
      try {
        await revokeKey(id);
        toast.success(t("app.settings.apiKeys.toast.revoked"));
      } catch {
        toast.error(t("app.settings.apiKeys.toast.revokeError"));
      }
    },
    [revokeKey, t, toast],
  );

  const handleCopyKey = useCallback(
    (keyMasked: string) => {
      void navigator.clipboard.writeText(keyMasked).then(() => {
        toast.info(t("app.settings.apiKeys.toast.copied"));
      });
    },
    [t, toast],
  );

  const columns: ColumnDef<ApiKey>[] = [
    {
      id: "label",
      header: t("app.settings.apiKeys.col.label"),
      accessorKey: "label",
      cell: ({ row }) => (
        <Text size="sm" weight="medium">
          {row.original.label}
        </Text>
      ),
    },
    {
      id: "key",
      header: t("app.settings.apiKeys.col.key"),
      cell: ({ row }) => <MaskedKey keyMasked={row.original.keyMasked} />,
      enableSorting: false,
    },
    {
      id: "scopes",
      header: t("app.settings.apiKeys.col.scopes"),
      cell: ({ row }) => (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {row.original.scopes.map((s) => (
            <Tag key={s} size="small" variant="default">
              {s}
            </Tag>
          ))}
        </div>
      ),
      enableSorting: false,
    },
    {
      id: "lastUsed",
      header: t("app.settings.apiKeys.col.lastUsed"),
      cell: ({ row }) => (
        <Text size="sm" style={{ color: "var(--color--text--tint-2, rgba(28,28,30,0.55))" }}>
          {relativeTime(row.original.lastUsedAt, t)}
        </Text>
      ),
    },
    {
      id: "created",
      header: t("app.settings.apiKeys.col.created"),
      accessorFn: (r) => r.createdAt,
      cell: ({ row }) => (
        <Text size="sm" style={{ color: "var(--color--text--tint-2, rgba(28,28,30,0.55))" }}>
          {formatDate(row.original.createdAt)}
        </Text>
      ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
          <Button
            size="xsmall"
            variant="ghost"
            iconLeft="copy"
            onClick={() => handleCopyKey(row.original.keyMasked)}
            aria-label={t("app.settings.apiKeys.action.copy")}
            data-testid={`copy-key-${row.original.id}`}
          >
            {t("app.settings.apiKeys.action.copy")}
          </Button>
          <Button
            size="xsmall"
            variant="destructive"
            iconLeft="trash-2"
            onClick={() => void handleRevoke(row.original.id)}
            aria-label={t("app.settings.apiKeys.action.revoke")}
            data-testid={`revoke-key-${row.original.id}`}
          >
            {t("app.settings.apiKeys.action.revoke")}
          </Button>
        </div>
      ),
    },
  ];

  const emptyState = (
    <div
      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "32px 0" }}
      data-testid="api-keys-empty"
    >
      <Text size="sm" style={{ color: "var(--color--text--tint-2, rgba(28,28,30,0.55))" }}>
        {t("app.settings.apiKeys.empty")}
      </Text>
      <Button
        variant="outline"
        size="small"
        iconLeft="plus"
        onClick={() => openModal(API_KEY_CREATE_MODAL)}
        data-testid="create-first-key-btn"
      >
        {t("app.settings.apiKeys.createFirst")}
      </Button>
    </div>
  );

  return (
    <div data-testid="api-keys-page">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <Heading level={2} size="xl">
          {t("app.settings.apiKeys.title")}
        </Heading>
        <Button
          variant="solid"
          size="small"
          iconLeft="plus"
          onClick={() => openModal(API_KEY_CREATE_MODAL)}
          data-testid="create-key-btn"
        >
          {t("app.settings.apiKeys.create")}
        </Button>
      </div>

      {error && (
        <div
          style={{
            marginBottom: 16,
            padding: "10px 14px",
            borderRadius: "var(--radius--3xs, 6px)",
            background: "rgba(255, 59, 48, 0.08)",
            border: "1px solid rgba(255, 59, 48, 0.2)",
            fontSize: 13,
            color: "var(--color--text, #1c1c1e)",
          }}
          role="alert"
          data-testid="api-keys-error"
        >
          {t("app.settings.apiKeys.loadError")}
        </div>
      )}

      <DataTable<ApiKey>
        data={keys}
        columns={columns}
        loading={loading}
        emptyState={emptyState}
        sortable
        bordered
        rowKey={(row) => row.id}
      />

      <CreateApiKeyModal onCreate={handleCreate} />
    </div>
  );
}
