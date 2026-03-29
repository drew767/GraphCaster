// Copyright GraphCaster. All Rights Reserved.

import { useEffect, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { KEYBOARD_SHORTCUTS_CATALOG } from "../lib/keyboardShortcutsCatalog";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function KeyboardShortcutsModal({ open, onClose }: Props) {
  const { t } = useTranslation();

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

  const onBackdropClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

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
        className="gc-modal gc-keyboard-shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gc-shortcuts-modal-title"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <h2 id="gc-shortcuts-modal-title" className="gc-modal-title">
          {t("app.shortcuts.modalTitle")}
        </h2>
        <p className="gc-modal-hint">{t("app.shortcuts.modalHint")}</p>
        <table className="gc-shortcuts-table">
          <thead>
            <tr>
              <th scope="col">{t("app.shortcuts.colAction")}</th>
              <th scope="col">{t("app.shortcuts.colKeys")}</th>
            </tr>
          </thead>
          <tbody>
            {KEYBOARD_SHORTCUTS_CATALOG.map((row) => (
              <tr key={row.actionKey}>
                <td>{t(row.actionKey)}</td>
                <td>
                  <kbd className="gc-kbd">{t(row.keysKey)}</kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="gc-modal-actions">
          <button type="button" className="gc-btn gc-btn-primary" onClick={onClose}>
            {t("app.shortcuts.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
