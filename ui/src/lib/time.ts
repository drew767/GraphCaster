// Copyright GraphCaster. All Rights Reserved.

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export interface FormatRelativeOptions {
  /** Localised "just now" string (default: "just now"). */
  justNow?: string;
  /** Reference clock (default: Date.now()). */
  now?: number;
}

/**
 * Returns a compact relative time string for a millisecond timestamp.
 * Used by the notifications popover and similar feed-style UIs.
 *
 * Examples: "just now", "5m ago", "3h ago", "2d ago", "4w ago".
 */
export function formatRelative(ms: number, options: FormatRelativeOptions = {}): string {
  const now = options.now ?? Date.now();
  const justNow = options.justNow ?? "just now";
  const diff = Math.max(0, now - ms);

  if (diff < MINUTE) return justNow;
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)}d ago`;
  return `${Math.floor(diff / WEEK)}w ago`;
}
