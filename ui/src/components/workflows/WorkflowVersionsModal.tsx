// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../ui/Icon/Icon";
import { useUIStore } from "../../app/stores/uiStore";
import { useToast } from "../../toast/ToastProvider";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const VERSIONS_MODAL_KEY = "workflow-versions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkflowVersion {
  version: number;
  hash?: string;
  author?: string;
  date?: string;
  message?: string;
}

interface VersionsPayload {
  graphId: string;
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

async function fetchVersions(graphId: string): Promise<WorkflowVersion[]> {
  const resp = await fetch(`/api/v1/graphs/${graphId}/versions`);
  if (resp.status === 404) {
    const err = new Error("not_found");
    err.name = "NotFound";
    throw err;
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<WorkflowVersion[]>;
}

async function rollbackWorkflow(graphId: string, version: number): Promise<void> {
  const resp = await fetch(`/api/v1/graphs/${graphId}/rollback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ version }),
  });
  if (resp.status === 404) {
    const err = new Error("not_found");
    err.name = "NotFound";
    throw err;
  }
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
}

// ---------------------------------------------------------------------------
// Version row
// ---------------------------------------------------------------------------

interface VersionRowProps {
  version: WorkflowVersion;
  onView: (v: WorkflowVersion) => void;
  onRestore: (v: WorkflowVersion) => void;
  onDiff: (v: WorkflowVersion) => void;
  restoring: boolean;
}

function VersionRow({ version, onView, onRestore, onDiff, restoring }: VersionRowProps) {
  const { t } = useTranslation();

  return (
    <div className="gc-versions-row" data-testid={`version-row-${version.version}`}>
      <div className="gc-versions-row__info">
        <span className="gc-versions-row__num" data-testid={`version-num-${version.version}`}>
          v{version.version}
        </span>
        {version.hash && (
          <span className="gc-versions-row__hash" title={version.hash}>
            {version.hash.slice(0, 8)}
          </span>
        )}
        {version.message && (
          <span className="gc-versions-row__message">{version.message}</span>
        )}
        <div className="gc-versions-row__meta">
          {version.author && (
            <span className="gc-versions-row__author">
              {version.author}
            </span>
          )}
          {version.date && (
            <span className="gc-versions-row__date">
              {version.date}
            </span>
          )}
        </div>
      </div>
      <div className="gc-versions-row__actions">
        <button
          type="button"
          className="gc-btn"
          onClick={() => onView(version)}
          disabled={restoring}
          data-testid={`version-view-${version.version}`}
        >
          {t("app.workflows.versioning.actionView")}
        </button>
        <button
          type="button"
          className="gc-btn"
          onClick={() => onDiff(version)}
          disabled={restoring}
          data-testid={`version-diff-${version.version}`}
        >
          {t("app.workflows.versioning.actionDiff")}
        </button>
        <button
          type="button"
          className="gc-btn"
          onClick={() => onRestore(version)}
          disabled={restoring}
          data-testid={`version-restore-${version.version}`}
        >
          {t("app.workflows.versioning.actionRestore")}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface WorkflowVersionsModalProps {
  onOpenDiff?: (graphId: string, versionA: number, versionB: number) => void;
}

export function WorkflowVersionsModal({ onOpenDiff }: WorkflowVersionsModalProps) {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.isModalOpen(VERSIONS_MODAL_KEY));
  const payload = useUIStore((s) => s.getModalPayload<VersionsPayload>(VERSIONS_MODAL_KEY));
  const closeModal = useUIStore((s) => s.closeModal);
  const { toast } = useToast();

  const [versions, setVersions] = useState<WorkflowVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const restoringRef = useRef(false);

  // Keep stable refs so that useEffect doesn't re-run when toast/t identity changes
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tRef = useRef(t);
  tRef.current = t;

  const graphId = payload?.graphId ?? "";

  useEffect(() => {
    if (!open || !graphId) return;

    let cancelled = false;
    setLoading(true);
    setVersions([]);

    fetchVersions(graphId)
      .then((v) => {
        if (!cancelled) setVersions(v);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof Error && e.name === "NotFound") {
          toastRef.current.warning(tRef.current("app.workflows.versioning.versionsNotFound"));
        } else {
          toastRef.current.error(tRef.current("app.workflows.versioning.versionsLoadError"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, graphId]);

  const handleClose = useCallback(() => {
    if (restoringRef.current) return;
    closeModal(VERSIONS_MODAL_KEY);
  }, [closeModal]);

  const onBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) handleClose();
    },
    [handleClose],
  );

  const handleView = useCallback((v: WorkflowVersion) => {
    toast.info(t("app.workflows.versioning.viewPlaceholder", { version: v.version }));
  }, [toast, t]);

  const handleRestore = useCallback(async (v: WorkflowVersion) => {
    if (!graphId || restoringRef.current) return;
    restoringRef.current = true;
    setRestoring(true);
    try {
      await rollbackWorkflow(graphId, v.version);
      toast.success(t("app.workflows.versioning.restoreSuccess", { version: v.version }));
      closeModal(VERSIONS_MODAL_KEY);
    } catch (e) {
      if (e instanceof Error && e.name === "NotFound") {
        toast.warning(t("app.workflows.versioning.restoreNotFound"));
      } else {
        toast.error(t("app.workflows.versioning.restoreError"));
      }
    } finally {
      restoringRef.current = false;
      setRestoring(false);
    }
  }, [graphId, toast, t, closeModal]);

  const handleDiff = useCallback((v: WorkflowVersion) => {
    if (!graphId || versions.length < 1) return;
    const latest = versions[0];
    if (onOpenDiff && latest) {
      onOpenDiff(graphId, latest.version, v.version);
    } else {
      toast.info(t("app.workflows.versioning.diffPlaceholder", { version: v.version }));
    }
  }, [graphId, versions, onOpenDiff, toast, t]);

  if (!open) return null;

  return (
    <div
      className="gc-modal-backdrop"
      role="presentation"
      onClick={onBackdropClick}
    >
      <div
        className="gc-modal gc-versions-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gc-versions-modal-title"
        data-testid="versions-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="gc-modal-header">
          <h2 id="gc-versions-modal-title" className="gc-modal-title">
            {t("app.workflows.versioning.versionsTitle")}
          </h2>
          <button
            type="button"
            className="gc-modal-close"
            aria-label={t("app.modal.close", "Close")}
            onClick={handleClose}
          >
            ×
          </button>
        </div>

        <div className="gc-modal-body">
          {loading && (
            <div className="gc-versions-modal__loading" data-testid="versions-loading">
              {t("app.workflows.versioning.loading")}
            </div>
          )}

          {!loading && versions.length === 0 && (
            <div className="gc-versions-modal__empty" data-testid="versions-empty">
              <Icon name="git-branch" size={32} />
              <p>{t("app.workflows.versioning.versionsEmpty")}</p>
            </div>
          )}

          {!loading && versions.length > 0 && (
            <div className="gc-versions-modal__list" data-testid="versions-list">
              {versions.map((v) => (
                <VersionRow
                  key={v.version}
                  version={v}
                  onView={handleView}
                  onRestore={(ver) => void handleRestore(ver)}
                  onDiff={handleDiff}
                  restoring={restoring}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
