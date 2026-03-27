// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CanvasNodeSearchRow } from "../graph/canvasNodeSearch";
import { filterCanvasNodeSearchRows } from "../graph/canvasNodeSearch";

const MAX_LIST = 200;

type Props = {
  open: boolean;
  allRows: readonly CanvasNodeSearchRow[];
  onClose: () => void;
  onPick: (nodeId: string) => void;
};

export function NodeSearchPalette({ open, allRows, onClose, onPick }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState("");
  const [highlight, setHighlight] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => filterCanvasNodeSearchRows(allRows, filter), [allRows, filter]);

  const displayRows = useMemo(() => filtered.slice(0, MAX_LIST), [filtered]);

  const truncated = filtered.length > MAX_LIST;

  useEffect(() => {
    if (!open) {
      setFilter("");
      setHighlight(0);
      return;
    }
    setHighlight(0);
    const rafId = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [open]);

  useEffect(() => {
    setHighlight((h) => {
      if (displayRows.length === 0) {
        return 0;
      }
      return Math.min(h, displayRows.length - 1);
    });
  }, [displayRows.length, filter]);

  const optionDomId = (index: number) => `gc-node-search-row-${index}`;
  const activeOptionId =
    displayRows.length > 0 && highlight >= 0 && highlight < displayRows.length
      ? optionDomId(highlight)
      : undefined;

  useLayoutEffect(() => {
    if (!open || activeOptionId === undefined) {
      return;
    }
    document.getElementById(activeOptionId)?.scrollIntoView({ block: "nearest" });
  }, [open, activeOptionId]);

  const pickAt = useCallback(
    (index: number) => {
      const row = displayRows[index];
      if (!row) {
        return;
      }
      onPick(row.id);
    },
    [displayRows, onPick],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        ev.preventDefault();
        onClose();
        return;
      }
      if (ev.key === "ArrowDown") {
        ev.preventDefault();
        if (displayRows.length === 0) {
          return;
        }
        setHighlight((h) => Math.min(h + 1, displayRows.length - 1));
        return;
      }
      if (ev.key === "ArrowUp") {
        ev.preventDefault();
        if (displayRows.length === 0) {
          return;
        }
        setHighlight((h) => Math.max(h - 1, 0));
        return;
      }
      if (ev.key === "Enter") {
        ev.preventDefault();
        pickAt(highlight);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, displayRows.length, highlight, onClose, pickAt]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const root = dialogRef.current;
    if (!root) {
      return;
    }
    const onFocusIn = (ev: FocusEvent) => {
      const target = ev.target;
      if (target instanceof Node && !root.contains(target)) {
        inputRef.current?.focus();
      }
    };
    document.addEventListener("focusin", onFocusIn, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      ref={dialogRef}
      className="gc-node-search"
      role="dialog"
      aria-modal="true"
      aria-label={t("app.canvas.findNodeTitle")}
    >
      <button
        type="button"
        className="gc-node-search__backdrop"
        aria-label={t("app.canvas.findNodeClose")}
        tabIndex={-1}
        onClick={onClose}
      />
      <div className="gc-node-search__panel gc-node-search-panel">
        <div className="gc-node-search-panel__title">{t("app.canvas.findNodeTitle")}</div>
        <div className="gc-node-search-panel__hint">{t("app.canvas.findNodeShortcut")}</div>
        <input
          ref={inputRef}
          type="search"
          className="gc-node-search-panel__filter"
          value={filter}
          placeholder={t("app.canvas.findNodeFilterPh")}
          aria-label={t("app.canvas.findNodeFilterPh")}
          onChange={(e) => {
            setFilter(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F" || e.key === "k" || e.key === "K")) {
              e.preventDefault();
            }
          }}
        />
        {truncated ? (
          <div className="gc-node-search-panel__trunc">{t("app.canvas.findNodeTruncated", { count: MAX_LIST })}</div>
        ) : null}
        <ul
          className="gc-node-search-panel__list"
          role="listbox"
          aria-activedescendant={activeOptionId}
        >
          {displayRows.length === 0 ? (
            <li className="gc-node-search-panel__empty">{t("app.canvas.findNodeEmpty")}</li>
          ) : (
            displayRows.map((row, i) => (
              <li key={optionDomId(i)} id={optionDomId(i)} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  className={`gc-node-search-panel__row${i === highlight ? " is-active" : ""}`}
                  onMouseEnter={() => {
                    setHighlight(i);
                  }}
                  onClick={() => {
                    pickAt(i);
                  }}
                >
                  <span className="gc-node-search-panel__row-id">{row.id}</span>
                  <span className="gc-node-search-panel__row-type">{row.graphNodeType}</span>
                  <span className="gc-node-search-panel__row-label">{row.displayLabel}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
