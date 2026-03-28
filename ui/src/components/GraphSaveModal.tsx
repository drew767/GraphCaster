// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import type { GraphDocumentJson } from "../graph/types";
import { saveJsonWithFilePickerOrDownload } from "../lib/saveToDisk";
import type { WorkspaceGraphEntry } from "../lib/workspaceFs";

type SaveFieldIssue = { kind: "empty_name" } | { kind: "write_failed"; detail: string | null };

type Props = {
  open: boolean;
  suggestedFileName: string;
  workspaceLinked: boolean;
  workspaceEntries: WorkspaceGraphEntry[];
  getDocument: () => GraphDocumentJson | null;
  onSaveToWorkspace: (fileName: string, doc: GraphDocumentJson) => Promise<boolean>;
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

  useEffect(() => {
    if (open) {
      setFileName(suggestedFileName);
      setSaveIssue(null);
    }
  }, [open, suggestedFileName]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const onBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  const handleSave = useCallback(async () => {
    const doc = getDocument();
    if (!doc) {
      return;
    }
    const trimmed = fileName.trim();
    if (trimmed === "") {
      setSaveIssue({ kind: "empty_name" });
      return;
    }
    if (workspaceLinked) {
      const ok = await onSaveToWorkspace(trimmed, doc);
      if (ok) {
        onClose();
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
          <p
            id="gc-save-modal-error"
            className="gc-modal-hint gc-modal-hint--error gc-modal-hint--prewrap"
            role="alert"
          >
            {saveIssue.kind === "empty_name"
              ? t("app.saveModal.emptyName")
              : saveIssue.detail != null
                ? `${t("app.saveModal.writeFailed")}\n\n${saveIssue.detail}`
                : t("app.saveModal.writeFailed")}
          </p>
        ) : null}
        <div className="gc-modal-actions">
          <button type="button" className="gc-btn" onClick={onClose}>
            {t("app.saveModal.cancel")}
          </button>
          <button type="button" className="gc-btn gc-btn-primary" onClick={() => void handleSave()}>
            {t("app.saveModal.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
