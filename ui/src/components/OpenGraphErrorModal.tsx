// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import type { AppMessagePresentation } from "../graph/openGraphErrorPresentation";
import { writeTextToClipboard } from "../lib/clipboardWrite";

type Props = {
  open: boolean;
  presentation: AppMessagePresentation | null;
  onClose: () => void;
};

export function OpenGraphErrorModal({ open, presentation, onClose }: Props) {
  const { t } = useTranslation();
  const [copyDone, setCopyDone] = useState(false);

  useEffect(() => {
    if (open) {
      setCopyDone(false);
    }
  }, [open, presentation?.copyText]);

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

  const onCopy = useCallback(async () => {
    if (!presentation) {
      return;
    }
    const ok = await writeTextToClipboard(presentation.copyText);
    setCopyDone(ok);
  }, [presentation]);

  if (!open || !presentation) {
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
        aria-labelledby="gc-app-message-title"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <h2 id="gc-app-message-title" className="gc-modal-title">
          {presentation.title}
        </h2>
        <p className="gc-modal-hint gc-modal-hint--prewrap">{presentation.message}</p>
        {presentation.copyText !== presentation.message ? (
          <pre className="gc-modal-detail" tabIndex={0}>
            {presentation.copyText}
          </pre>
        ) : null}
        <div className="gc-modal-actions">
          <button type="button" className="gc-btn" onClick={onClose}>
            {t("app.errors.openModal.close")}
          </button>
          <button type="button" className="gc-btn gc-btn-primary" onClick={() => void onCopy()}>
            {copyDone ? t("app.errors.openModal.copied") : t("app.errors.openModal.copy")}
          </button>
        </div>
      </div>
    </div>
  );
}
