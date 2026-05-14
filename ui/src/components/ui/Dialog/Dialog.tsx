// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import * as RxDialog from "@radix-ui/react-dialog";

import { Icon } from "../Icon/Icon";
import "./Dialog.css";

export type DialogSize =
  | "small"
  | "medium"
  | "large"
  | "xlarge"
  | "2xlarge"
  | "fit"
  | "full"
  | "cover";

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  size?: DialogSize;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  showCloseButton?: boolean;
  closeOnOverlayClick?: boolean;
  closeOnEsc?: boolean;
  trapFocus?: boolean;
  modal?: boolean;
  className?: string;
  trigger?: React.ReactElement;
  ariaLabel?: string;
}

export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  size = "medium",
  title,
  description,
  children,
  footer,
  showCloseButton = true,
  closeOnOverlayClick = true,
  closeOnEsc = true,
  trapFocus = true,
  modal = true,
  className,
  trigger,
  ariaLabel,
}: DialogProps) {
  return (
    <RxDialog.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      modal={modal}
    >
      {trigger && (
        <RxDialog.Trigger asChild>{trigger}</RxDialog.Trigger>
      )}

      <RxDialog.Portal>
        <RxDialog.Overlay className="gc-dialog-overlay" />
        <RxDialog.Content
          className={[
            "gc-dialog-content",
            `gc-dialog-content--${size}`,
            className,
          ]
            .filter(Boolean)
            .join(" ")}
          onPointerDownOutside={(e) => {
            if (!closeOnOverlayClick) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (!closeOnEsc) e.preventDefault();
          }}
          onOpenAutoFocus={trapFocus ? undefined : (e) => e.preventDefault()}
          aria-label={!title ? ariaLabel : undefined}
        >
          {title && (
            <header className="gc-dialog-header">
              <RxDialog.Title>{title}</RxDialog.Title>
              {showCloseButton && (
                <RxDialog.Close
                  className="gc-dialog-close"
                  aria-label="Close"
                >
                  <Icon name="x" size={16} />
                </RxDialog.Close>
              )}
            </header>
          )}

          {description && (
            <RxDialog.Description className="gc-dialog-description">
              {description}
            </RxDialog.Description>
          )}

          <div className="gc-dialog-body">{children}</div>

          {footer && (
            <footer className="gc-dialog-footer">{footer}</footer>
          )}
        </RxDialog.Content>
      </RxDialog.Portal>
    </RxDialog.Root>
  );
}
