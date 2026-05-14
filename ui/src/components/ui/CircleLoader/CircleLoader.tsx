// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import "./CircleLoader.css";

export interface CircleLoaderProps {
  size?: number | string;
  color?: string;
  strokeWidth?: number;
  label?: string;
}

export function CircleLoader({
  size = 32,
  color = "currentColor",
  strokeWidth = 3,
  label = "Loading",
}: CircleLoaderProps) {
  const sizePx = typeof size === "number" ? `${size}px` : size;
  const viewSize = 32;
  const cx = viewSize / 2;
  const cy = viewSize / 2;
  const r = (viewSize - strokeWidth * 2) / 2;
  const circumference = 2 * Math.PI * r;
  const dashArray = `${circumference * 0.75} ${circumference * 0.25}`;

  return (
    <svg
      className="gc-circle-loader"
      width={sizePx}
      height={sizePx}
      viewBox={`0 0 ${viewSize} ${viewSize}`}
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
        strokeOpacity="0.2"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={cx}
        cy={cy}
        r={r}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={dashArray}
        strokeDashoffset="0"
      />
    </svg>
  );
}
