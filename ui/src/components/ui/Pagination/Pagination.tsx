// Copyright GraphCaster. All Rights Reserved.

import React, { useMemo } from "react";

import { Button } from "../Button/Button";
import "./Pagination.css";

export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  showFirstLast?: boolean;
  siblingCount?: number;
  size?: "small" | "medium";
  disabled?: boolean;
  className?: string;
}

const ELLIPSIS = "ellipsis";

function buildPageRange(
  current: number,
  total: number,
  siblingCount: number,
): (number | typeof ELLIPSIS)[] {
  const delta = siblingCount;
  const range: number[] = [];

  const left = Math.max(2, current - delta);
  const right = Math.min(total - 1, current + delta);

  for (let i = left; i <= right; i++) {
    range.push(i);
  }

  const pages: (number | typeof ELLIPSIS)[] = [];

  pages.push(1);

  if (left > 2) {
    pages.push(ELLIPSIS);
  }

  for (const p of range) {
    pages.push(p);
  }

  if (right < total - 1) {
    pages.push(ELLIPSIS);
  }

  if (total > 1) {
    pages.push(total);
  }

  return pages;
}

export function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  showFirstLast = true,
  siblingCount = 1,
  size = "medium",
  disabled = false,
  className,
}: PaginationProps) {
  const btnSize = size === "small" ? "xsmall" : "xsmall";

  const pages = useMemo(
    () =>
      totalPages <= 1 ? [1] : buildPageRange(currentPage, totalPages, siblingCount),
    [currentPage, totalPages, siblingCount],
  );

  const isFirst = currentPage <= 1;
  const isLast = currentPage >= totalPages;

  const rootClasses = [
    "gc-pagination",
    `gc-pagination--${size}`,
    disabled ? "gc-pagination--disabled" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <nav className={rootClasses} aria-label="Pagination">
      {showFirstLast && (
        <Button
          variant="ghost"
          size={btnSize}
          disabled={disabled || isFirst}
          onClick={() => onPageChange(1)}
          aria-label="First page"
          className="gc-pagination__btn"
        >
          «
        </Button>
      )}

      <Button
        variant="ghost"
        size={btnSize}
        disabled={disabled || isFirst}
        onClick={() => onPageChange(currentPage - 1)}
        aria-label="Previous page"
        className="gc-pagination__btn"
      >
        ‹
      </Button>

      {pages.map((page, idx) => {
        if (page === ELLIPSIS) {
          return (
            <span key={`ellipsis-${idx}`} className="gc-pagination__ellipsis">
              …
            </span>
          );
        }
        const isActive = page === currentPage;
        return (
          <Button
            key={page}
            variant="ghost"
            size={btnSize}
            disabled={disabled}
            onClick={() => onPageChange(page)}
            aria-label={`Page ${page}`}
            aria-current={isActive ? "page" : undefined}
            className={[
              "gc-pagination__btn",
              isActive ? "gc-pagination__btn--active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {page}
          </Button>
        );
      })}

      <Button
        variant="ghost"
        size={btnSize}
        disabled={disabled || isLast}
        onClick={() => onPageChange(currentPage + 1)}
        aria-label="Next page"
        className="gc-pagination__btn"
      >
        ›
      </Button>

      {showFirstLast && (
        <Button
          variant="ghost"
          size={btnSize}
          disabled={disabled || isLast}
          onClick={() => onPageChange(totalPages)}
          aria-label="Last page"
          className="gc-pagination__btn"
        >
          »
        </Button>
      )}
    </nav>
  );
}
