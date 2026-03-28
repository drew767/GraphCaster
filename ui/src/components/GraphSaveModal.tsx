// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import type { GraphDocumentJson } from "../graph/types";
import { writeTextToClipboard } from "../lib/clipboardWrite";
import { saveJsonWithFilePickerOrDownload } from "../lib/saveToDisk";
import type { WorkspaceGraphEntry } from "../lib/workspaceFs";

export type GraphSaveToWorkspaceResult =
  | { ok: true }
  | { ok: false; reason: "no_workspace" }
  | { ok: false; reason: "duplicate_graph_id"; conflictingFile: string }
  | { ok: false; reason: "write_failed"; detail: string | null };

type SaveFieldIssue =
  | { kind: "empty_name" }
  | { kind: "write_failed"; detail: string | null }
  | { kind: "duplicate_graph_id"; conflictingFile: string }
  | { kind: "workspace_write_failed"; detail: string | null }
  | { kind: "workspace_unavailable" }
  | { kind: "document_unavailable" };

type Props = {
  open: boolean;
  suggestedFileName: string;
  workspaceLinked: boolean;
  workspaceEntries: WorkspaceGraphEntry[];
  getDocument: () => GraphDocumentJson | null;
  onSaveToWorkspace: (fileName: string, doc: GraphDocumentJson) => Promise<GraphSaveToWorkspaceResult>;
  onClose: () => void;
};

export function GraphSaveModal({
  open,
  suggestedFileName,
  workspaceLinked,
  workspaceEntries,
  getDocument,
  onSaveToWorkspace,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const [fileName, setFileName] = useState("");
  const [saveIssue, setSaveIssue] = useState<SaveFieldIssue | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [copyDone, setCopyDone] = useState(false);
  const isSavingRef = useRef(false);

  useEffect(() => {
    isSavingRef.current = isSaving;
  }, [isSaving]);

  const safeClose = useCallback(() => {
    if (isSavingRef.current) {
      return;
    }
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (open) {
      setFileName(suggestedFileName);
      setSaveIssue(null);
    }
  }, [open, suggestedFileName]);

  useEffect(() => {
    setCopyDone(false);
  }, [saveIssue]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        safeClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, safeClose]);

  const onBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        safeClose();
      }
    },
    [safeClose],
  );

  const handleCopyIssue = useCallback(async () => {
    if (saveIssue == null) {
      return;
    }
    const text = formatSaveIssueMessage(saveIssue, t);
    const ok = await writeTextToClipboard(text);
    setCopyDone(ok);
  }, [saveIssue, t]);

  const handleSave = useCallback(async () => {
    const doc = getDocument();
    if (!doc) {
      setSaveIssue({ kind: "document_unavailable" });
      return;
    }
    const trimmed = fileName.trim();
    if (trimmed === "") {
      setSaveIssue({ kind: "empty_name" });
      return;
    }
    setIsSaving(true);
    try {
      if (workspaceLinked) {
        const result = await onSaveToWorkspace(trimmed, doc);
        if (result.ok) {
          onClose();
          return;
        }
        if (result.reason === "duplicate_graph_id") {
          setSaveIssue({ kind: "duplicate_graph_id", conflictingFile: result.conflictingFile });
          return;
        }
        if (result.reason === "write_failed") {
          setSaveIssue({ kind: "workspace_write_failed", detail: result.detail });
          return;
        }
        if (result.reason === "no_workspace") {
          setSaveIssue({ kind: "workspace_unavailable" });
          return;
        }
        return;
      }
      try {
        await saveJsonWithFilePickerOrDownload(trimmed, doc);
        onClose();
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          return;
        }
        const raw = e instanceof Error ? e.message : String(e);
        const d = raw.trim();
        setSaveIssue({ kind: "write_failed", detail: d === "" ? null : d });
      }
    } finally {
      setIsSaving(false);
    }
  }, [fileName, getDocument, onClose, onSaveToWorkspace, workspaceLinked]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="gc-modal-backdrop"
      role="presentation"
      onClick={onBackdropClick}
    >
      <div
        className="gc-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gc-save-modal-title"
        aria-busy={isSaving}
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <h2 id="gc-save-modal-title" className="gc-modal-title">
          {t("app.saveModal.title")}
        </h2>
        {workspaceLinked ? (
          <>
            <p className="gc-modal-hint">{t("app.saveModal.pickCardHint")}</p>
            <div className="gc-save-grid">
              {workspaceEntries.length === 0 ? (
                <p className="gc-save-grid-empty">{t("app.saveModal.noFilesYet")}</p>
              ) : (
                workspaceEntries.map((e) => {
                  const selected = fileName === e.fileName;
                  return (
                    <button
                      key={e.fileName}
                      type="button"
                      className={`gc-save-card${selected ? " gc-save-card--selected" : ""}${e.duplicateGraphId ? " gc-save-card--warn" : ""}`}
                      disabled={isSaving}
                      onClick={() => {
                        setFileName(e.fileName);
                        setSaveIssue(null);
                      }}
                    >
                      <span className="gc-save-card__glyph" aria-hidden="true" />
                      <span className="gc-save-card__title">
                        {e.title != null && e.title !== "" ? e.title : e.fileName}
                      </span>
                      <span className="gc-save-card__file">{e.fileName}</span>
                      <span className="gc-save-card__id">{e.graphId}</span>
                    </button>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <p className="gc-modal-hint">{t("app.saveModal.noWorkspaceHint")}</p>
        )}
        <label className="gc-modal-field-label" htmlFor="gc-save-filename">
          {t("app.saveModal.fileName")}
        </label>
        <input
          id="gc-save-filename"
          className="gc-modal-input"
          type="text"
          value={fileName}
          disabled={isSaving}
          aria-invalid={saveIssue?.kind === "empty_name"}
          aria-describedby={saveIssue != null ? "gc-save-modal-error" : undefined}
          onChange={(ev) => {
            setFileName(ev.target.value);
            setSaveIssue(null);
          }}
          spellCheck={false}
          autoComplete="off"
        />
        {saveIssue != null ? (
          <div className="gc-save-modal-error-block">
            <p
              id="gc-save-modal-error"
              className="gc-modal-hint gc-modal-hint--error gc-modal-hint--prewrap"
              role="alert"
            >
              {formatSaveIssueMessage(saveIssue, t)}
            </p>
            <button
              type="button"
              className="gc-btn gc-btn-small"
              disabled={isSaving}
              onClick={() => void handleCopyIssue()}
            >
              {copyDone ? t("app.errors.openModal.copied") : t("app.errors.openModal.copy")}
            </button>
          </div>
        ) : null}
        <div className="gc-modal-actions">
          <button type="button" className="gc-btn" disabled={isSaving} onClick={safeClose}>
            {t("app.saveModal.cancel")}
          </button>
          <button
            type="button"
            className="gc-btn gc-btn-primary"
            disabled={isSaving}
            onClick={() => void handleSave()}
          >
            {t("app.saveModal.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatSaveIssueMessage(issue: SaveFieldIssue, t: TFunction): string {
  switch (issue.kind) {
    case "empty_name":
      return t("app.saveModal.emptyName");
    case "document_unavailable":
      return t("app.saveModal.documentUnavailable");
    case "duplicate_graph_id":
      return t("app.workspace.duplicateGraphId", { file: issue.conflictingFile });
    case "workspace_write_failed":
      return issue.detail != null
        ? `${t("app.workspace.writeFailed")}\n\n${issue.detail}`
        : t("app.workspace.writeFailed");
    case "workspace_unavailable":
      return t("app.saveModal.workspaceUnavailable");
    case "write_failed":
      return issue.detail != null
        ? `${t("app.saveModal.writeFailed")}\n\n${issue.detail}`
        : t("app.saveModal.writeFailed");
  }
}
