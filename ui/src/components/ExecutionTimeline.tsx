// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

import {
  assignTimelineLanes,
  maxTimelineDurationMs,
  runTimelineStatusRowClass,
  type RunTimelineRow,
} from "../run/buildRunTimeline";
import { useVirtualList } from "../hooks/useVirtualList";

export type ExecutionTimelineProps = {
  rows: RunTimelineRow[];
  /** When set, rows are keyboard- and click-navigable to the canvas node. */
  onNavigateToNode?: (nodeId: string) => void;
};

const LANE_INDENT_PX = 14;
const STEP_ROW_HEIGHT_PX = 52;
const RENDER_WINDOW_OVERSCAN = 10;
const VIRTUALIZE_THRESHOLD = 100;

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

/**
 * Compact execution list: duration bars, staggered lanes when line intervals overlap, failed rows emphasized.
 */
export function ExecutionTimeline({ rows, onNavigateToNode }: ExecutionTimelineProps) {
  const { t } = useTranslation();
  const maxDur = maxTimelineDurationMs(rows);
  const lanes = assignTimelineLanes(rows);
  const navigable = onNavigateToNode != null;

  const shouldVirtualize = rows.length >= VIRTUALIZE_THRESHOLD;

  const v = useVirtualList({
    itemCount: shouldVirtualize ? rows.length : 0,
    itemHeight: STEP_ROW_HEIGHT_PX,
    overscan: RENDER_WINDOW_OVERSCAN,
    estimatedViewportHeight: 360,
  });

  const renderRow = (row: RunTimelineRow, i: number, fixedHeight?: number) => {
    const failed = row.status === "failed";
    const widthPct =
      row.durationMs != null && maxDur > 0
        ? Math.min(100, Math.max(6, (row.durationMs / maxDur) * 100))
        : null;
    const statusLabel = t(`app.console.timelineStatus.${row.status}`);
    const typePart = row.nodeType != null ? `${row.nodeType} · ` : "";
    const mainText = `${typePart}${truncateNodeLabel(row.nodeId, 36)}`;
    const metaParts = [
      row.durationMs != null ? formatStepDuration(row.durationMs) : null,
      row.summary != null && row.summary !== "" ? row.summary : null,
    ].filter(Boolean);

    const rowClass = [
      "gc-execution-timeline__row",
      runTimelineStatusRowClass(row.status),
      navigable ? "gc-run-timeline-row--nav" : "",
    ]
      .filter(Boolean)
      .join(" ");

    return (
      <li
        key={row.id}
        className={rowClass}
        style={{
          marginLeft: lanes[i]! * LANE_INDENT_PX,
          ...(fixedHeight != null
            ? { height: fixedHeight, boxSizing: "border-box" as const, overflow: "hidden" as const }
            : {}),
        }}
        data-testid={`gc-timeline-row-${row.nodeId}`}
        role={navigable ? "button" : undefined}
        tabIndex={navigable ? 0 : undefined}
        aria-label={navigable ? t("app.console.timelineRowAria", { nodeId: row.nodeId, status: statusLabel }) : undefined}
        onClick={() => {
          if (onNavigateToNode != null) {
            onNavigateToNode(row.nodeId);
          }
        }}
        onKeyDown={(e) => {
          if (onNavigateToNode == null) {
            return;
          }
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onNavigateToNode(row.nodeId);
          }
        }}
      >
        <span className="gc-run-timeline-row__status" title={statusLabel} aria-hidden />
        <div className="gc-execution-timeline__body">
          <div className="gc-run-timeline-row__title">{mainText}</div>
          {metaParts.length > 0 ? (
            <div className="gc-run-timeline-row__meta">{metaParts.join(" · ")}</div>
          ) : null}
          {widthPct != null ? (
            <div
              role="presentation"
              data-testid="gc-timeline-duration-bar"
              className="gc-execution-timeline__bar"
              style={{
                width: `${widthPct}%`,
                background: failed ? "#c62828" : "#1565c0",
              }}
            />
          ) : null}
        </div>
      </li>
    );
  };

  if (!shouldVirtualize) {
    return (
      <ul className="gc-execution-timeline" data-testid="gc-execution-timeline">
        {rows.map((row, i) => renderRow(row, i))}
      </ul>
    );
  }

  return (
    <div
      ref={v.containerRef}
      className="gc-execution-timeline-scroll"
      data-testid="gc-execution-timeline-scroll"
      onScroll={v.onScroll}
      style={{ overflowY: "auto", height: "100%", minHeight: 0 }}
    >
      <ul
        className="gc-execution-timeline gc-execution-timeline--virtual"
        data-testid="gc-execution-timeline"
        style={{ position: "relative", height: v.totalHeight, margin: 0, padding: 0 }}
      >
        <li
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            transform: `translateY(${v.offsetTop}px)`,
            listStyle: "none",
          }}
        >
          <ul
            className="gc-execution-timeline-window"
            role="presentation"
            style={{ margin: 0, padding: 0, listStyle: "none" }}
          >
            {rows.slice(v.startIndex, v.endIndex).map((row, i) =>
              renderRow(row, v.startIndex + i, STEP_ROW_HEIGHT_PX),
            )}
          </ul>
        </li>
      </ul>
    </div>
  );
}
