// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  buildConsoleLineMeta,
  consoleLineMatchesSearch,
  type ConsoleFilterMode,
  passesConsoleFilter,
} from "../run/consoleLineMeta";
import { reduceConsoleLinesToRunTimeline, type RunTimelineStatus } from "../run/buildRunTimeline";
import { gcErrorTranslationKey } from "../lib/errorMessages";
import { jsonHighlightedConsoleLine } from "../lib/jsonConsoleHighlight";
import { runSessionClearConsole, useRunSession } from "../run/runSessionStore";

type Props = {
  heightPx: number;
  onResizeStart: () => void;
  onNavigateToNode?: (nodeId: string) => void;
};

const TAIL_THRESHOLD_PX = 40;

type PanelTab = "log" | "steps";

function formatStepDuration(ms: number): string {
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  if (ms < 60_000) {
    return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  }
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function truncateNodeLabel(id: string, max: number): string {
  if (id.length <= max) {
    return id;
  }
  return `${id.slice(0, max - 1)}…`;
}

function runTimelineStatusRowClass(status: RunTimelineStatus): string {
  switch (status) {
    case "running":
      return "gc-run-timeline-row--running";
    case "success":
      return "gc-run-timeline-row--success";
    case "failed":
      return "gc-run-timeline-row--failed";
    case "skipped":
      return "gc-run-timeline-row--skipped";
    case "cancelled":
      return "gc-run-timeline-row--cancelled";
    case "partial":
      return "gc-run-timeline-row--partial";
    default: {
      const _x: never = status;
      return _x;
    }
  }
}

export function ConsolePanel({ heightPx, onResizeStart, onNavigateToNode }: Props) {
  const { t } = useTranslation();
  const { consoleLines, pythonBanner, replaySourceLabel } = useRunSession();
  const bodyRef = useRef<HTMLDivElement>(null);
  const tailStickRef = useRef(true);
  const [filterMode, setFilterMode] = useState<ConsoleFilterMode>("all");
  const [search, setSearch] = useState("");
  const [panelTab, setPanelTab] = useState<PanelTab>("log");

  const timeline = useMemo(() => reduceConsoleLinesToRunTimeline(consoleLines), [consoleLines]);

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
          ref={bodyRef}
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
            ) : (
              visibleRows.map((row) => {
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
                    {m.streamBackpressureDropped != null
                      ? t("app.run.console.outputTruncated", { count: m.streamBackpressureDropped })
                      : gcHint !== ""
                        ? <>
                            {jsonHighlightedConsoleLine(m.displayLine)}
                            <span className="gc-console-gc-hint"> — {gcHint}</span>
                          </>
                        : jsonHighlightedConsoleLine(m.displayLine)}
                  </pre>
                );
              })
            )
          ) : consoleLines.length === 0 ? (
            <div className="gc-console-line gc-console-line--muted">{t("app.console.empty")}</div>
          ) : timeline.length === 0 ? (
            <div className="gc-console-line gc-console-line--muted">{t("app.console.timelineEmpty")}</div>
          ) : (
            timeline.map((row) => {
              const navigable = onNavigateToNode != null;
              const statusLabel = t(`app.console.timelineStatus.${row.status}`);
              const typePart = row.nodeType != null ? `${row.nodeType} · ` : "";
              const mainText = `${typePart}${truncateNodeLabel(row.nodeId, 36)}`;
              const metaParts = [
                row.durationMs != null ? formatStepDuration(row.durationMs) : null,
                row.summary != null && row.summary !== "" ? row.summary : null,
              ].filter(Boolean);
              const rowClass = ["gc-run-timeline-row", runTimelineStatusRowClass(row.status), navigable ? "gc-run-timeline-row--nav" : ""]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={row.id}
                  className={rowClass}
                  role={navigable ? "button" : undefined}
                  tabIndex={navigable ? 0 : undefined}
                  aria-label={t("app.console.timelineRowAria", {
                    nodeId: row.nodeId,
                    status: statusLabel,
                  })}
                  onClick={() => {
                    if (onNavigateToNode != null) {
                      onNavigateToNode(row.nodeId);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (!navigable) {
                      return;
                    }
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onNavigateToNode(row.nodeId);
                    }
                  }}
                >
                  <span className="gc-run-timeline-row__status" title={statusLabel} aria-hidden />
                  <span className="gc-run-timeline-row__body">
                    <span className="gc-run-timeline-row__title">{mainText}</span>
                    {metaParts.length > 0 ? (
                      <span className="gc-run-timeline-row__meta">{metaParts.join(" · ")}</span>
                    ) : null}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </footer>
    </>
  );
}
