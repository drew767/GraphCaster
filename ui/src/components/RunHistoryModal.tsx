// Copyright GraphCaster. All Rights Reserved.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
} from "react";
import { useTranslation } from "react-i18next";

import {
  gcListPersistedRuns,
  gcListRunCatalog,
  gcReadPersistedRunEvents,
  gcRebuildRunCatalog,
  type PersistedRunListItem,
  type RunCatalogRow,
} from "../run/runCommands";
import { peekRootGraphIdFromNdjson } from "../run/parseRunEventLine";
import { loadReplayNdjsonText } from "../run/runEventSideEffects";

type Props = {
  open: boolean;
  onClose: () => void;
  artifactsBase: string;
  graphId: string;
};

type HistoryScope = "graph" | "workspace";

function catalogReplayKey(row: RunCatalogRow): string {
  return `${row.rootGraphId}\0${row.runDirName}`;
}

export function RunHistoryModal({ open, onClose, artifactsBase, graphId }: Props) {
  const { t } = useTranslation();
  const tabGraphRef = useRef<HTMLButtonElement | null>(null);
  const tabWorkspaceRef = useRef<HTMLButtonElement | null>(null);
  const [scope, setScope] = useState<HistoryScope>("graph");
  const [items, setItems] = useState<PersistedRunListItem[]>([]);
  const [catalogRows, setCatalogRows] = useState<RunCatalogRow[]>([]);
  const [workspaceFilterThisGraph, setWorkspaceFilterThisGraph] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [replayBusy, setReplayBusy] = useState<string | null>(null);
  const [rebuildBusy, setRebuildBusy] = useState(false);

  const refreshGraph = useCallback(async () => {
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

  const refreshWorkspace = useCallback(async (opts?: { showLoading?: boolean }) => {
    const showLoading = opts?.showLoading !== false;
    const ab = artifactsBase.trim();
    if (!ab) {
      setCatalogRows([]);
      return;
    }
    if (showLoading) {
      setLoading(true);
    }
    setError(null);
    try {
      const gid = graphId.trim();
      const rows = await gcListRunCatalog(ab, {
        graphId: workspaceFilterThisGraph && gid !== "" ? gid : null,
        limit: 500,
        offset: 0,
      });
      setCatalogRows(rows);
    } catch (e) {
      setError(String(e));
      setCatalogRows([]);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [artifactsBase, graphId, workspaceFilterThisGraph]);

  const refresh = useCallback(async () => {
    setNotice(null);
    if (scope === "graph") {
      await refreshGraph();
    } else {
      await refreshWorkspace();
    }
  }, [scope, refreshGraph, refreshWorkspace]);

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
    const onKey = (ev: globalThis.KeyboardEvent) => {
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

  const onTabListKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>) => {
      if (e.key === "ArrowRight" && scope === "graph") {
        e.preventDefault();
        setScope("workspace");
        requestAnimationFrame(() => tabWorkspaceRef.current?.focus());
      } else if (e.key === "ArrowLeft" && scope === "workspace") {
        e.preventDefault();
        setScope("graph");
        requestAnimationFrame(() => tabGraphRef.current?.focus());
      }
    },
    [scope],
  );

  const onReplayGraph = useCallback(
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
        const logRoot = peekRootGraphIdFromNdjson(text);
        const notices: string[] = [];
        if (truncated) {
          notices.push(`[host] ${t("app.runHistory.logTruncated")}`);
        }
        if (logRoot != null && logRoot !== gid) {
          notices.push(`[host] ${t("app.runHistory.replayGraphIdMismatch", { logRoot, openRoot: gid })}`);
        }
        if (text.trim() === "") {
          setError(t("app.runHistory.replayEmptyLog"));
          return;
        }
        loadReplayNdjsonText(text, label, notices.length > 0 ? notices.join("\n") : undefined);
        onClose();
      } catch (e) {
        setError(String(e));
      } finally {
        setReplayBusy(null);
      }
    },
    [artifactsBase, graphId, onClose, t],
  );

  const onReplayCatalog = useCallback(
    async (row: RunCatalogRow) => {
      const ab = artifactsBase.trim();
      if (!ab) {
        return;
      }
      const key = catalogReplayKey(row);
      setReplayBusy(key);
      setError(null);
      try {
        const { text, truncated } = await gcReadPersistedRunEvents(ab, row.rootGraphId, row.runDirName);
        const label = t("app.runHistory.replayWorkspaceLabel", {
          dir: row.runDirName,
          graphId: row.rootGraphId,
        });
        const logRoot = peekRootGraphIdFromNdjson(text);
        const notices: string[] = [];
        if (truncated) {
          notices.push(`[host] ${t("app.runHistory.logTruncated")}`);
        }
        const openGid = graphId.trim();
        if (logRoot != null && openGid !== "" && logRoot !== openGid) {
          notices.push(`[host] ${t("app.runHistory.replayGraphIdMismatch", { logRoot, openRoot: openGid })}`);
        }
        if (text.trim() === "") {
          setError(t("app.runHistory.replayEmptyLog"));
          return;
        }
        loadReplayNdjsonText(text, label, notices.length > 0 ? notices.join("\n") : undefined);
        onClose();
      } catch (e) {
        setError(String(e));
      } finally {
        setReplayBusy(null);
      }
    },
    [artifactsBase, graphId, onClose, t],
  );

  const onRebuildCatalog = useCallback(async () => {
    const ab = artifactsBase.trim();
    if (!ab) {
      return;
    }
    setRebuildBusy(true);
    setError(null);
    setNotice(null);
    try {
      const countStr = await gcRebuildRunCatalog(ab);
      setNotice(t("app.runHistory.rebuildDone", { indexedTotal: countStr }));
      await refreshWorkspace({ showLoading: false });
    } catch (e) {
      setError(String(e));
    } finally {
      setRebuildBusy(false);
    }
  }, [artifactsBase, refreshWorkspace, t]);

  if (!open) {
    return null;
  }

  const abOk = artifactsBase.trim() !== "" && graphId.trim() !== "";
  const workspaceAbOk = artifactsBase.trim() !== "";

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
        <div
          className="gc-run-history-tabs"
          role="tablist"
          aria-label={t("app.runHistory.scopeAria")}
          onKeyDown={onTabListKeyDown}
        >
          <button
            ref={tabGraphRef}
            type="button"
            id="gc-run-history-tab-graph"
            role="tab"
            tabIndex={scope === "graph" ? 0 : -1}
            aria-selected={scope === "graph"}
            aria-controls="gc-run-history-panel"
            className={`gc-run-history-tab${scope === "graph" ? " gc-run-history-tab--active" : ""}`}
            onClick={() => {
              setScope("graph");
              setNotice(null);
            }}
          >
            {t("app.runHistory.tabGraph")}
          </button>
          <button
            ref={tabWorkspaceRef}
            type="button"
            id="gc-run-history-tab-workspace"
            role="tab"
            tabIndex={scope === "workspace" ? 0 : -1}
            aria-selected={scope === "workspace"}
            aria-controls="gc-run-history-panel"
            className={`gc-run-history-tab${scope === "workspace" ? " gc-run-history-tab--active" : ""}`}
            onClick={() => {
              setScope("workspace");
              setNotice(null);
            }}
          >
            {t("app.runHistory.tabWorkspace")}
          </button>
        </div>
        <div
          id="gc-run-history-panel"
          role="tabpanel"
          aria-labelledby={scope === "graph" ? "gc-run-history-tab-graph" : "gc-run-history-tab-workspace"}
        >
        {scope === "workspace" ? (
          <div className="gc-run-history-workspace-toolbar">
            <label className="gc-run-history-filter">
              <input
                type="checkbox"
                checked={workspaceFilterThisGraph}
                disabled={!abOk || loading}
                onChange={(e) => {
                  setWorkspaceFilterThisGraph(e.target.checked);
                }}
              />{" "}
              {t("app.runHistory.filterThisGraph")}
            </label>
            <button
              type="button"
              className="gc-btn gc-btn-small"
              disabled={!workspaceAbOk || rebuildBusy || loading}
              onClick={() => void onRebuildCatalog()}
            >
              {rebuildBusy ? t("app.runHistory.rebuildBusy") : t("app.runHistory.rebuildCatalog")}
            </button>
          </div>
        ) : null}
        {scope === "graph" ? (
          !abOk ? (
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
                    onClick={() => void onReplayGraph(row.runDirName)}
                  >
                    {replayBusy === row.runDirName ? t("app.runHistory.replayBusy") : t("app.runHistory.replay")}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : !workspaceAbOk ? (
          <p className="gc-modal-hint">{t("app.runHistory.needArtifactsWorkspace")}</p>
        ) : loading ? (
          <p className="gc-modal-hint">{t("app.runHistory.loading")}</p>
        ) : catalogRows.length === 0 ? (
          <p className="gc-modal-hint">{t("app.runHistory.workspaceEmpty")}</p>
        ) : (
          <ul className="gc-run-history-list">
            {catalogRows.map((row) => {
              const rk = catalogReplayKey(row);
              return (
                <li key={`${row.runId}-${rk}`} className="gc-run-history-row gc-run-history-row--catalog">
                  <div className="gc-run-history-name-block">
                    <span className="gc-run-history-name">{row.runDirName}</span>
                    <span className="gc-run-history-sub">
                      {t("app.runHistory.workspaceRowMeta", {
                        status: row.status,
                        graphId: row.rootGraphId,
                        finishedAt: row.finishedAt,
                      })}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="gc-btn gc-btn-small gc-btn-primary"
                    disabled={replayBusy !== null}
                    onClick={() => void onReplayCatalog(row)}
                  >
                    {replayBusy === rk ? t("app.runHistory.replayBusy") : t("app.runHistory.replay")}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        </div>
        {notice != null ? <p className="gc-modal-hint">{notice}</p> : null}
        {error != null ? <p className="gc-modal-hint gc-modal-hint--error">{error}</p> : null}
        <div className="gc-modal-actions">
          <button
            type="button"
            className="gc-btn"
            onClick={() => void refresh()}
            disabled={(scope === "graph" ? !abOk : !workspaceAbOk) || loading || rebuildBusy}
          >
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
