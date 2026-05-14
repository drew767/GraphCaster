// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import { Icon, type IconName } from "../Icon/Icon";
import "./Pill.css";

export interface PillProps {
  variant?: "default" | "primary" | "success" | "warning" | "danger" | "info";
  size?: "small" | "medium";
  icon?: IconName;
  dot?: boolean;
  children?: React.ReactNode;
  className?: string;
}

export function Pill({
  variant = "default",
  size = "medium",
  icon,
  dot = false,
  children,
  className,
}: PillProps) {
  const iconSize = size === "small" ? 10 : 12;

  const classes = [
    "gc-pill",
    `gc-pill--${variant}`,
    `gc-pill--${size}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      {dot && <span className="gc-pill__dot" aria-hidden="true" />}
      {!dot && icon && <Icon name={icon} size={iconSize} />}
      {children}
    </span>
  );
}
