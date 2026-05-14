// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import { Icon } from "../Icon/Icon";
import type { IconName } from "../Icon/registry";
import "./Callout.css";

export type CalloutType = "success" | "warning" | "error" | "info";

export interface CalloutProps {
  type: CalloutType;
  title?: React.ReactNode;
  children?: React.ReactNode;
  showIcon?: boolean;
  className?: string;
}

const TYPE_ICON: Record<CalloutType, IconName> = {
  success: "circle-check",
  warning: "triangle-alert",
  error: "circle-x",
  info: "info",
};

export function Callout({
  type,
  title,
  children,
  showIcon = true,
  className,
}: CalloutProps) {
  const classes = ["gc-callout", `gc-callout--${type}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} data-type={type}>
      {showIcon && (
        <span className="gc-callout__icon" aria-hidden="true">
          <Icon name={TYPE_ICON[type]} size={18} />
        </span>
      )}
      <div className="gc-callout__body">
        {title && <div className="gc-callout__title">{title}</div>}
        {children && <div className="gc-callout__content">{children}</div>}
      </div>
    </div>
  );
}
