// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import "./Heading.css";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type HeadingSize = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
export type HeadingWeight = "regular" | "medium" | "bold";
export type HeadingColor = "primary" | "secondary" | "tint";

export interface HeadingProps {
  level?: HeadingLevel;
  size?: HeadingSize;
  weight?: HeadingWeight;
  color?: HeadingColor;
  className?: string;
  children?: React.ReactNode;
}

export function Heading({
  level = 2,
  size,
  weight = "bold",
  color = "primary",
  className,
  children,
}: HeadingProps) {
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  const resolvedSize = size ?? levelToSize(level);

  const classes = [
    "gc-heading",
    `gc-heading--${resolvedSize}`,
    `gc-heading--${weight}`,
    `gc-heading--${color}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return <Tag className={classes}>{children}</Tag>;
}

function levelToSize(level: HeadingLevel): HeadingSize {
  switch (level) {
    case 1: return "2xl";
    case 2: return "xl";
    case 3: return "lg";
    case 4: return "md";
    case 5: return "sm";
    case 6: return "xs";
  }
}
