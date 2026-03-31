// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

import {
  assignTimelineLanes,
  maxTimelineDurationMs,
  runTimelineStatusRowClass,
  type RunTimelineRow,
} from "../run/buildRunTimeline";

export type ExecutionTimelineProps = {
  rows: RunTimelineRow[];
  /** When set, rows are keyboard- and click-navigable to the canvas node. */
  onNavigateToNode?: (nodeId: string) => void;
};

const LANE_INDENT_PX = 14;

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

  return (
    <ul className="gc-execution-timeline" data-testid="gc-execution-timeline">
      {rows.map((row, i) => {
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
            style={{ marginLeft: lanes[i]! * LANE_INDENT_PX }}
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
      })}
    </ul>
  );
}
