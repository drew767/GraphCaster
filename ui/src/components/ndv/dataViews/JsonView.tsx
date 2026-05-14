// Copyright GraphCaster. All Rights Reserved.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface JsonViewProps {
  data: unknown;
  emptyLabel?: string;
}

function stringify(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

/* Walk JSON, returning a filtered tree of nodes whose key or stringified value matches `query`.
 * If `filterMode` is true and there are no matches, returns undefined.
 */
function filterTree(data: unknown, query: string): unknown {
  const q = query.toLowerCase();
  function visit(node: unknown, keyPath: string | null): unknown {
    if (node === null || typeof node !== "object") {
      const asString = String(node);
      if (
        (keyPath !== null && keyPath.toLowerCase().includes(q)) ||
        asString.toLowerCase().includes(q)
      ) {
        return node;
      }
      return undefined;
    }
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      let any = false;
      for (const item of node) {
        const v = visit(item, keyPath);
        if (v !== undefined) {
          out.push(v);
          any = true;
        }
      }
      return any ? out : undefined;
    }
    const obj = node as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    let any = false;
    for (const [k, v] of Object.entries(obj)) {
      const keyMatch = k.toLowerCase().includes(q);
      const filtered = visit(v, k);
      if (keyMatch) {
        result[k] = v;
        any = true;
      } else if (filtered !== undefined) {
        result[k] = filtered;
        any = true;
      }
    }
    return any ? result : undefined;
  }
  return visit(data, null);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text: string, query: string): React.ReactNode {
  if (!query) return text;
  const re = new RegExp(`(${escapeRegExp(query)})`, "gi");
  const parts = text.split(re);
  return parts.map((part, idx) =>
    re.test(part) ? (
      <mark key={idx} className="gc-json-view__mark">
        {part}
      </mark>
    ) : (
      <React.Fragment key={idx}>{part}</React.Fragment>
    ),
  );
}

export function JsonView({ data, emptyLabel }: JsonViewProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filterMode, setFilterMode] = useState(false);

  // Ctrl+F handler scoped to this view when it has focus-within
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== "f" && e.key !== "F") return;
      const target = e.target as Node | null;
      if (target && el.contains(target)) {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => inputRef.current?.focus(), 0);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setFilterMode(false);
  }, []);

  const displayedData = useMemo(() => {
    if (!searchOpen || !query || !filterMode) return data;
    const filtered = filterTree(data, query);
    return filtered === undefined ? null : filtered;
  }, [data, query, filterMode, searchOpen]);

  if (data === undefined) {
    return <div className="gc-json-view__empty">{emptyLabel ?? "—"}</div>;
  }

  const text = stringify(displayedData);
  const hasMatches = !query || text.toLowerCase().includes(query.toLowerCase());

  return (
    <div
      ref={containerRef}
      className="gc-json-view__container"
      tabIndex={0}
      data-testid="json-view-container"
    >
      {searchOpen && (
        <div className="gc-json-view__search" data-testid="json-view-search">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("app.ndv.jsonView.searchPlaceholder")}
            aria-label={t("app.ndv.jsonView.searchAriaLabel")}
            className="gc-json-view__search-input"
            data-testid="json-view-search-input"
            onKeyDown={(e) => {
              if (e.key === "Escape") closeSearch();
            }}
          />
          <label className="gc-json-view__search-filter">
            <input
              type="checkbox"
              checked={filterMode}
              onChange={(e) => setFilterMode(e.target.checked)}
              data-testid="json-view-search-filter"
            />
            <span>{t("app.ndv.jsonView.filterMatches")}</span>
          </label>
          <button
            type="button"
            className="gc-json-view__search-close"
            onClick={closeSearch}
            aria-label={t("app.ndv.jsonView.closeSearch")}
            data-testid="json-view-search-close"
          >
            ×
          </button>
        </div>
      )}
      {searchOpen && query && !hasMatches && (
        <div
          className="gc-json-view__no-matches"
          data-testid="json-view-no-matches"
        >
          {t("app.ndv.jsonView.noMatches")}
        </div>
      )}
      <pre className="gc-json-view" data-testid="json-view">
        {query ? highlight(text, query) : text}
      </pre>
    </div>
  );
}
