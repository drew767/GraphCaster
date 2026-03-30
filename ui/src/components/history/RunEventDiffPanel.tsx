// Copyright GraphCaster. All Rights Reserved.

import { useTranslation } from "react-i18next";

import type { HistoryRunEvent } from "../../stores/historyStore";

function formatEvent(ev: HistoryRunEvent | null): string {
  if (ev == null) {
    return "";
  }
  try {
    return JSON.stringify(ev.data, null, 2);
  } catch {
    return String(ev.data);
  }
}

type Props = {
  events: HistoryRunEvent[];
  currentIndex: number;
};

export function RunEventDiffPanel({ events, currentIndex }: Props) {
  const { t } = useTranslation();

  if (events.length === 0) {
    return <p className="gc-modal-hint">{t("app.runHistory.diffNeedEvents")}</p>;
  }

  const i = Math.max(0, Math.min(currentIndex, events.length - 1));
  const prev = i > 0 ? events[i - 1]! : null;
  const cur = events[i]!;

  const left = formatEvent(prev);
  const right = formatEvent(cur);

  return (
    <div className="gc-run-history-diff">
      <p className="gc-run-history-diff-hint">{t("app.runHistory.diffHint", { index: i })}</p>
      <div className="gc-run-history-diff-columns">
        <div className="gc-run-history-diff-col">
          <div className="gc-run-history-diff-col-title">
            {prev == null ? t("app.runHistory.diffPrevEmpty") : t("app.runHistory.diffPrev", { idx: prev.index })}
          </div>
          <pre className="gc-run-history-diff-pre" tabIndex={0}>
            {prev == null ? "—" : left || "—"}
          </pre>
        </div>
        <div className="gc-run-history-diff-col">
          <div className="gc-run-history-diff-col-title">
            {t("app.runHistory.diffCurrent", { idx: cur.index, type: cur.type })}
          </div>
          <pre className="gc-run-history-diff-pre" tabIndex={0}>
            {right || "—"}
          </pre>
        </div>
      </div>
    </div>
  );
}
