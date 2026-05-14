// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import * as RadixAvatar from "@radix-ui/react-avatar";

import "./Avatar.css";

export interface AvatarProps {
  src?: string;
  alt?: string;
  fallback?: string;
  size?: "xsmall" | "small" | "medium" | "large" | "xlarge";
  shape?: "circle" | "square";
  color?: string;
  className?: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].charAt(0).toUpperCase();
  }
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

const FALLBACK_HUES = [
  200, 220, 240, 260, 280, 300, 160, 180, 30, 50, 10, 340,
];

function getFallbackColor(name: string): string {
  const hue = FALLBACK_HUES[hashString(name) % FALLBACK_HUES.length];
  return `hsl(${hue}, 60%, 45%)`;
}

export function Avatar({
  src,
  alt,
  fallback,
  size = "medium",
  shape = "circle",
  color,
  className,
}: AvatarProps) {
  const initials = fallback ? getInitials(fallback) : "";
  const bg = color ?? (fallback ? getFallbackColor(fallback) : "#888");

  const classes = [
    "gc-avatar",
    `gc-avatar--${size}`,
    `gc-avatar--${shape}`,
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <RadixAvatar.Root className={classes}>
      {src && (
        <RadixAvatar.Image className="gc-avatar__image" src={src} alt={alt ?? fallback ?? ""} />
      )}
      <RadixAvatar.Fallback
        className="gc-avatar__fallback"
        style={{ background: bg }}
        delayMs={0}
      >
        {initials}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  );
}

export interface AvatarStackProps {
  avatars: Array<Omit<AvatarProps, "size">>;
  max?: number;
  size?: AvatarProps["size"];
  overlap?: number;
}

const SIZE_PX: Record<NonNullable<AvatarProps["size"]>, number> = {
  xsmall: 20,
  small: 28,
  medium: 36,
  large: 48,
  xlarge: 64,
};

export function AvatarStack({
  avatars,
  max = 4,
  size = "medium",
  overlap = 8,
}: AvatarStackProps) {
  const visible = avatars.slice(0, max);
  const overflow = avatars.length - visible.length;
  const px = SIZE_PX[size];
  const marginRight = -(overlap);

  return (
    <span className="gc-avatar-stack" role="group" aria-label="Avatars">
      {overflow > 0 && (
        <span
          className="gc-avatar-stack__overflow"
          style={{ width: px, height: px, marginRight }}
          aria-label={`+${overflow} more`}
        >
          +{overflow}
        </span>
      )}
      {[...visible].reverse().map((av, i) => (
        <span
          key={i}
          className="gc-avatar-stack__item"
          style={{ marginRight: i < visible.length - 1 ? marginRight : 0 }}
        >
          <Avatar {...av} size={size} />
        </span>
      ))}
    </span>
  );
}
