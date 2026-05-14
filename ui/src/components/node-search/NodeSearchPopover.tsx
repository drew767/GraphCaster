// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  filterNodeTypesByPreset,
  getAllNodeTypes,
  NODE_CATALOG_CATEGORY_ORDER,
  scoreNodeMatch,
  type NodeCatalogCategory,
  type NodeCatalogFilter,
  type NodeTypeMeta,
} from "../../graph/nodeCatalog";

import "./NodeSearchPopover.css";

const POPOVER_WIDTH = 360;
const POPOVER_MAX_HEIGHT = 480;
const VIEWPORT_MARGIN = 8;

export interface NodeSearchPopoverProps {
  open: boolean;
  anchorPosition: { x: number; y: number };
  onClose: () => void;
  onSelect: (nodeType: string) => void;
  filter?: NodeCatalogFilter;
  /** Optional override; defaults to `getAllNodeTypes()`. Used in tests. */
  catalog?: readonly NodeTypeMeta[];
}

interface RankedRow {
  readonly meta: NodeTypeMeta;
  readonly score: number;
  readonly displayName: string;
}

interface RenderedItem {
  readonly kind: "heading";
  readonly category: NodeCatalogCategory;
}

interface RenderedNode {
  readonly kind: "node";
  readonly meta: NodeTypeMeta;
  readonly displayName: string;
  readonly category: NodeCatalogCategory;
  readonly selectableIndex: number;
}

type RenderedRow = RenderedItem | RenderedNode;

function clampToViewport(
  pos: { x: number; y: number },
  viewport: { w: number; h: number },
): { left: number; top: number } {
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewport.w - POPOVER_WIDTH - VIEWPORT_MARGIN);
  const maxTop = Math.max(VIEWPORT_MARGIN, viewport.h - POPOVER_MAX_HEIGHT - VIEWPORT_MARGIN);
  return {
    left: Math.min(Math.max(pos.x, VIEWPORT_MARGIN), maxLeft),
    top: Math.min(Math.max(pos.y, VIEWPORT_MARGIN), maxTop),
  };
}

function FallbackIcon(): JSX.Element {
  // Inline "box" glyph fallback to avoid pulling a new dependency.
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    </svg>
  );
}

export function NodeSearchPopover(props: NodeSearchPopoverProps): JSX.Element | null {
  const { open, anchorPosition, onClose, onSelect, filter = "all", catalog } = props;
  const { t } = useTranslation();

  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 1024,
    h: typeof window !== "undefined" ? window.innerHeight : 768,
  }));

  const sourceCatalog = useMemo(() => catalog ?? getAllNodeTypes(), [catalog]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(0);
      return;
    }
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => {
      cancelAnimationFrame(id);
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return;
    }
    const onResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const grouped = useMemo(() => {
    const preset = filterNodeTypesByPreset(sourceCatalog, filter);
    const q = query.trim();
    const buckets = new Map<NodeCatalogCategory, RankedRow[]>();
    for (const meta of preset) {
      const displayName = t(meta.displayNameKey, { defaultValue: meta.type });
      const description = t(meta.descriptionKey, { defaultValue: "" });
      const haystack = `${displayName} ${meta.type} ${description}`;
      const score = scoreNodeMatch(haystack, q);
      if (score === null) {
        continue;
      }
      const arr = buckets.get(meta.category) ?? [];
      arr.push({ meta, score, displayName });
      buckets.set(meta.category, arr);
    }
    const out: { category: NodeCatalogCategory; rows: RankedRow[] }[] = [];
    for (const cat of NODE_CATALOG_CATEGORY_ORDER) {
      const arr = buckets.get(cat);
      if (!arr || arr.length === 0) {
        continue;
      }
      arr.sort((a, b) => {
        if (a.score !== b.score) {
          return a.score - b.score;
        }
        return a.displayName.localeCompare(b.displayName);
      });
      out.push({ category: cat, rows: arr });
    }
    return out;
  }, [filter, query, sourceCatalog, t]);

  const rendered = useMemo<RenderedRow[]>(() => {
    const list: RenderedRow[] = [];
    let selectable = 0;
    for (const group of grouped) {
      list.push({ kind: "heading", category: group.category });
      for (const r of group.rows) {
        list.push({
          kind: "node",
          meta: r.meta,
          displayName: r.displayName,
          category: group.category,
          selectableIndex: selectable,
        });
        selectable += 1;
      }
    }
    return list;
  }, [grouped]);

  const selectableCount = useMemo(() => {
    return rendered.reduce((acc, row) => (row.kind === "node" ? acc + 1 : acc), 0);
  }, [rendered]);

  useEffect(() => {
    setActiveIndex((idx) => {
      if (selectableCount === 0) {
        return 0;
      }
      return Math.min(idx, selectableCount - 1);
    });
  }, [selectableCount, query, filter]);

  const handleSelectAt = useCallback(
    (idx: number) => {
      const target = rendered.find((row) => row.kind === "node" && row.selectableIndex === idx);
      if (target && target.kind === "node") {
        onSelect(target.meta.type);
      }
    },
    [onSelect, rendered],
  );

  const onKeyDown = useCallback(
    (ev: React.KeyboardEvent<HTMLDivElement>) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        onClose();
        return;
      }
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (selectableCount === 0) return;
        setActiveIndex((i) => (i + 1) % selectableCount);
        return;
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (selectableCount === 0) return;
        setActiveIndex((i) => (i - 1 + selectableCount) % selectableCount);
        return;
      }
      if (ev.key === "Home") {
        ev.preventDefault();
        setActiveIndex(0);
        return;
      }
      if (ev.key === "End") {
        ev.preventDefault();
        if (selectableCount === 0) return;
        setActiveIndex(selectableCount - 1);
        return;
      }
      if (ev.key === "Enter") {
        ev.preventDefault();
        handleSelectAt(activeIndex);
      }
    },
    [activeIndex, handleSelectAt, onClose, selectableCount],
  );

  const activeRowId = `gc-node-search-row-${activeIndex}`;

  useLayoutEffect(() => {
    if (!open) return;
    const el = document.getElementById(activeRowId);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeRowId, open]);

  const { left, top } = useMemo(
    () => clampToViewport(anchorPosition, viewport),
    [anchorPosition, viewport],
  );

  if (!open) {
    return null;
  }

  return (
    <div
      ref={rootRef}
      className="gc-node-search-popover"
      role="dialog"
      aria-label={t("nodeSearch.dialogLabel")}
      style={{ left, top }}
      onKeyDown={onKeyDown}
      onMouseDown={(ev) => {
        ev.stopPropagation();
      }}
    >
      <input
        ref={inputRef}
        type="search"
        className="gc-node-search-popover__input"
        value={query}
        placeholder={t("nodeSearch.placeholder")}
        aria-label={t("nodeSearch.placeholder")}
        aria-controls="gc-node-search-listbox"
        aria-activedescendant={selectableCount > 0 ? activeRowId : undefined}
        onChange={(ev) => {
          setQuery(ev.target.value);
          setActiveIndex(0);
        }}
      />
      <ul
        id="gc-node-search-listbox"
        className="gc-node-search-popover__list"
        role="listbox"
      >
        {selectableCount === 0 ? (
          <li className="gc-node-search-popover__empty">{t("nodeSearch.empty")}</li>
        ) : (
          rendered.map((row, i) => {
            if (row.kind === "heading") {
              return (
                <li
                  key={`heading-${row.category}-${i}`}
                  className="gc-node-search-popover__group-heading"
                  role="presentation"
                >
                  {t(`nodeSearch.category.${row.category}`)}
                </li>
              );
            }
            const isActive = row.selectableIndex === activeIndex;
            return (
              <li
                key={`node-${row.meta.type}`}
                id={`gc-node-search-row-${row.selectableIndex}`}
                role="option"
                aria-selected={isActive}
              >
                <button
                  type="button"
                  className={
                    "gc-node-search-popover__item" +
                    (isActive ? " gc-node-search-popover__item--active" : "")
                  }
                  onMouseEnter={() => {
                    setActiveIndex(row.selectableIndex);
                  }}
                  onClick={() => {
                    onSelect(row.meta.type);
                  }}
                >
                  <span className="gc-node-search-popover__icon">
                    <FallbackIcon />
                  </span>
                  <span className="gc-node-search-popover__label">{row.displayName}</span>
                  <span className="gc-node-search-popover__badge">
                    {t(`nodeSearch.category.${row.category}`)}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
