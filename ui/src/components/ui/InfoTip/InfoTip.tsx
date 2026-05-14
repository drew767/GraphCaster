// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import { Icon } from "../Icon/Icon";
import type { IconName } from "../Icon/registry";
import { Tooltip } from "../Tooltip/Tooltip";
import "./InfoTip.css";

export interface InfoTipProps {
  children: React.ReactNode;
  icon?: IconName;
  iconSize?: number;
  side?: "top" | "bottom" | "left" | "right";
}

export function InfoTip({
  children,
  icon = "info",
  iconSize = 14,
  side = "top",
}: InfoTipProps) {
  return (
    <Tooltip content={children} side={side}>
      <span className="gc-infotip" role="button" tabIndex={0} aria-label="More information">
        <Icon name={icon} size={iconSize} />
      </span>
    </Tooltip>
  );
}
