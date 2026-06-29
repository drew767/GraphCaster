// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  buildConsoleLineMeta,
  consoleLineMatchesSearch,
  type ConsoleFilterMode,
  passesConsoleFilter,
} from "../run/consoleLineMeta";
import { reduceConsoleLinesToRunTimeline } from "../run/buildRunTimeline";
import { ExecutionTimeline } from "./ExecutionTimeline";
import { useVirtualList } from "../hooks/useVirtualList";
import { gcErrorTranslationKey } from "../lib/errorMessages";
import { jsonHighlightedConsoleLine } from "../lib/jsonConsoleHighlight";
import { runSessionClearConsole, useRunSessionConsole } from "../run/runSessionStore";

type Props = {
  heightPx: number;
  onResizeStart: () => void;
  onNavigateToNode?: (nodeId: string) => void;
};

const TAIL_THRESHOLD_PX = 40;
const CONSOLE_ROW_HEIGHT_PX = 18;
const RENDER_WINDOW_OVERSCAN = 10;
const VIRTUALIZE_THRESHOLD = 100;

type PanelTab = "log" | "steps";

type IndexedConsoleRow = {
  index: number;
  meta: ReturnType<typeof buildConsoleLineMeta>;
};

export function ConsolePanel({ heightPx, onResizeStart, onNavigateToNode }: Props) {
  const { t } = useTranslation();
  const { consoleLines, pythonBanner, replaySourceLabel } = useRunSessionConsole();
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const tailStickRef = useRef(true);
  const [filterMode, setFilterMode] = useState<ConsoleFilterMode>("all");
  const [search, setSearch] = useState("");
  const [panelTab, setPanelTab] = useState<PanelTab>("log");

  const timeline = useMemo(() => reduceConsoleLinesToRunTimeline(consoleLines), [consoleLines]);

  const indexedLines = useMemo<IndexedConsoleRow[]>(
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

  const shouldVirtualizeLog =
    panelTab === "log" && visibleRows.length >= VIRTUALIZE_THRESHOLD;

  const v = useVirtualList({
    itemCount: shouldVirtualizeLog ? visibleRows.length : 0,
    itemHeight: CONSOLE_ROW_HEIGHT_PX,
    overscan: RENDER_WINDOW_OVERSCAN,
    estimatedViewportHeight: Math.max(120, heightPx - 96),
  });

  const setBodyRef = useCallback(
    (node: HTMLDivElement | null) => {
      bodyRef.current = node;
      v.containerRef(node);
    },
    [v],
  );

  const scrollBodyToBottom = useCallback(() => {
    const el = bodyRef.current;
    if (!el) {
      return;
    }
    tailStickRef.current = true;
    el.scrollTop = el.scrollHeight;
  }, []);

  const onBodyScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      const el = bodyRef.current;
      if (el != null) {
        const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
        tailStickRef.current = dist <= TAIL_THRESHOLD_PX;
      }
      v.onScroll(event);
    },
    [v],
  );

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !tailStickRef.current) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [consoleLines, filterMode, search, panelTab]);

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

  const renderLogRow = useCallback(
    (row: IndexedConsoleRow, fixedHeight?: number) => {
      const m = row.meta;
      const navigable = m.nodeId != null && onNavigateToNode != null;
      const lineClass = [
        "gc-console-line",
        m.isErrorLike
          ? "gc-console-line--error"
          : m.streamBackpressureDropped != null
            ? "gc-console-line--warn"
            : m.isStderr
              ? "gc-console-line--stderr"
              : "",
        navigable ? "gc-console-line--nav" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const gcHint =
        m.gcCode != null && m.gcCode !== ""
          ? t(gcErrorTranslationKey(m.gcCode), { defaultValue: m.gcCode })
          : "";
      const style =
        fixedHeight != null
          ? { height: fixedHeight, overflow: "hidden" as const, boxSizing: "border-box" as const }
          : undefined;
      return (
        <pre
          key={row.index}
          className={lineClass}
          data-testid="gc-console-line"
          style={style}
          role={navigable ? "button" : undefined}
          tabIndex={navigable ? 0 : undefined}
          aria-label={
            navigable && m.nodeId != null ? t("app.console.navigateToNode", { nodeId: m.nodeId }) : undefined
          }
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
          {m.streamBackpressureDropped != null
            ? t("app.run.console.outputTruncated", { count: m.streamBackpressureDropped })
            : gcHint !== "" ? (
                <>
                  {jsonHighlightedConsoleLine(m.displayLine)}
                  <span className="gc-console-gc-hint"> — {gcHint}</span>
                </>
              ) : (
                jsonHighlightedConsoleLine(m.displayLine)
              )}
        </pre>
      );
    },
    [onNavigateToNode, t],
  );

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
            <div className="gc-console-toolbar-lead">
              <div className="gc-console-header">{t("app.console.heading")}</div>
              <div
                className="gc-console-tabs"
                role="tablist"
                aria-label={t("app.console.tabsAria")}
                onKeyDown={(e) => {
                  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") {
                    return;
                  }
                  const tEl = e.target as HTMLElement | null;
                  if (tEl?.getAttribute("role") !== "tab") {
                    return;
                  }
                  e.preventDefault();
                  if (e.key === "ArrowRight" && panelTab === "log") {
                    setPanelTab("steps");
                    queueMicrotask(() => document.getElementById("gc-console-tab-steps")?.focus());
                  } else if (e.key === "ArrowLeft" && panelTab === "steps") {
                    setPanelTab("log");
                    queueMicrotask(() => document.getElementById("gc-console-tab-log")?.focus());
                  }
                }}
              >
                <button
                  type="button"
                  role="tab"
                  id="gc-console-tab-log"
                  tabIndex={panelTab === "log" ? 0 : -1}
                  aria-selected={panelTab === "log"}
                  aria-controls="gc-console-tabpanel-log"
                  className={`gc-btn gc-btn-small${panelTab === "log" ? " gc-btn--selected" : ""}`}
                  onClick={() => {
                    setPanelTab("log");
                  }}
                >
                  {t("app.console.tabLog")}
                </button>
                <button
                  type="button"
                  role="tab"
                  id="gc-console-tab-steps"
                  tabIndex={panelTab === "steps" ? 0 : -1}
                  aria-selected={panelTab === "steps"}
                  aria-controls="gc-console-tabpanel-steps"
                  className={`gc-btn gc-btn-small${panelTab === "steps" ? " gc-btn--selected" : ""}`}
                  onClick={() => {
                    setPanelTab("steps");
                  }}
                >
                  {t("app.console.tabSteps")}
                </button>
              </div>
            </div>
            <div className="gc-console-actions">
              <button
                type="button"
                className="gc-btn gc-btn-small"
                disabled={
                  consoleLines.length === 0 ||
                  visibleRows.length === 0 ||
                  panelTab !== "log"
                }
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
              {consoleLines.length > 0 &&
              (panelTab === "steps" || (panelTab === "log" && isViewFiltered)) ? (
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
                disabled={consoleLines.length === 0 && timeline.length === 0}
                onClick={scrollBodyToBottom}
              >
                {t("app.console.scrollToLatest")}
              </button>
            </div>
          </div>
          {panelTab === "log" ? (
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
          ) : null}
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
        <div
          ref={setBodyRef}
          className="gc-console-body"
          onScroll={onBodyScroll}
          role="tabpanel"
          id={panelTab === "log" ? "gc-console-tabpanel-log" : "gc-console-tabpanel-steps"}
          aria-labelledby={panelTab === "log" ? "gc-console-tab-log" : "gc-console-tab-steps"}
        >
          {panelTab === "log" ? (
            consoleLines.length === 0 ? (
              <div className="gc-console-line gc-console-line--muted">{t("app.console.empty")}</div>
            ) : visibleRows.length === 0 ? (
              <div className="gc-console-line gc-console-line--muted">{t("app.console.noMatchingLines")}</div>
            ) : shouldVirtualizeLog ? (
              <div
                data-testid="gc-console-virtual-spacer"
                style={{ position: "relative", height: v.totalHeight }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    transform: `translateY(${v.offsetTop}px)`,
                  }}
                >
                  {visibleRows.slice(v.startIndex, v.endIndex).map((row) =>
                    renderLogRow(row, CONSOLE_ROW_HEIGHT_PX),
                  )}
                </div>
              </div>
            ) : (
              visibleRows.map((row) => renderLogRow(row))
            )
          ) : consoleLines.length === 0 ? (
            <div className="gc-console-line gc-console-line--muted">{t("app.console.empty")}</div>
          ) : timeline.length === 0 ? (
            <div className="gc-console-line gc-console-line--muted">{t("app.console.timelineEmpty")}</div>
          ) : (
            <ExecutionTimeline rows={timeline} onNavigateToNode={onNavigateToNode} />
          )}
        </div>
      </footer>
    </>
  );
}
