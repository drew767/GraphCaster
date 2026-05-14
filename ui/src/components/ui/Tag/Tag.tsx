// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import { Icon, type IconName } from "../Icon/Icon";
import "./Tag.css";

export interface TagProps {
  variant?: "default" | "primary" | "success" | "warning" | "danger" | "info";
  size?: "small" | "medium";
  icon?: IconName;
  closable?: boolean;
  onClose?: () => void;
  children?: React.ReactNode;
  className?: string;
}

export function Tag({
  variant = "default",
  size = "medium",
  icon,
  closable = false,
  onClose,
  children,
  className,
}: TagProps) {
  const iconSize = size === "small" ? 10 : 12;

  const classes = [
    "gc-tag",
    `gc-tag--${variant}`,
    `gc-tag--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
      {closable && (
        <button
          type="button"
          className="gc-tag__close"
          onClick={onClose}
          aria-label="Remove"
        >
          <Icon name="x" size={iconSize} />
        </button>
      )}
    </span>
  );
}
