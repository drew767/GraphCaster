// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";

import { gcListPersistedRuns, gcReadPersistedRunEvents, type PersistedRunListItem } from "../run/runCommands";
import { loadReplayNdjsonText } from "../run/runEventSideEffects";

type Props = {
  open: boolean;
  onClose: () => void;
  artifactsBase: string;
  graphId: string;
};

export function RunHistoryModal({ open, onClose, artifactsBase, graphId }: Props) {
  const { t } = useTranslation();
  const [items, setItems] = useState<PersistedRunListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replayBusy, setReplayBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const ab = artifactsBase.trim();
    const gid = graphId.trim();
    if (!ab || !gid) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await gcListPersistedRuns(ab, gid);
      setItems(rows);
    } catch (e) {
      setError(String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [artifactsBase, graphId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  const onBackdropClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  const onReplay = useCallback(
    async (runDirName: string) => {
      const ab = artifactsBase.trim();
      const gid = graphId.trim();
      if (!ab || !gid) {
        return;
      }
      setReplayBusy(runDirName);
      setError(null);
      try {
        const { text, truncated } = await gcReadPersistedRunEvents(ab, gid, runDirName);
        const label = t("app.runHistory.replayLabel", { dir: runDirName });
        loadReplayNdjsonText(
          text,
          label,
          truncated ? `[host] ${t("app.runHistory.logTruncated")}` : undefined,
        );
        onClose();
      } catch (e) {
        setError(String(e));
      } finally {
        setReplayBusy(null);
      }
    },
    [artifactsBase, graphId, onClose, t],
  );

  if (!open) {
    return null;
  }

  const abOk = artifactsBase.trim() !== "" && graphId.trim() !== "";

  return (
    <div className="gc-modal-backdrop" role="presentation" onClick={onBackdropClick}>
      <div
        className="gc-modal gc-modal--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="gc-run-history-title"
        onClick={(e) => {
          e.stopPropagation();
        }}
      >
        <h2 id="gc-run-history-title" className="gc-modal-title">
          {t("app.runHistory.title")}
        </h2>
        {!abOk ? (
          <p className="gc-modal-hint">{t("app.runHistory.needArtifactsAndGraph")}</p>
        ) : loading ? (
          <p className="gc-modal-hint">{t("app.runHistory.loading")}</p>
        ) : items.length === 0 ? (
          <p className="gc-modal-hint">{t("app.runHistory.empty")}</p>
        ) : (
          <ul className="gc-run-history-list">
            {items.map((row) => (
              <li key={row.runDirName} className="gc-run-history-row">
                <span className="gc-run-history-name">{row.runDirName}</span>
                <span className="gc-run-history-meta">
                  {row.hasEvents ? t("app.runHistory.hasEvents") : t("app.runHistory.noEvents")}
                  {row.hasSummary ? ` · ${t("app.runHistory.hasSummary")}` : null}
                </span>
                <button
                  type="button"
                  className="gc-btn gc-btn-small gc-btn-primary"
                  disabled={!row.hasEvents || replayBusy !== null}
                  title={row.hasEvents ? undefined : t("app.runHistory.replayDisabledHint")}
                  onClick={() => void onReplay(row.runDirName)}
                >
                  {replayBusy === row.runDirName ? t("app.runHistory.replayBusy") : t("app.runHistory.replay")}
                </button>
              </li>
            ))}
          </ul>
        )}
        {error != null ? <p className="gc-modal-hint gc-modal-hint--error">{error}</p> : null}
        <div className="gc-modal-actions">
          <button type="button" className="gc-btn" onClick={() => void refresh()} disabled={!abOk || loading}>
            {t("app.runHistory.refresh")}
          </button>
          <button type="button" className="gc-btn" onClick={onClose}>
            {t("app.runHistory.close")}
          </button>
        </div>
      </div>
    </div>
  );
}
