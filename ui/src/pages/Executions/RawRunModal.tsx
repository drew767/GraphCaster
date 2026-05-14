// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { writeTextToClipboard } from "../../lib/clipboardWrite";
import type { ExecutionPayload } from "./executionsApi";

type Props = {
  open: boolean;
  onClose: () => void;
  payload: ExecutionPayload | null;
  onCopied?: (ok: boolean) => void;
};

export function RawRunModal({ open, onClose, payload, onCopied }: Props) {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setCopied(false);
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

  const fullText = useMemo(() => {
    if (!payload) {
      return "";
    }
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return "";
    }
  }, [payload]);

  const filteredText = useMemo(() => {
    const q = search.trim();
    if (!q) {
      return fullText;
    }
    return fullText
      .split("\n")
      .filter((line) => line.includes(q))
      .join("\n");
  }, [fullText, search]);

  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const onCopy = async () => {
    const ok = await writeTextToClipboard(fullText);
    setCopied(ok);
    if (onCopied) {
      onCopied(ok);
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="gc-modal-backdrop" role="presentation" onClick={onBackdropClick}>
      <div
        className="gc-modal gc-modal--large gc-raw-run-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gc-raw-run-modal-title"
        data-testid="gc-raw-run-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="gc-modal-header">
          <h2 id="gc-raw-run-modal-title" className="gc-modal-title">
            {t("executions.detail.raw.title")}
          </h2>
          <div className="gc-modal-header-actions">
            <input
              type="search"
              className="gc-input"
              placeholder={t("executions.detail.raw.searchPlaceholder")}
              aria-label={t("executions.detail.raw.searchAria")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="gc-raw-run-search"
            />
            <button
              type="button"
              className="gc-btn"
              onClick={onCopy}
              data-testid="gc-raw-run-copy"
            >
              {copied ? t("executions.detail.raw.copied") : t("executions.detail.raw.copy")}
            </button>
            <button
              type="button"
              className="gc-btn"
              onClick={onClose}
              aria-label={t("executions.detail.raw.close")}
            >
              {t("executions.detail.raw.close")}
            </button>
          </div>
        </header>
        <pre className="gc-raw-run-modal__pre" data-testid="gc-raw-run-pre">
          {filteredText}
        </pre>
      </div>
    </div>
  );
}
