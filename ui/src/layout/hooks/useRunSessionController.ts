// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";

import type { GraphCanvasHandle, GraphCanvasSelection } from "../../components/GraphCanvas";
import type { StructureIssue } from "../../graph/structureWarnings";
import { structureIssuesBlockRun } from "../../graph/structureWarnings";
import {
  gcCancelRun,
  getRunEnvironmentInfo,
  launchGcStartJob,
} from "../../run/runCommands";
import type { GcStartRunJob } from "../../run/runSessionStore";
import {
  getRunSessionSnapshot,
  runSessionAppendLine,
  runSessionCanStartAnotherLive,
  runSessionClearReplay,
  runSessionEnqueuePending,
  runSessionSetPythonBanner,
} from "../../run/runSessionStore";
import {
  clearStepCacheDirtyIds,
  getStepCacheDirtySnapshot,
} from "../../run/stepCacheDirtyStore";
import { isTauriRuntime } from "../../run/tauriEnv";

const LS_RUN_GRAPHS = "gc.run.graphsDir";
const LS_RUN_ARTIFACTS = "gc.run.artifactsBase";
const LS_RUN_STEP_CACHE = "gc.run.stepCacheEnabled";

export interface UseRunSessionControllerOptions {
  /** Canvas ref for reading the document at run-start time. */
  canvasRef: RefObject<GraphCanvasHandle | null>;
  /** Ref to current selection (used by run-until-selected). */
  selectionRef: RefObject<GraphCanvasSelection | null>;
  /** Latest structure issues — if blocking, run is refused. */
  structureIssues: StructureIssue[];
  /** Whether the run-session is already blocking edits. */
  runSessionBlocking: boolean;
  /** Reactive current selection (drives memoized `runUntilSelectionEnabled`). */
  selection: GraphCanvasSelection | null;
  /** Push a toast notification. */
  pushToast: (msg: string, kind: "success" | "info" | "warn" | "error") => void;
}

export interface UseRunSessionControllerReturn {
  /** Configured graphs directory passed to the broker (string, persisted to LS). */
  runGraphsDir: string;
  /** Setter for `runGraphsDir`. */
  setRunGraphsDir: (v: string) => void;
  /** Configured artifacts base directory (string, persisted to LS). */
  runArtifactsBase: string;
  /** Setter for `runArtifactsBase`. */
  setRunArtifactsBase: (v: string) => void;
  /** Whether per-step caching is enabled (persisted to LS). */
  stepCacheRunEnabled: boolean;
  /** Setter for `stepCacheRunEnabled`. */
  setStepCacheRunEnabled: (v: boolean) => void;
  /** Python module/broker probe result (null until first probe completes). */
  pyProbe: { ok: boolean; path: string } | null;
  /** True when probe completed and Python module/broker is unavailable. */
  runStartDisabled: boolean;
  /** True when "Run until selected node" should be enabled. */
  runUntilSelectionEnabled: boolean;
  /** Start a run; pass `untilNodeId` to limit. */
  startDesktopRun: (untilNodeId?: string) => Promise<void>;
  /** Convenience wrapper around `startDesktopRun()`. */
  onRunGraph: () => void;
  /** Run up to the currently-selected node, if exactly one is selected. */
  onRunUntilSelectedNode: () => void;
  /** Stop the focused run. */
  onStopRunGraph: () => Promise<void>;
}

/**
 * Manages run-session controls: directory inputs, step cache, python probe,
 * and the start/stop wiring around the run broker. State is kept local and
 * mirrored to localStorage to match the legacy AppShell behaviour.
 */
export function useRunSessionController(
  options: UseRunSessionControllerOptions,
): UseRunSessionControllerReturn {
  const {
    canvasRef,
    selectionRef,
    structureIssues,
    runSessionBlocking,
    selection,
    pushToast,
  } = options;
  const { t } = useTranslation();

  const [runGraphsDir, setRunGraphsDir] = useState(
    () => localStorage.getItem(LS_RUN_GRAPHS) ?? "",
  );
  const [runArtifactsBase, setRunArtifactsBase] = useState(
    () => localStorage.getItem(LS_RUN_ARTIFACTS) ?? "",
  );
  const [stepCacheRunEnabled, setStepCacheRunEnabled] = useState(
    () => localStorage.getItem(LS_RUN_STEP_CACHE) === "1",
  );
  const [pyProbe, setPyProbe] = useState<{ ok: boolean; path: string } | null>(null);

  useEffect(() => {
    localStorage.setItem(LS_RUN_GRAPHS, runGraphsDir);
  }, [runGraphsDir]);
  useEffect(() => {
    localStorage.setItem(LS_RUN_ARTIFACTS, runArtifactsBase);
  }, [runArtifactsBase]);
  useEffect(() => {
    if (runArtifactsBase.trim() === "") {
      setStepCacheRunEnabled(false);
    }
  }, [runArtifactsBase]);
  useEffect(() => {
    localStorage.setItem(LS_RUN_STEP_CACHE, stepCacheRunEnabled ? "1" : "0");
  }, [stepCacheRunEnabled]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      void getRunEnvironmentInfo().then((info) => {
        setPyProbe({ ok: info.moduleAvailable, path: info.pythonPath });
        runSessionSetPythonBanner(
          info.moduleAvailable ? null : t("app.run.brokerMissing", { path: info.pythonPath }),
        );
      });
      return;
    }
    void getRunEnvironmentInfo().then((info) => {
      setPyProbe({ ok: info.moduleAvailable, path: info.pythonPath });
      runSessionSetPythonBanner(
        info.moduleAvailable ? null : t("app.run.pythonMissing", { path: info.pythonPath }),
      );
    });
  }, [t]);

  const startDesktopRun = useCallback(
    async (untilNodeId?: string) => {
      if (structureIssuesBlockRun(structureIssues)) {
        window.alert(t("app.run.fixStructureFirst"));
        return;
      }
      if (pyProbe != null && !pyProbe.ok) {
        window.alert(
          isTauriRuntime()
            ? t("app.run.pythonMissing", { path: pyProbe.path })
            : t("app.run.brokerMissing", { path: pyProbe.path }),
        );
        return;
      }
      const api = canvasRef.current;
      if (!api) {
        return;
      }
      const doc = api.exportDocument();
      const runId = crypto.randomUUID();
      const art = runArtifactsBase.trim();
      const dirtyCsv = getStepCacheDirtySnapshot().ids.join(",");
      const useStepCache = stepCacheRunEnabled && art !== "";
      const job: GcStartRunJob = {
        documentJson: JSON.stringify(doc),
        runId,
        graphsDir: runGraphsDir.trim() || undefined,
        artifactsBase: art === "" ? undefined : art,
        untilNodeId: untilNodeId?.trim() || undefined,
        stepCache: useStepCache ? true : undefined,
        stepCacheDirty: useStepCache && dirtyCsv !== "" ? dirtyCsv : undefined,
      };
      runSessionClearReplay();
      if (!runSessionCanStartAnotherLive()) {
        runSessionEnqueuePending(job);
        const pos = getRunSessionSnapshot().pendingRunCount;
        runSessionAppendLine(
          t("app.run.queuedHost", { runId, position: pos }),
        );
        pushToast(t("app.toast.runQueued"), "info");
        return;
      }
      try {
        await launchGcStartJob(job, {
          afterSuccessfulStart: () => {
            if (useStepCache && dirtyCsv !== "") {
              clearStepCacheDirtyIds();
            }
          },
        });
        pushToast(t("app.toast.runStarted"), "success");
      } catch {
        /* host lines emitted in launchGcStartJob */
      }
    },
    [
      canvasRef,
      pyProbe,
      pushToast,
      runArtifactsBase,
      runGraphsDir,
      stepCacheRunEnabled,
      structureIssues,
      t,
    ],
  );

  const onRunGraph = useCallback(() => {
    void startDesktopRun(undefined);
  }, [startDesktopRun]);

  const onRunUntilSelectedNode = useCallback(() => {
    const sel = selectionRef.current;
    if (sel?.kind === "node") {
      if (sel.graphNodeType === "start") {
        return;
      }
      void startDesktopRun(sel.id);
      return;
    }
    if (sel?.kind === "multiNode" && sel.ids.length === 1) {
      const row = sel.nodes[0];
      if (row == null || row.graphNodeType === "start") {
        return;
      }
      void startDesktopRun(row.id);
    }
  }, [selectionRef, startDesktopRun]);

  const runUntilSelectionEnabled = useMemo(() => {
    if (runSessionBlocking) {
      return false;
    }
    if (pyProbe != null && !pyProbe.ok) {
      return false;
    }
    if (selection?.kind === "node") {
      return selection.graphNodeType !== "start";
    }
    if (selection?.kind === "multiNode" && selection.ids.length === 1) {
      return selection.nodes[0]?.graphNodeType !== "start";
    }
    return false;
  }, [runSessionBlocking, pyProbe, selection]);

  const onStopRunGraph = useCallback(async () => {
    const id = getRunSessionSnapshot().focusedRunId;
    if (!id) {
      return;
    }
    try {
      await gcCancelRun(id);
    } catch (e) {
      runSessionAppendLine(`[host] cancel: ${String(e)}`);
    }
  }, []);

  const runStartDisabled = pyProbe != null && !pyProbe.ok;

  return {
    runGraphsDir,
    setRunGraphsDir,
    runArtifactsBase,
    setRunArtifactsBase,
    stepCacheRunEnabled,
    setStepCacheRunEnabled,
    pyProbe,
    runStartDisabled,
    runUntilSelectionEnabled,
    startDesktopRun,
    onRunGraph,
    onRunUntilSelectedNode,
    onStopRunGraph,
  };
}
