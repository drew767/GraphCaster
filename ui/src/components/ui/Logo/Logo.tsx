// Copyright GraphCaster. All Rights Reserved.

import React from "react";

export interface LogoProps {
  variant?: "icon" | "wordmark" | "full";
  size?: number;
  theme?: "light" | "dark" | "auto";
  className?: string;
}

/*
 * Glyph design: a directed graph with three nodes.
 *
 * Layout (24x24 viewBox):
 *   Node A — top-left   circle at (6, 6)
 *   Node B — bottom     circle at (12, 18)
 *   Node C — right      circle at (20, 10)
 *
 * Edges (arrows drawn with arrowhead markers):
 *   A → C  (top-left to right)
 *   A → B  (top-left to bottom)
 *   B → C  (bottom to right)
 *
 * Style: monoline, stroke-width 1.5, stroke-linecap/linejoin round.
 * Uses currentColor so it inherits from parent text color.
 */

const GLYPH_SVG = (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <defs>
      <marker
        id="gc-logo-arrow"
        markerWidth="5"
        markerHeight="5"
        refX="4"
        refY="2.5"
        orient="auto"
        markerUnits="strokeWidth"
      >
        <path
          d="M0,0 L5,2.5 L0,5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </marker>
    </defs>

    {/* Node A — top-left */}
    <circle cx="6" cy="6" r="2" />

    {/* Node B — bottom-center */}
    <circle cx="11" cy="18" r="2" />

    {/* Node C — right */}
    <circle cx="20" cy="10" r="2" />

    {/* Edge A → C: from (6,6) toward (20,10), stopping before the circle */}
    <line
      x1="7.9"
      y1="6.6"
      x2="17.0"
      y2="9.0"
      markerEnd="url(#gc-logo-arrow)"
    />

    {/* Edge A → B: from (6,6) toward (11,18), stopping before the circle */}
    <line
      x1="6.6"
      y1="8.0"
      x2="10.2"
      y2="15.7"
      markerEnd="url(#gc-logo-arrow)"
    />

    {/* Edge B → C: from (11,18) toward (20,10), stopping before the circle */}
    <line
      x1="12.9"
      y1="16.9"
      x2="18.3"
      y2="11.6"
      markerEnd="url(#gc-logo-arrow)"
    />
  </svg>
);

function resolveColor(theme: "light" | "dark" | "auto"): React.CSSProperties {
  if (theme === "auto") {
    return { color: "var(--color--text--shade-1)" };
  }
  if (theme === "light") {
    return { color: "var(--color--neutral-850)" };
  }
  return { color: "var(--color--neutral-125)" };
}

export function Logo({
  variant = "full",
  size = 24,
  theme = "auto",
  className,
}: LogoProps): React.ReactElement {
  const colorStyle = resolveColor(theme);

  const glyphElement = (
    <span
      data-testid="gc-logo-glyph"
      style={{
        display: "inline-flex",
        flexShrink: 0,
        width: size,
        height: size,
        ...colorStyle,
      }}
    >
      {GLYPH_SVG}
    </span>
  );

  const wordmarkElement = (
    <span
      data-testid="gc-logo-wordmark"
      style={{
        fontFamily: "var(--font-family)",
        fontWeight: "var(--font-weight--bold)" as React.CSSProperties["fontWeight"],
        fontSize: "var(--font-size--lg)",
        lineHeight: 1,
        color: theme === "auto"
          ? "var(--color--text--shade-1)"
          : theme === "light"
            ? "var(--color--neutral-850)"
            : "var(--color--neutral-125)",
        userSelect: "none",
      }}
    >
      GraphCaster
    </span>
  );

  return (
    <div
      className={className}
      data-testid="gc-logo"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: size * 0.375,
      }}
    >
      {variant !== "wordmark" && glyphElement}
      {variant !== "icon" && wordmarkElement}
    </div>
  );
}
