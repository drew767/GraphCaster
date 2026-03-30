// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

import type { RunSummary } from "../../stores/historyStore";

type Props = {
  runs: RunSummary[];
  selectedId: string | null;
  onSelect: (runId: string) => void;
  isLoading: boolean;
};

export function RunList({ runs, selectedId, onSelect, isLoading }: Props) {
  const { t } = useTranslation();

  if (isLoading) {
    return <div className="gc-run-list-loading">{t("app.runHistory.loading")}</div>;
  }

  if (runs.length === 0) {
    return <div className="gc-run-list-empty">{t("app.runHistory.empty")}</div>;
  }

  return (
    <ul className="gc-run-list" role="listbox" aria-label={t("app.runHistory.title")}>
      {runs.map((run) => (
        <li
          key={run.runId}
          role="option"
          aria-selected={run.runId === selectedId}
          className={`gc-run-list-item${run.runId === selectedId ? " gc-run-list-item--selected" : ""}`}
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
      ))}
    </ul>
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
