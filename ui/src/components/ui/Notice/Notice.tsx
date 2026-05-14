// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import { Icon } from "../Icon/Icon";
import type { IconName } from "../Icon/registry";
import "./Notice.css";

export type NoticeType = "success" | "warning" | "error" | "info";

export interface NoticeProps {
  type: NoticeType;
  children?: React.ReactNode;
  showIcon?: boolean;
  className?: string;
}

const TYPE_ICON: Record<NoticeType, IconName> = {
  success: "circle-check",
  warning: "triangle-alert",
  error: "circle-x",
  info: "info",
};

export function Notice({ type, children, showIcon = true, className }: NoticeProps) {
  const classes = ["gc-notice", `gc-notice--${type}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} role="note" data-type={type}>
      {showIcon && (
        <span className="gc-notice__icon" aria-hidden="true">
          <Icon name={TYPE_ICON[type]} size={13} />
        </span>
      )}
      <span className="gc-notice__text">{children}</span>
    </div>
  );
}
