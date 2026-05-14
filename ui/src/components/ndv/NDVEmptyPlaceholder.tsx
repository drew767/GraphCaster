// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import { Icon } from "../ui/Icon/Icon";

export interface NDVEmptyPlaceholderProps {
  label: string;
}

export function NDVEmptyPlaceholder({ label }: NDVEmptyPlaceholderProps) {
  return (
    <div className="gc-ndv-empty">
      <Icon name="inbox" size={32} className="gc-ndv-empty__icon" />
      <span className="gc-ndv-empty__label">{label}</span>
    </div>
  );
}
