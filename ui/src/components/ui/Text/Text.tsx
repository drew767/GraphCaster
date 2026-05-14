// Copyright GraphCaster. All Rights Reserved.

import React from "react";

import "./Text.css";

export type TextAs = "p" | "span" | "div";
export type TextSize = "xs" | "sm" | "md" | "lg" | "small" | "medium" | "large" | "xsmall";
export type TextWeight = "regular" | "medium" | "bold";
export type TextColor =
  | "primary"
  | "secondary"
  | "tint"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "muted"
  | "subtle";
export type TextAlign = "left" | "center" | "right";

export interface TextProps {
  as?: TextAs;
  size?: TextSize;
  weight?: TextWeight;
  color?: TextColor;
  align?: TextAlign;
  truncate?: boolean | number;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

const SIZE_ALIAS: Record<string, string> = {
  xsmall: "xs",
  small: "sm",
  medium: "md",
  large: "lg",
};

const COLOR_ALIAS: Record<string, string> = {
  muted: "secondary",
  subtle: "secondary",
};

export function Text({
  as: Tag = "p",
  size = "md",
  weight = "regular",
  color = "primary",
  align,
  truncate,
  className,
  style: styleProp,
  children,
}: TextProps) {
  const resolvedSize = SIZE_ALIAS[size] ?? size;
  const resolvedColor = COLOR_ALIAS[color] ?? color;
  const classes = [
    "gc-text",
    `gc-text--${resolvedSize}`,
    `gc-text--${weight}`,
    `gc-text--${resolvedColor}`,
    align ? `gc-text--align-${align}` : "",
    truncate === true ? "gc-text--truncate" : "",
    typeof truncate === "number" ? "gc-text--clamp" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const clampStyle: React.CSSProperties =
    typeof truncate === "number" ? { WebkitLineClamp: truncate } : {};
  const mergedStyle = { ...(styleProp ?? {}), ...clampStyle };

  return (
    <Tag className={classes} style={Object.keys(mergedStyle).length ? mergedStyle : undefined}>
      {children}
    </Tag>
  );
}
