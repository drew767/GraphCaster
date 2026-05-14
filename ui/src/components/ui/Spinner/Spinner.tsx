// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import "./Spinner.css";

export interface SpinnerProps {
  size?: number | string;
  color?: string;
  strokeWidth?: number;
  label?: string;
}

export function Spinner({
  size = 16,
  color = "currentColor",
  strokeWidth = 2,
  label = "Loading",
}: SpinnerProps) {
  const sizePx = typeof size === "number" ? `${size}px` : size;
  const r = 6;
  const cx = 8;
  const cy = 8;

  return (
    <svg
      className="gc-spinner"
      width={sizePx}
      height={sizePx}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label={label}
      role="status"
      focusable="false"
    >
      <circle
        cx={cx}
        cy={cy}
        r={r}
        stroke={color}
        strokeOpacity="0.25"
        strokeWidth={strokeWidth}
      />
      <path
        d={`M${cx + r} ${cy}a${r} ${r} 0 0 0-${r}-${r}`}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </svg>
  );
}
