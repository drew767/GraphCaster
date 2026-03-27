// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  buildConsoleLineMeta,
  consoleLineMatchesSearch,
  type ConsoleFilterMode,
  passesConsoleFilter,
} from "../run/consoleLineMeta";
import { runSessionClearConsole, useRunSession } from "../run/runSessionStore";

type Props = {
  heightPx: number;
  onResizeStart: () => void;
  onNavigateToNode?: (nodeId: string) => void;
};

const TAIL_THRESHOLD_PX = 40;

export function ConsolePanel({ heightPx, onResizeStart, onNavigateToNode }: Props) {
  const { t } = useTranslation();
  const { consoleLines, pythonBanner, replaySourceLabel } = useRunSession();
  const bodyRef = useRef<HTMLDivElement>(null);
  const tailStickRef = useRef(true);
  const [filterMode, setFilterMode] = useState<ConsoleFilterMode>("all");
  const [search, setSearch] = useState("");

  const indexedLines = useMemo(
    () => consoleLines.map((line, index) => ({ index, meta: buildConsoleLineMeta(line) })),
    [consoleLines],
  );

  const visibleRows = useMemo(() => {
    return indexedLines.filter(
      (row) => passesConsoleFilter(row.meta, filterMode) && consoleLineMatchesSearch(row.meta, search),
    );
  }, [indexedLines, filterMode, search]);

  const searchTrim = search.trim();
  const isViewFiltered = filterMode !== "all" || searchTrim.length > 0;

  const scrollBodyToBottom = useCallback(() => {
    const el = bodyRef.current;
    if (!el) {
      return;
    }
    tailStickRef.current = true;
    el.scrollTop = el.scrollHeight;
  }, []);

  const onBodyScroll = useCallback(() => {
    const el = bodyRef.current;
    if (!el) {
      return;
    }
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    tailStickRef.current = dist <= TAIL_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !tailStickRef.current) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [consoleLines, filterMode, search]);

  const downloadText = (text: string, fileName: string) => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = fileName;
    a.click();
    requestAnimationFrame(() => {
      URL.revokeObjectURL(url);
    });
  };

  return (
    <>
      <div
        className="gc-splitter"
        role="separator"
        aria-orientation="horizontal"
        onMouseDown={onResizeStart}
      />
      <footer className="gc-console" style={{ height: heightPx }}>
        <div className="gc-console-toolbar">
          <div className="gc-console-toolbar-row">
            <div className="gc-console-header">{t("app.console.heading")}</div>
            <div className="gc-console-actions">
              <button
                type="button"
                className="gc-btn gc-btn-small"
                disabled={consoleLines.length === 0 || visibleRows.length === 0}
                title={t("app.console.exportVisibleHint")}
                onClick={() => {
                  const text = visibleRows.map((r) => r.meta.rawLine).join("\n");
                  downloadText(
                    text,
                    isViewFiltered ? "graph-caster-run-log-filtered.txt" : "graph-caster-run-log.txt",
                  );
                }}
              >
                {t("app.console.export")}
              </button>
              {isViewFiltered && consoleLines.length > 0 ? (
                <button
                  type="button"
                  className="gc-btn gc-btn-small"
                  title={t("app.console.exportFullHint")}
                  onClick={() => {
                    downloadText(consoleLines.join("\n"), "graph-caster-run-log-full.txt");
                  }}
                >
                  {t("app.console.exportFull")}
                </button>
              ) : null}
              <button type="button" className="gc-btn gc-btn-small" onClick={() => runSessionClearConsole()}>
                {t("app.console.clear")}
              </button>
              <button
                type="button"
                className="gc-btn gc-btn-small"
                disabled={consoleLines.length === 0}
                onClick={scrollBodyToBottom}
              >
                {t("app.console.scrollToLatest")}
              </button>
            </div>
          </div>
          <div className="gc-console-toolbar-row gc-console-toolbar-row--secondary">
            <div className="gc-console-filter-group" role="group" aria-label={t("app.console.filterGroupAria")}>
              <button
                type="button"
                className={`gc-btn gc-btn-small${filterMode === "all" ? " gc-btn--selected" : ""}`}
                aria-pressed={filterMode === "all"}
                onClick={() => {
                  setFilterMode("all");
                }}
              >
                {t("app.console.filterAll")}
              </button>
              <button
                type="button"
                className={`gc-btn gc-btn-small${filterMode === "stderr" ? " gc-btn--selected" : ""}`}
                aria-pressed={filterMode === "stderr"}
                onClick={() => {
                  setFilterMode("stderr");
                }}
              >
                {t("app.console.filterStderr")}
              </button>
              <button
                type="button"
                className={`gc-btn gc-btn-small${filterMode === "errors" ? " gc-btn--selected" : ""}`}
                aria-pressed={filterMode === "errors"}
                onClick={() => {
                  setFilterMode("errors");
                }}
              >
                {t("app.console.filterErrors")}
              </button>
            </div>
            <input
              type="search"
              className="gc-console-search"
              placeholder={t("app.console.searchPlaceholder")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
              }}
              aria-label={t("app.console.searchAria")}
            />
          </div>
        </div>
        {pythonBanner != null && pythonBanner !== "" ? (
          <div className="gc-run-banner" role="status">
            {pythonBanner}
          </div>
        ) : null}
        {replaySourceLabel != null && replaySourceLabel !== "" ? (
          <div className="gc-run-banner gc-run-banner--replay" role="status">
            {t("app.console.replayBanner", { label: replaySourceLabel })}
          </div>
        ) : null}
        <div ref={bodyRef} className="gc-console-body" onScroll={onBodyScroll}>
          {consoleLines.length === 0 ? (
            <div className="gc-console-line gc-console-line--muted">{t("app.console.empty")}</div>
          ) : visibleRows.length === 0 ? (
            <div className="gc-console-line gc-console-line--muted">{t("app.console.noMatchingLines")}</div>
          ) : (
            visibleRows.map((row) => {
              const m = row.meta;
              const navigable = m.nodeId != null && onNavigateToNode != null;
              const lineClass = [
                "gc-console-line",
                m.isErrorLike ? "gc-console-line--error" : m.isStderr ? "gc-console-line--stderr" : "",
                navigable ? "gc-console-line--nav" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <pre
                  key={row.index}
                  className={lineClass}
                  role={navigable ? "button" : undefined}
                  tabIndex={navigable ? 0 : undefined}
                  aria-label={navigable && m.nodeId != null ? t("app.console.navigateToNode", { nodeId: m.nodeId }) : undefined}
                  onClick={() => {
                    if (m.nodeId != null && onNavigateToNode != null) {
                      onNavigateToNode(m.nodeId);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (!navigable) {
                      return;
                    }
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      if (m.nodeId != null && onNavigateToNode != null) {
                        onNavigateToNode(m.nodeId);
                      }
                    }
                  }}
                >
                  {m.displayLine}
                </pre>
              );
            })
          )}
        </div>
      </footer>
    </>
  );
}
