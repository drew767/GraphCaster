// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

import { useVirtualList } from "../../hooks/useVirtualList";
import type { RunSummary } from "../../stores/historyStore";

type Props = {
  runs: RunSummary[];
  selectedId: string | null;
  onSelect: (runId: string) => void;
  isLoading: boolean;
};

const RUN_ROW_HEIGHT_PX = 56;
const RENDER_WINDOW_OVERSCAN = 10;
const VIRTUALIZE_THRESHOLD = 100;

export function RunList({ runs, selectedId, onSelect, isLoading }: Props) {
  const { t } = useTranslation();

  const shouldVirtualize = runs.length >= VIRTUALIZE_THRESHOLD;

  const v = useVirtualList({
    itemCount: shouldVirtualize ? runs.length : 0,
    itemHeight: RUN_ROW_HEIGHT_PX,
    overscan: RENDER_WINDOW_OVERSCAN,
    estimatedViewportHeight: 480,
  });

  if (isLoading) {
    return <div className="gc-run-list-loading">{t("app.runHistory.loading")}</div>;
  }

  if (runs.length === 0) {
    return <div className="gc-run-list-empty">{t("app.runHistory.empty")}</div>;
  }

  if (!shouldVirtualize) {
    return (
      <ul className="gc-run-list" role="listbox" aria-label={t("app.runHistory.title")}>
        {runs.map((run) => (
          <RunListItem
            key={run.runId}
            run={run}
            selected={run.runId === selectedId}
            onSelect={onSelect}
            t={t}
          />
        ))}
      </ul>
    );
  }

  const slice = runs.slice(v.startIndex, v.endIndex);

  return (
    <div
      ref={v.containerRef}
      className="gc-run-list-scroll"
      onScroll={v.onScroll}
      data-testid="gc-run-list-scroll"
      style={{
        overflowY: "auto",
        maxHeight: "min(50vh, 420px)",
        border: "1px solid var(--gc-border)",
        borderRadius: "var(--gc-radius-sm)",
        background: "var(--gc-surface-0)",
      }}
    >
      <ul
        className="gc-run-list--virtual"
        role="listbox"
        aria-label={t("app.runHistory.title")}
        aria-setsize={runs.length}
        style={{
          position: "relative",
          height: v.totalHeight,
          margin: 0,
          padding: 0,
          listStyle: "none",
        }}
      >
        <li
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            transform: `translateY(${v.offsetTop}px)`,
            listStyle: "none",
          }}
        >
          <ul
            className="gc-run-list-window"
            role="presentation"
            style={{ margin: 0, padding: 0, listStyle: "none" }}
          >
            {slice.map((run, i) => (
              <RunListItem
                key={run.runId}
                run={run}
                selected={run.runId === selectedId}
                onSelect={onSelect}
                t={t}
                ariaPosInSet={v.startIndex + i + 1}
                rowHeight={RUN_ROW_HEIGHT_PX}
              />
            ))}
          </ul>
        </li>
      </ul>
    </div>
  );
}

type RunListItemProps = {
  run: RunSummary;
  selected: boolean;
  onSelect: (runId: string) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  ariaPosInSet?: number;
  rowHeight?: number;
};

function RunListItem({ run, selected, onSelect, t, ariaPosInSet, rowHeight }: RunListItemProps) {
  return (
    <li
      role="option"
      aria-selected={selected}
      aria-posinset={ariaPosInSet}
      data-testid="gc-run-list-item"
      className={`gc-run-list-item${selected ? " gc-run-list-item--selected" : ""}`}
      style={rowHeight != null ? { height: rowHeight, boxSizing: "border-box" } : undefined}
    >
      <button type="button" className="gc-run-list-item-btn" onClick={() => onSelect(run.runId)}>
        <div className="gc-run-list-item-header">
          <span className="gc-run-list-item-name">{run.graphName}</span>
          <StatusBadge status={run.status} />
        </div>
        <div className="gc-run-list-item-meta">
          <span>{formatDate(run.startedAt)}</span>
          <span>
            {run.eventCount} {t("app.runHistory.eventsSuffix", { defaultValue: "events" })}
          </span>
        </div>
      </button>
    </li>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: "#22c55e",
    failed: "#ef4444",
    running: "#3b82f6",
    cancelled: "#6b7280",
    pending: "#f59e0b",
  };

  return (
    <span className="gc-status-badge" style={{ backgroundColor: colors[status] ?? "#6b7280" }}>
      {status}
    </span>
  );
}

function formatDate(isoString: string): string {
  if (isoString.trim() === "") {
    return "—";
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return date.toLocaleString();
}
