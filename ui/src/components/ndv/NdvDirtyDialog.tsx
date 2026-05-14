// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export type NdvDirtyDialogProps = {
  open: boolean;
  onDiscard: () => void;
  onCancel: () => void;
};

export function NdvDirtyDialog({ open, onDiscard, onCancel }: NdvDirtyDialogProps): JSX.Element | null {
  const { t } = useTranslation();
  const discardRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      discardRef.current?.focus();
    }
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="gc-ndv-dirty-dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="gc-ndv-dirty-title"
      aria-describedby="gc-ndv-dirty-body"
      data-testid="gc-ndv-dirty-dialog"
    >
      <div className="gc-ndv-dirty-dialog__backdrop" />
      <div className="gc-ndv-dirty-dialog__panel">
        <h3 id="gc-ndv-dirty-title" className="gc-ndv-dirty-dialog__title">
          {t("ndv.dirty.title")}
        </h3>
        <p id="gc-ndv-dirty-body" className="gc-ndv-dirty-dialog__body">
          {t("ndv.dirty.body")}
        </p>
        <div className="gc-ndv-dirty-dialog__actions">
          <button
            type="button"
            className="gc-ndv-dirty-dialog__cancel"
            onClick={onCancel}
            data-testid="gc-ndv-dirty-cancel"
          >
            {t("ndv.dirty.cancel")}
          </button>
          <button
            ref={discardRef}
            type="button"
            className="gc-ndv-dirty-dialog__discard"
            onClick={onDiscard}
            data-testid="gc-ndv-dirty-discard"
          >
            {t("ndv.dirty.discard")}
          </button>
        </div>
      </div>
    </div>
  );
}
