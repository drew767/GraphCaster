// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  fileName: string;
  onReload: () => void;
  onOverwrite: () => void;
  onPauseAutosave: () => void;
};

export function WorkspaceFileConflictModal({
  open,
  fileName,
  onReload,
  onOverwrite,
  onPauseAutosave,
}: Props) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        onPauseAutosave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onPauseAutosave]);

  const onBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onPauseAutosave();
      }
    },
    [onPauseAutosave],
  );

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
        aria-labelledby="gc-ws-conflict-title"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <h2 id="gc-ws-conflict-title" className="gc-modal-title">
          {t("app.workspace.diskConflictTitle")}
        </h2>
        <p className="gc-modal-hint gc-modal-hint--prewrap">
          {t("app.workspace.diskConflictBody", { fileName })}
        </p>
        <div className="gc-modal-actions gc-modal-actions--wrap">
          <button type="button" className="gc-btn" onClick={onPauseAutosave}>
            {t("app.workspace.diskConflictPause")}
          </button>
          <button type="button" className="gc-btn gc-btn-primary" onClick={onReload}>
            {t("app.workspace.diskConflictReload")}
          </button>
          <button type="button" className="gc-btn gc-btn-danger" onClick={onOverwrite}>
            {t("app.workspace.diskConflictOverwrite")}
          </button>
        </div>
      </div>
    </div>
  );
}
