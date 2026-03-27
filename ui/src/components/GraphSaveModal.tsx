// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import type { GraphDocumentJson } from "../graph/types";
import { saveJsonWithFilePickerOrDownload } from "../lib/saveToDisk";
import type { WorkspaceGraphEntry } from "../lib/workspaceFs";

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

  useEffect(() => {
    if (open) {
      setFileName(suggestedFileName);
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
      window.alert(t("app.saveModal.emptyName"));
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
      window.alert(t("app.saveModal.writeFailed"));
    }
  }, [fileName, getDocument, onClose, onSaveToWorkspace, t, workspaceLinked]);

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
          onChange={(ev) => {
            setFileName(ev.target.value);
          }}
          spellCheck={false}
          autoComplete="off"
        />
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
