// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import { Icon } from "../Icon/Icon";
import type { IconName } from "../Icon/registry";
import "./Alert.css";

export type AlertType = "success" | "warning" | "error" | "info";
export type AlertVariant = "filled" | "outlined" | "subtle";

export interface AlertProps {
  type: AlertType;
  title?: React.ReactNode;
  description?: React.ReactNode;
  closable?: boolean;
  onClose?: () => void;
  showIcon?: boolean;
  variant?: AlertVariant;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

const TYPE_ICON: Record<AlertType, IconName> = {
  success: "circle-check",
  warning: "triangle-alert",
  error: "circle-x",
  info: "info",
};

export function Alert({
  type,
  title,
  description,
  closable = false,
  onClose,
  showIcon = true,
  variant = "subtle",
  action,
  className,
  children,
}: AlertProps) {
  const classes = [
    "gc-alert",
    `gc-alert--${type}`,
    `gc-alert--${variant}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="alert" data-type={type} data-variant={variant}>
      {showIcon && (
        <span className="gc-alert__icon" aria-hidden="true">
          <Icon name={TYPE_ICON[type]} size={16} />
        </span>
      )}
      <div className="gc-alert__body">
        {title && <div className="gc-alert__title">{title}</div>}
        {description && <div className="gc-alert__description">{description}</div>}
        {children && <div className="gc-alert__description">{children}</div>}
      </div>
      {action && <div className="gc-alert__action">{action}</div>}
      {closable && (
        <button
          type="button"
          className="gc-alert__close"
          aria-label="Dismiss"
          onClick={onClose}
        >
          <Icon name="x" size={14} />
        </button>
      )}
    </div>
  );
}
