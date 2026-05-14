// Copyright GraphCaster. All Rights Reserved.

import React, { useRef } from "react";
import * as RxDialog from "@radix-ui/react-dialog";

import { Button } from "../Button/Button";
import "./AlertDialog.css";
import "../Dialog/Dialog.css";

export interface AlertDialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  loading?: boolean;
}

export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
  loading = false,
}: AlertDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  function handleCancel() {
    onCancel?.();
    onOpenChange?.(false);
  }

  async function handleConfirm() {
    await onConfirm();
  }

  return (
    <RxDialog.Root open={open} onOpenChange={onOpenChange} modal>
      <RxDialog.Portal>
        <RxDialog.Overlay className="gc-dialog-overlay" />
        <RxDialog.Content
          className="gc-dialog-content gc-dialog-content--small gc-alert-dialog-content"
          role="alertdialog"
          aria-modal="true"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            cancelRef.current?.focus();
          }}
        >
          <header className="gc-dialog-header">
            <RxDialog.Title>{title}</RxDialog.Title>
          </header>

          {description && (
            <RxDialog.Description className="gc-dialog-description">
              {description}
            </RxDialog.Description>
          )}

          <div className="gc-alert-dialog-actions">
            <RxDialog.Close asChild>
              <Button
                ref={cancelRef}
                variant="outline"
                size="small"
                onClick={handleCancel}
              >
                {cancelLabel}
              </Button>
            </RxDialog.Close>

            <Button
              variant={destructive ? "destructive" : "solid"}
              size="small"
              loading={loading}
              onClick={handleConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </RxDialog.Content>
      </RxDialog.Portal>
    </RxDialog.Root>
  );
}
