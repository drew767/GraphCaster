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

import { EventTimeline } from "./history/EventTimeline";
import { ndjsonTextToRunEvents } from "./history/ndjsonRunEvents";
import { RunArtifactPanel } from "./history/RunArtifactPanel";
import { RunEventDiffPanel } from "./history/RunEventDiffPanel";
import { RunList } from "./history/RunList";
import {
  gcListPersistedRuns,
  gcListRunCatalog,
  gcReadPersistedRunEvents,
  gcRebuildRunCatalog,
  type RunCatalogRow,
} from "../run/runCommands";
import { peekRootGraphIdFromNdjson } from "../run/parseRunEventLine";
import { loadReplayNdjsonText } from "../run/runEventSideEffects";
import { useHistoryStore, type RunSummary } from "../stores/historyStore";

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

function normalizeCatalogStatus(raw: string): RunSummary["status"] {
  const x = raw.trim().toLowerCase();
  if (x === "running" || x === "pending" || x === "completed" || x === "failed" || x === "cancelled") {
    return x;
  }
  return "completed";
}

function graphPersistedToSummaries(gid: string, rows: Awaited<ReturnType<typeof gcListPersistedRuns>>): RunSummary[] {
  return rows.map((row) => ({
    runId: row.runDirName,
    graphId: gid,
    graphName: row.runDirName,
    status: row.hasSummary ? "completed" : "running",
    startedAt: "",
    eventCount: 0,
    trigger: "manual",
    artifactRunDir: row.runDirName,
    hasEvents: row.hasEvents,
  }));
}

function catalogRowsToSummaries(rows: RunCatalogRow[]): RunSummary[] {
  return rows.map((row) => ({
    runId: row.runId,
    graphId: row.rootGraphId,
    graphName: row.runDirName,
    status: normalizeCatalogStatus(row.status),
    startedAt: row.startedAt ?? "",
    finishedAt: row.finishedAt,
    eventCount: 0,
    trigger: "manual",
    artifactRunDir: row.runDirName,
  }));
}

type DetailTab = "overview" | "events" | "artifacts" | "diff";

export function RunHistoryModal({ open, onClose, artifactsBase, graphId }: Props) {
  const { t } = useTranslation();
  const tabGraphRef = useRef<HTMLButtonElement | null>(null);
  const tabWorkspaceRef = useRef<HTMLButtonElement | null>(null);
  const [scope, setScope] = useState<HistoryScope>("graph");
  const [workspaceFilterThisGraph, setWorkspaceFilterThisGraph] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("overview");
  const [notice, setNotice] = useState<string | null>(null);
  const [replayBusy, setReplayBusy] = useState<string | null>(null);
  const [rebuildBusy, setRebuildBusy] = useState(false);

  const runs = useHistoryStore((s) => s.runs);
  const selectedRunId = useHistoryStore((s) => s.selectedRunId);
  const selectedRun = useHistoryStore((s) => s.selectedRun);
  const events = useHistoryStore((s) => s.events);
  const replayState = useHistoryStore((s) => s.replayState);
  const loading = useHistoryStore((s) => s.isLoading);
  const error = useHistoryStore((s) => s.error);

  const setRuns = useHistoryStore((s) => s.setRuns);
  const setLoading = useHistoryStore((s) => s.setLoading);
  const setError = useHistoryStore((s) => s.setError);
  const selectRun = useHistoryStore((s) => s.selectRun);
  const setEvents = useHistoryStore((s) => s.setEvents);
  const setEventsLoading = useHistoryStore((s) => s.setEventsLoading);
  const setReplayState = useHistoryStore((s) => s.setReplayState);
  const resetHistory = useHistoryStore((s) => s.reset);

  const refreshGraph = useCallback(async () => {
    const ab = artifactsBase.trim();
    const gid = graphId.trim();
    if (!ab || !gid) {
      setRuns([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const rows = await gcListPersistedRuns(ab, gid);
      setRuns(graphPersistedToSummaries(gid, rows));
    } catch (e) {
      setError(String(e));
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [artifactsBase, graphId, setRuns, setLoading, setError]);

  const refreshWorkspace = useCallback(
    async (opts?: { showLoading?: boolean }) => {
      const showLoading = opts?.showLoading !== false;
      const ab = artifactsBase.trim();
      if (!ab) {
        setRuns([]);
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
        setRuns(catalogRowsToSummaries(rows));
      } catch (e) {
        setError(String(e));
        setRuns([]);
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [artifactsBase, graphId, workspaceFilterThisGraph, setRuns, setLoading, setError],
  );

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
    resetHistory();
    setDetailTab("overview");
    if (scope === "graph") {
      void refreshGraph();
    } else {
      void refreshWorkspace();
    }
  }, [open, scope, workspaceFilterThisGraph, resetHistory, refreshGraph, refreshWorkspace]);

  const eventsLoading = useHistoryStore((s) => s.eventsLoading);

  useEffect(() => {
    if (!open || (detailTab !== "events" && detailTab !== "diff") || selectedRun == null) {
      return;
    }
    const ab = artifactsBase.trim();
    const gid = selectedRun.graphId.trim();
    const rd = (selectedRun.artifactRunDir ?? selectedRun.runId).trim();
    if (!ab || !gid || !rd) {
      setEvents([]);
      return;
    }
    let cancelled = false;
    setEventsLoading(true);
    void gcReadPersistedRunEvents(ab, gid, rd)
      .then(({ text }) => {
        if (cancelled) {
          return;
        }
        const ev = ndjsonTextToRunEvents(text);
        setEvents(ev);
        setReplayState({
          currentIndex: 0,
          totalEvents: ev.length,
          nodeStates: {},
          nodeOutputs: {},
          isPlaying: false,
        });
      })
      .catch((e) => {
        if (!cancelled) {
          setError(String(e));
          setEvents([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setEventsLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    detailTab,
    selectedRun,
    artifactsBase,
    setEvents,
    setEventsLoading,
    setReplayState,
    setError,
  ]);

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

  const onReplaySelectedRun = useCallback(async () => {
    if (selectedRun == null) {
      return;
    }
    const rd = selectedRun.artifactRunDir ?? selectedRun.runId;
    if (scope === "graph") {
      await onReplayGraph(rd);
    } else {
      await onReplayCatalog({
        runId: selectedRun.runId,
        rootGraphId: selectedRun.graphId,
        runDirName: rd,
        status: selectedRun.status,
        startedAt: selectedRun.startedAt || null,
        finishedAt: selectedRun.finishedAt ?? "",
        artifactRelPath: "",
      });
    }
  }, [selectedRun, scope, onReplayGraph, onReplayCatalog]);

  const replayBusyKey =
    selectedRun != null
      ? scope === "graph"
        ? selectedRun.artifactRunDir ?? selectedRun.runId
        : catalogReplayKey({
            runId: selectedRun.runId,
            rootGraphId: selectedRun.graphId,
            runDirName: selectedRun.artifactRunDir ?? selectedRun.runId,
            status: selectedRun.status,
            startedAt: selectedRun.startedAt || null,
            finishedAt: selectedRun.finishedAt ?? "",
            artifactRelPath: "",
          })
      : null;

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
              selectRun(null);
              setDetailTab("overview");
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
              selectRun(null);
              setDetailTab("overview");
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
        {scope === "graph" && !abOk ? (
          <p className="gc-modal-hint">{t("app.runHistory.needArtifactsAndGraph")}</p>
        ) : scope === "workspace" && !workspaceAbOk ? (
          <p className="gc-modal-hint">{t("app.runHistory.needArtifactsWorkspace")}</p>
        ) : (
          <div className="gc-run-history-split">
            <aside className="gc-run-history-split-sidebar">
              <RunList
                runs={runs}
                selectedId={selectedRunId}
                onSelect={(id) => {
                  selectRun(id);
                  setDetailTab("overview");
                }}
                isLoading={loading}
              />
            </aside>
            <div className="gc-run-history-split-main">
              {selectedRun == null ? (
                <p className="gc-modal-hint">
                  {t("app.runHistory.selectRunHint", { defaultValue: "Select a run to view details." })}
                </p>
              ) : (
                <>
                  <div className="gc-run-history-detail-tabs" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={detailTab === "overview"}
                      className={`gc-run-history-tab${detailTab === "overview" ? " gc-run-history-tab--active" : ""}`}
                      onClick={() => setDetailTab("overview")}
                    >
                      {t("app.runHistory.tabOverview", { defaultValue: "Overview" })}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={detailTab === "events"}
                      className={`gc-run-history-tab${detailTab === "events" ? " gc-run-history-tab--active" : ""}`}
                      onClick={() => setDetailTab("events")}
                    >
                      {t("app.runHistory.tabEvents", { defaultValue: "Events" })}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={detailTab === "artifacts"}
                      className={`gc-run-history-tab${detailTab === "artifacts" ? " gc-run-history-tab--active" : ""}`}
                      onClick={() => setDetailTab("artifacts")}
                    >
                      {t("app.runHistory.tabArtifacts", { defaultValue: "Artifacts" })}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={detailTab === "diff"}
                      className={`gc-run-history-tab${detailTab === "diff" ? " gc-run-history-tab--active" : ""}`}
                      onClick={() => setDetailTab("diff")}
                    >
                      {t("app.runHistory.tabDiff", { defaultValue: "Diff" })}
                    </button>
                  </div>
                  <div className="gc-run-history-detail-panel">
                    {detailTab === "overview" ? (
                      <div className="gc-run-overview">
                        <h3 className="gc-run-overview-title">{selectedRun.graphName}</h3>
                        <dl className="gc-run-overview-dl">
                          <dt>{t("app.runHistory.overviewStatus", { defaultValue: "Status" })}</dt>
                          <dd>{selectedRun.status}</dd>
                          <dt>{t("app.runHistory.overviewGraphId", { defaultValue: "Graph id" })}</dt>
                          <dd className="gc-run-overview-mono">{selectedRun.graphId}</dd>
                          <dt>{t("app.runHistory.overviewStarted", { defaultValue: "Started" })}</dt>
                          <dd>{selectedRun.startedAt.trim() === "" ? "—" : selectedRun.startedAt}</dd>
                          {selectedRun.finishedAt != null && selectedRun.finishedAt !== "" ? (
                            <>
                              <dt>{t("app.runHistory.overviewFinished", { defaultValue: "Finished" })}</dt>
                              <dd>{selectedRun.finishedAt}</dd>
                            </>
                          ) : null}
                          <dt>{t("app.runHistory.overviewTrigger", { defaultValue: "Trigger" })}</dt>
                          <dd>{selectedRun.trigger}</dd>
                          {scope === "graph" && selectedRun.hasEvents != null ? (
                            <>
                              <dt>{t("app.runHistory.overviewEventsFile", { defaultValue: "Events log" })}</dt>
                              <dd>
                                {selectedRun.hasEvents
                                  ? t("app.runHistory.hasEvents")
                                  : t("app.runHistory.noEvents")}
                              </dd>
                            </>
                          ) : null}
                        </dl>
                        <button
                          type="button"
                          className="gc-btn gc-btn-small gc-btn-primary"
                          disabled={
                            replayBusy !== null ||
                            (scope === "graph" && selectedRun.hasEvents === false)
                          }
                          title={
                            scope === "graph" && selectedRun.hasEvents === false
                              ? t("app.runHistory.replayDisabledHint")
                              : undefined
                          }
                          onClick={() => void onReplaySelectedRun()}
                        >
                          {replayBusy != null && replayBusyKey != null && replayBusy === replayBusyKey
                            ? t("app.runHistory.replayBusy")
                            : t("app.runHistory.replay")}
                        </button>
                      </div>
                    ) : null}
                    {detailTab === "events" ? (
                      eventsLoading ? (
                        <p className="gc-modal-hint">{t("app.runHistory.loading")}</p>
                      ) : replayState != null ? (
                        <EventTimeline
                          events={events}
                          currentIndex={replayState.currentIndex}
                          onSeek={(i) => {
                            setReplayState({
                              ...replayState,
                              currentIndex: i,
                              totalEvents: events.length,
                            });
                          }}
                          onStepForward={() => {
                            const rs = useHistoryStore.getState().replayState;
                            const evs = useHistoryStore.getState().events;
                            if (rs == null || evs.length === 0) {
                              return;
                            }
                            const ni = Math.min(rs.currentIndex + 1, Math.max(0, evs.length - 1));
                            setReplayState({
                              ...rs,
                              currentIndex: ni,
                              totalEvents: evs.length,
                            });
                          }}
                          onStepBackward={() => {
                            const rs = useHistoryStore.getState().replayState;
                            const evs = useHistoryStore.getState().events;
                            if (rs == null || evs.length === 0) {
                              return;
                            }
                            const ni = Math.max(rs.currentIndex - 1, 0);
                            setReplayState({
                              ...rs,
                              currentIndex: ni,
                              totalEvents: evs.length,
                            });
                          }}
                        />
                      ) : (
                        <p className="gc-modal-hint">{t("app.runHistory.eventsNoData", { defaultValue: "No events loaded." })}</p>
                      )
                    ) : null}
                    {detailTab === "artifacts" ? (
                      <RunArtifactPanel
                        artifactsBase={artifactsBase}
                        graphId={selectedRun.graphId}
                        runDirName={(selectedRun.artifactRunDir ?? selectedRun.runId).trim()}
                      />
                    ) : null}
                    {detailTab === "diff" ? (
                      eventsLoading ? (
                        <p className="gc-modal-hint">{t("app.runHistory.loading")}</p>
                      ) : (
                        <RunEventDiffPanel
                          events={events}
                          currentIndex={replayState?.currentIndex ?? 0}
                        />
                      )
                    ) : null}
                  </div>
                </>
              )}
            </div>
          </div>
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
