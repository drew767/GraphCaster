// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import "./Badge.css";

export interface BadgeProps {
  count?: number;
  text?: string;
  max?: number;
  variant?: "primary" | "danger" | "success" | "neutral";
  size?: "small" | "medium";
  dot?: boolean;
  className?: string;
}

export function Badge({
  count,
  text,
  max = 99,
  variant = "primary",
  size = "medium",
  dot = false,
  className,
}: BadgeProps) {
  let label: string | undefined;

  if (!dot) {
    if (text !== undefined) {
      label = text;
    } else if (count !== undefined) {
      label = count > max ? `${max}+` : String(count);
    }
  }

  const classes = [
    "gc-badge",
    `gc-badge--${variant}`,
    `gc-badge--${size}`,
    dot ? "gc-badge--dot" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} aria-label={dot ? undefined : label}>
      {!dot && label}
    </span>
  );
}
