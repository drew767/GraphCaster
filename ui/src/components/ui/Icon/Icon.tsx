// Copyright GraphCaster. All Rights Reserved.

import { ICON_REGISTRY, type IconName } from "./registry";

export type { IconName };

export interface IconProps {
  name: IconName;
  size?: number | string;
  color?: string;
  className?: string;
  strokeWidth?: number;
  ariaLabel?: string;
}

export function Icon({
  name,
  size = 16,
  color,
  className,
  strokeWidth = 2,
  ariaLabel,
}: IconProps) {
  const Cmp = ICON_REGISTRY[name];
  if (!Cmp) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[Icon] unknown icon: ${name}`);
    }
    return null;
  }
  const sizeValue = typeof size === "number" ? `${size}px` : size;
  return (
    <Cmp
      width={sizeValue}
      height={sizeValue}
      stroke={color}
      strokeWidth={strokeWidth}
      className={className}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      focusable="false"
    />
  );
}
