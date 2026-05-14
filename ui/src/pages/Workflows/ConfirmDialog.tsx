// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";
import { ModalShell } from "./ModalShell";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
  destructive?: boolean;
  confirmLabel?: string;
}

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element | null {
  const { open, title, message, onCancel, onConfirm, destructive, confirmLabel } = props;
  const { t } = useTranslation();
  if (!open) return null;
  return (
    <ModalShell
      title={title}
      onClose={onCancel}
      testId="confirm-dialog"
      footer={
        <>
          <button
            type="button"
            data-testid="confirm-cancel"
            onClick={onCancel}
            style={{
              padding: "5px 12px",
              border: "1px solid var(--gc-border)",
              borderRadius: "var(--gc-radius-sm)",
              background: "var(--gc-surface-1)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {t("workflows.common.cancel")}
          </button>
          <button
            type="button"
            data-testid="confirm-ok"
            onClick={onConfirm}
            style={{
              padding: "5px 12px",
              border: "1px solid var(--gc-border)",
              borderRadius: "var(--gc-radius-sm)",
              background: destructive ? "#c83a3a" : "var(--gc-accent)",
              color: "white",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            {confirmLabel ?? t("workflows.common.confirm")}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13, color: "var(--gc-text-primary)" }}>{message}</div>
    </ModalShell>
  );
}
