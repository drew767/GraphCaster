// Copyright GraphCaster. All Rights Reserved.

import { invoke } from "@tauri-apps/api/core";

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
  runEnvCache = await invoke<RunEnvInfo>("get_run_environment_info");
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
  await invoke("gc_cancel_run", { req: { runId } });
}
