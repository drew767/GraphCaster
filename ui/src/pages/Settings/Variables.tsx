// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";

import {
  AlertDialog,
  Button,
  DataTable,
  EmptyState,
  Heading,
  Tag,
} from "../../components/ui";
import { useToast } from "../../toast/ToastProvider";
import { variablesApi, type Variable, type VariableInput } from "../../api/variables";
import { VariableEditModal } from "./VariableEditModal";

function formatValue(v: Variable): string {
  if (v.value === null || v.value === undefined) return "";
  if (v.type === "json") {
    try {
      return JSON.stringify(v.value);
    } catch {
      return String(v.value);
    }
  }
  if (v.type === "boolean") return v.value ? "true" : "false";
  return String(v.value);
}

function formatModified(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function MaskedValue({ variable }: { variable: Variable }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  const display = formatValue(variable);

  if (!variable.isSecret) {
    return (
      <span style={{ fontFamily: "monospace", fontSize: 12 }} data-testid={`variable-value-${variable.id}`}>
        {display}
      </span>
    );
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "monospace", fontSize: 12 }}>
      <span data-testid={`variable-value-${variable.id}`}>
        {revealed ? display : "•".repeat(Math.min(Math.max(display.length, 6), 24))}
      </span>
      <button
        type="button"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 2,
          color: "var(--color--text--tint-2, rgba(28,28,30,0.55))",
        }}
        onClick={() => setRevealed((v) => !v)}
        aria-label={
          revealed ? t("app.settings.variables.action.hideValue") : t("app.settings.variables.action.showValue")
        }
        data-testid={`variable-reveal-${variable.id}`}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
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

export default function VariablesPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [items, setItems] = useState<Variable[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Variable | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Variable | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await variablesApi.list();
      setItems(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleNew = () => {
    setEditing(null);
    setModalOpen(true);
  };

  const handleEdit = (v: Variable) => {
    setEditing(v);
    setModalOpen(true);
  };

  const handleSubmit = useCallback(
    async (input: VariableInput) => {
      if (editing) {
        await variablesApi.update(editing.id, input);
        toast.push(t("app.settings.variables.toast.updated"), "success");
      } else {
        await variablesApi.create(input);
        toast.push(t("app.settings.variables.toast.created"), "success");
      }
      await refresh();
    },
    [editing, refresh, t, toast],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmDelete) return;
    try {
      await variablesApi.delete(confirmDelete.id);
      toast.push(t("app.settings.variables.toast.deleted"), "success");
      setConfirmDelete(null);
      await refresh();
    } catch {
      toast.push(t("app.settings.variables.toast.deleteFailed"), "warn");
    }
  }, [confirmDelete, refresh, t, toast]);

  const columns: ColumnDef<Variable>[] = useMemo(
    () => [
      {
        id: "key",
        header: t("app.settings.variables.col.key"),
        accessorKey: "key",
        cell: ({ row }) => (
          <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 500 }}>
            {row.original.key}
          </span>
        ),
      },
      {
        id: "value",
        header: t("app.settings.variables.col.value"),
        cell: ({ row }) => <MaskedValue variable={row.original} />,
        enableSorting: false,
      },
      {
        id: "type",
        header: t("app.settings.variables.col.type"),
        cell: ({ row }) => (
          <Tag size="small" variant="default">
            {t(`app.settings.variables.types.${row.original.type}`)}
          </Tag>
        ),
      },
      {
        id: "modified",
        header: t("app.settings.variables.col.modified"),
        cell: ({ row }) => (
          <span style={{ fontSize: 13, color: "var(--color--text--tint-2, rgba(28,28,30,0.55))" }}>
            {formatModified(row.original.updatedAt)}
          </span>
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
              iconLeft="pencil"
              onClick={() => handleEdit(row.original)}
              aria-label={t("app.settings.variables.action.edit")}
              data-testid={`variable-edit-${row.original.id}`}
            >
              {t("app.settings.variables.action.edit")}
            </Button>
            <Button
              size="xsmall"
              variant="destructive"
              iconLeft="trash-2"
              onClick={() => setConfirmDelete(row.original)}
              aria-label={t("app.settings.variables.action.delete")}
              data-testid={`variable-delete-${row.original.id}`}
            >
              {t("app.settings.variables.action.delete")}
            </Button>
          </div>
        ),
      },
    ],
    [t],
  );

  const emptyState = (
    <EmptyState
      icon="settings"
      title={t("app.settings.variables.emptyTitle")}
      description={t("app.settings.variables.emptyDescription")}
      action={{
        label: t("app.settings.variables.create"),
        onClick: handleNew,
      }}
    />
  );

  return (
    <div data-testid="variables-page">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <Heading level={2} size="xl">
          {t("app.settings.variables.title")}
        </Heading>
        <Button
          variant="solid"
          size="small"
          iconLeft="plus"
          onClick={handleNew}
          data-testid="variable-new-btn"
        >
          {t("app.settings.variables.create")}
        </Button>
      </div>

      <DataTable<Variable>
        data={items}
        columns={columns}
        loading={loading}
        emptyState={emptyState}
        sortable
        bordered
        rowKey={(row) => row.id}
      />

      <VariableEditModal
        open={modalOpen}
        initial={editing}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
      />

      <AlertDialog
        open={confirmDelete !== null}
        onOpenChange={(o) => {
          if (!o) setConfirmDelete(null);
        }}
        title={t("app.settings.variables.deleteTitle")}
        description={
          confirmDelete
            ? t("app.settings.variables.deleteDescription", { key: confirmDelete.key })
            : undefined
        }
        confirmLabel={t("app.settings.variables.deleteConfirm")}
        cancelLabel={t("app.settings.variables.deleteCancel")}
        destructive
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
