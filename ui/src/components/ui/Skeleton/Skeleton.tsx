// Copyright GraphCaster. All Rights Reserved.

import React from "react";
import "./Skeleton.css";

export interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  variant?: "text" | "circle" | "rect" | "rounded";
  count?: number;
  className?: string;
}

export function Skeleton({
  width,
  height,
  variant = "rect",
  count = 1,
  className,
}: SkeletonProps) {
  const rootClass = [
    "gc-skeleton",
    `gc-skeleton--${variant}`,
    "gc-skeleton--shimmer",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const style: React.CSSProperties = {};
  if (width != null) {
    style.width = typeof width === "number" ? `${width}px` : width;
  }
  if (height != null) {
    style.height = typeof height === "number" ? `${height}px` : height;
  }

  if (count > 1) {
    return (
      <div className="gc-skeleton-group" aria-busy="true" aria-label="Loading">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className={rootClass} style={style} aria-hidden="true" />
        ))}
      </div>
    );
  }

  return (
    <div
      className={rootClass}
      style={style}
      aria-busy="true"
      aria-label="Loading"
    />
  );
}

// ---------------------------------------------------------------------------
// Pre-built compositions
// ---------------------------------------------------------------------------

export interface SkeletonCardProps {
  className?: string;
}

export function SkeletonCard({ className }: SkeletonCardProps) {
  return (
    <div
      className={["gc-skeleton-card", className].filter(Boolean).join(" ")}
      aria-busy="true"
      aria-label="Loading card"
    >
      <div className="gc-skeleton-card__header">
        <Skeleton variant="circle" width={40} height={40} />
        <div className="gc-skeleton-card__titles">
          <Skeleton variant="text" width="60%" height={14} />
          <Skeleton variant="text" width="40%" height={12} />
        </div>
      </div>
      <Skeleton variant="rounded" height={80} />
      <div className="gc-skeleton-card__footer">
        <Skeleton variant="text" width="30%" height={12} />
        <Skeleton variant="text" width="20%" height={12} />
      </div>
    </div>
  );
}

export interface SkeletonRowProps {
  columns?: number;
  className?: string;
}

export function SkeletonRow({ columns = 4, className }: SkeletonRowProps) {
  return (
    <div
      className={["gc-skeleton-row", className].filter(Boolean).join(" ")}
      aria-busy="true"
      aria-label="Loading row"
    >
      {Array.from({ length: columns }, (_, i) => (
        <Skeleton key={i} variant="text" height={14} />
      ))}
    </div>
  );
}

export interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
}: SkeletonTableProps) {
  return (
    <div
      className={["gc-skeleton-table", className].filter(Boolean).join(" ")}
      aria-busy="true"
      aria-label="Loading table"
    >
      <div className="gc-skeleton-table__header">
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={i} variant="text" height={12} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonRow key={i} columns={columns} />
      ))}
    </div>
  );
}
