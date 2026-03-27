// Copyright GraphCaster. All Rights Reserved.

import { invoke } from "@tauri-apps/api/core";

import type { GcStartRunJob } from "./runSessionStore";
import * as runStore from "./runSessionStore";
import i18n from "../i18n";
import { isTauriRuntime } from "./tauriEnv";
import {
  probeRunBrokerHealth,
  startWebBrokerRun,
  cancelWebBrokerRun,
  fetchPersistedRunEvents,
  fetchPersistedRunList,
  fetchPersistedRunSummary,
} from "./webRunBroker";

export type RunEnvInfo = {
  pythonPath: string;
  moduleAvailable: boolean;
};

let runEnvCache: RunEnvInfo | null = null;

export function invalidateRunEnvironmentInfoCache(): void {
  runEnvCache = null;
}

export async function getRunEnvironmentInfo(forceRefresh = false): Promise<RunEnvInfo> {
  if (!forceRefresh && runEnvCache !== null) {
    return runEnvCache;
  }
  if (isTauriRuntime()) {
    runEnvCache = await invoke<RunEnvInfo>("get_run_environment_info");
    return runEnvCache;
  }
  const ok = await probeRunBrokerHealth();
  runEnvCache = {
    pythonPath: "python -m graph_caster serve",
    moduleAvailable: ok,
  };
  return runEnvCache;
}

export async function gcStartRun(args: {
  documentJson: string;
  runId: string;
  graphsDir?: string;
  artifactsBase?: string;
  untilNodeId?: string;
  contextJsonPath?: string;
  stepCache?: boolean;
  stepCacheDirty?: string;
}): Promise<void> {
  if (!isTauriRuntime()) {
    await startWebBrokerRun(args);
    return;
  }
  const dirty =
    args.stepCacheDirty == null || args.stepCacheDirty === "" ? null : args.stepCacheDirty;
  await invoke("gc_start_run", {
    request: {
      documentJson: args.documentJson,
      runId: args.runId,
      graphsDir: args.graphsDir == null || args.graphsDir === "" ? null : args.graphsDir,
      artifactsBase:
        args.artifactsBase == null || args.artifactsBase === "" ? null : args.artifactsBase,
      untilNodeId: args.untilNodeId == null || args.untilNodeId === "" ? null : args.untilNodeId,
      contextJsonPath:
        args.contextJsonPath == null || args.contextJsonPath === "" ? null : args.contextJsonPath,
      stepCache: args.stepCache === true ? true : null,
      stepCacheDirty: dirty,
    },
  });
}

export async function gcCancelRun(runId: string): Promise<void> {
  if (!isTauriRuntime()) {
    await cancelWebBrokerRun(runId);
    return;
  }
  await invoke("gc_cancel_run", { req: { runId } });
}

export async function launchGcStartJob(
  job: GcStartRunJob,
  options?: { afterSuccessfulStart?: () => void },
): Promise<void> {
  runStore.runSessionClearReplay();
  runStore.runSessionClearOutputSnapshotsForRun(job.runId.trim());
  runStore.runSessionRegisterLiveRun(job.runId);
  const dirtyCsv = job.stepCacheDirty ?? "";
  if (dirtyCsv !== "") {
    runStore.runSessionAppendLineForRun(job.runId, `[host] step-cache dirty: ${dirtyCsv}`);
  }
  runStore.runSessionAppendLineForRun(job.runId, `[host] starting run ${job.runId}`);
  try {
    await gcStartRun(job);
    options?.afterSuccessfulStart?.();
  } catch (e) {
    runStore.runSessionAppendLineForRun(job.runId, `[host] ${String(e)}`);
    if (String(e).toLowerCase().includes("max concurrent")) {
      runStore.runSessionAppendLineForRun(
        job.runId,
        `[host] ${i18n.t("app.run.hostConcurrencyHint")}`,
      );
    }
    const next = runStore.runSessionAbortRegisteredRun(job.runId);
    if (next) {
      void launchGcStartJob(next, options);
    }
    throw e;
  }
}

export type PersistedRunListItem = {
  runDirName: string;
  hasEvents: boolean;
  hasSummary: boolean;
};

export async function gcListPersistedRuns(artifactsBase: string, graphId: string): Promise<PersistedRunListItem[]> {
  const ab = artifactsBase.trim();
  const gid = graphId.trim();
  if (!ab || !gid) {
    return [];
  }
  if (isTauriRuntime()) {
    return await invoke<PersistedRunListItem[]>("gc_list_persisted_runs", {
      req: { artifactsBase: ab, graphId: gid },
    });
  }
  return fetchPersistedRunList(ab, gid);
}

export type PersistedRunEventsRead = {
  text: string;
  truncated: boolean;
};

export async function gcReadPersistedRunEvents(
  artifactsBase: string,
  graphId: string,
  runDirName: string,
  maxBytes = 1_000_000,
): Promise<PersistedRunEventsRead> {
  const ab = artifactsBase.trim();
  const gid = graphId.trim();
  const rd = runDirName.trim();
  if (!ab || !gid || !rd) {
    return { text: "", truncated: false };
  }
  if (isTauriRuntime()) {
    return await invoke<PersistedRunEventsRead>("gc_read_persisted_events", {
      req: { artifactsBase: ab, graphId: gid, runDirName: rd, maxBytes },
    });
  }
  return fetchPersistedRunEvents(ab, gid, rd, maxBytes);
}

export async function gcReadPersistedRunSummary(
  artifactsBase: string,
  graphId: string,
  runDirName: string,
): Promise<string | null> {
  const ab = artifactsBase.trim();
  const gid = graphId.trim();
  const rd = runDirName.trim();
  if (!ab || !gid || !rd) {
    return null;
  }
  if (isTauriRuntime()) {
    return await invoke<string | null>("gc_read_persisted_run_summary", {
      req: { artifactsBase: ab, graphId: gid, runDirName: rd, maxBytes: 1_000_000 },
    });
  }
  return fetchPersistedRunSummary(ab, gid, rd);
}
