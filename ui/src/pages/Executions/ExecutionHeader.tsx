// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { writeTextToClipboard } from "../../lib/clipboardWrite";
import { useToast } from "../../toast/ToastProvider";
import { executionsApi, type ExecutionPayload, type RetryOptions } from "./executionsApi";
import { formatDurationMs, statusTagColor } from "./executionStatus";
import { navigateTo } from "./useParams";

export type HeaderHandlers = {
  onRetry?: (opts?: RetryOptions) => Promise<void> | void;
  onDelete?: () => Promise<void> | void;
  onShowRaw?: () => void;
};

type Props = {
  execution: ExecutionPayload;
  handlers?: HeaderHandlers;
};

function formatStarted(iso: string): string {
  if (!iso) {
    return "—";
  }
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) {
      return iso;
    }
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

export function ExecutionHeader({ execution, handlers }: Props) {
  const { t } = useTranslation();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onDocClick = (e: globalThis.MouseEvent) => {
      const el = menuRef.current;
      if (el && !el.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [menuOpen]);

  const copyRunId = async (e: MouseEvent) => {
    e.preventDefault();
    const ok = await writeTextToClipboard(execution.runId);
    toast.push(
      ok ? t("executions.detail.header.runIdCopied") : t("executions.detail.header.copyFailed"),
      ok ? "success" : "warn",
    );
  };

  const doRetry = async (opts?: RetryOptions) => {
    setMenuOpen(false);
    setPickerOpen(false);
    if (handlers?.onRetry) {
      await handlers.onRetry(opts);
    } else {
      await executionsApi.retry(execution.runId, opts);
    }
    toast.push(t("executions.detail.header.retryStarted"), "success");
  };

  const doDelete = async () => {
    setConfirmDelete(false);
    if (handlers?.onDelete) {
      await handlers.onDelete();
    } else {
      await executionsApi.delete(execution.runId);
      navigateTo("#/executions");
    }
    toast.push(t("executions.detail.header.deleted"), "info");
  };

  const goEditor = () => {
    setMenuOpen(false);
    const url = `/workflow/${encodeURIComponent(execution.workflowId)}?debugRunId=${encodeURIComponent(execution.runId)}`;
    if (typeof window !== "undefined") {
      window.location.href = url;
    }
  };

  return (
    <header
      className="gc-exec-header"
      data-testid="gc-exec-header"
      aria-label={t("executions.detail.header.aria")}
    >
      <div className="gc-exec-header__left">
        <a
          className="gc-exec-header__workflow"
          href={`/workflow/${encodeURIComponent(execution.workflowId)}`}
          data-testid="gc-exec-header-workflow-link"
        >
          {execution.workflowName || execution.workflowId}
        </a>
        <button
          type="button"
          className="gc-exec-header__runid"
          onClick={copyRunId}
          title={t("executions.detail.header.copyRunId")}
          aria-label={t("executions.detail.header.copyRunId")}
          data-testid="gc-exec-header-runid"
        >
          <code>{execution.runId}</code>
        </button>
        <span
          className="gc-tag gc-exec-header__status"
          style={{
            backgroundColor: statusTagColor(execution.status),
            color: "white",
          }}
          data-testid="gc-exec-header-status"
        >
          {t(`executions.detail.status.${execution.status}`)}
        </span>
        <span className="gc-exec-header__started">
          {t("executions.detail.header.startedAt")}: {formatStarted(execution.startedAt)}
        </span>
        <span className="gc-exec-header__duration">
          {t("executions.detail.header.duration")}: {formatDurationMs(execution.durationMs)}
        </span>
      </div>

      <div className="gc-exec-header__right">
        <button
          type="button"
          className="gc-btn"
          onClick={() => doRetry()}
          data-testid="gc-exec-header-retry"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
          <span>{t("executions.detail.header.retry")}</span>
        </button>

        <div className="gc-exec-header__menu" ref={menuRef}>
          <button
            type="button"
            className="gc-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            data-testid="gc-exec-header-menu-btn"
          >
            {t("executions.detail.header.moreActions")} ▾
          </button>
          {menuOpen ? (
            <div className="gc-exec-header__menu-pop" role="menu" data-testid="gc-exec-header-menu">
              <button
                type="button"
                role="menuitem"
                className="gc-exec-header__menu-item"
                onClick={() => {
                  setPickerOpen(true);
                  setMenuOpen(false);
                }}
                data-testid="gc-exec-header-retry-from-node"
              >
                {t("executions.detail.header.retryFromNode")}
              </button>
              <button
                type="button"
                role="menuitem"
                className="gc-exec-header__menu-item"
                onClick={goEditor}
                data-testid="gc-exec-header-debug"
              >
                {t("executions.detail.header.debugInEditor")}
              </button>
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className="gc-btn"
          onClick={() => handlers?.onShowRaw?.()}
          data-testid="gc-exec-header-show-raw"
        >
          {t("executions.detail.header.showRaw")}
        </button>

        <button
          type="button"
          className="gc-btn gc-btn-danger"
          onClick={() => setConfirmDelete(true)}
          data-testid="gc-exec-header-delete"
        >
          {t("executions.detail.header.delete")}
        </button>
      </div>

      {pickerOpen ? (
        <div
          className="gc-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setPickerOpen(false);
            }
          }}
        >
          <div
            className="gc-modal gc-exec-header__picker"
            role="dialog"
            aria-modal="true"
            aria-label={t("executions.detail.header.retryFromNodeTitle")}
            data-testid="gc-exec-header-picker"
          >
            <h3 className="gc-modal-title">
              {t("executions.detail.header.retryFromNodeTitle")}
            </h3>
            <ul className="gc-exec-header__picker-list">
              {execution.nodes.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    className="gc-btn"
                    onClick={() => doRetry({ fromNodeId: n.id })}
                    data-testid={`gc-exec-header-picker-node-${n.id}`}
                  >
                    {n.name}
                  </button>
                </li>
              ))}
            </ul>
            <div className="gc-modal-actions">
              <button type="button" className="gc-btn" onClick={() => setPickerOpen(false)}>
                {t("executions.detail.header.cancel")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmDelete ? (
        <div
          className="gc-modal-backdrop"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setConfirmDelete(false);
            }
          }}
        >
          <div
            className="gc-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="gc-exec-header-delete-title"
            data-testid="gc-exec-header-confirm-delete"
          >
            <h3 id="gc-exec-header-delete-title" className="gc-modal-title">
              {t("executions.detail.header.confirmDeleteTitle")}
            </h3>
            <p>{t("executions.detail.header.confirmDeleteBody")}</p>
            <div className="gc-modal-actions">
              <button type="button" className="gc-btn" onClick={() => setConfirmDelete(false)}>
                {t("executions.detail.header.cancel")}
              </button>
              <button
                type="button"
                className="gc-btn gc-btn-danger"
                onClick={doDelete}
                data-testid="gc-exec-header-confirm-delete-ok"
              >
                {t("executions.detail.header.delete")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
