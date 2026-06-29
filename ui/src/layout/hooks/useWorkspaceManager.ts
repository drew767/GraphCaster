// Copyright GraphCaster. All Rights Reserved.

import { useCallback, type MutableRefObject } from "react";

import {
  scanWorkspaceGraphs,
  type WorkspaceGraphEntry,
} from "../../lib/workspaceFs";
import type { GraphRefSnapshotLoadResult } from "../../graph/graphRefLazySnapshot";

/**
 * Workspace-related callbacks lifted out of AppShell.
 *
 * MAY:
 *   - Wrap the workspace-graphs directory scan + index publication.
 *   - Invalidate per-graph-ref snapshot caches when a graph id changes.
 *
 * MUST NOT:
 *   - Own workspace state (`workspaceGraphsDir`, `workspaceIndex`,
 *     `activeWorkspaceFile`, baselines, conflict flags, etc.). State lives in
 *     AppShell; this hook only receives the relevant setters.
 *   - Read or write `graphDocument` / `nestedGraphRefStackRef` /
 *     `workspaceDiskBaselineRef` — those concerns belong to file IO commands
 *     (`onOpenWorkspaceGraph` / `onLinkWorkspace`), which stay in AppShell
 *     until a dedicated `useFileIoCommands` hook lands.
 *   - Trigger React Flow / canvas side effects.
 *
 * Future expansion: when `onLinkWorkspace` / `onOpenWorkspaceGraph` are
 * extracted from AppShell, fold them in here behind the same MAY/MUST NOT
 * contract.
 */
export interface UseWorkspaceManagerParams {
  setWorkspaceIndex: (value: WorkspaceGraphEntry[]) => void;
  graphRefSnapshotCacheRef: MutableRefObject<
    Map<string, GraphRefSnapshotLoadResult>
  >;
  graphRefSnapshotInflightRef: MutableRefObject<
    Map<string, Promise<GraphRefSnapshotLoadResult>>
  >;
}

export interface UseWorkspaceManagerResult {
  /** Re-scan a workspace `graphs/` directory and publish the new index. */
  rescanWorkspace: (dir: FileSystemDirectoryHandle) => Promise<void>;
  /** Drop any cached graph-ref snapshot for the given graph id. */
  invalidateGraphRefSnapshotCacheForGraphId: (
    gid: string | null | undefined,
  ) => void;
}

export function useWorkspaceManager(
  params: UseWorkspaceManagerParams,
): UseWorkspaceManagerResult {
  const {
    setWorkspaceIndex,
    graphRefSnapshotCacheRef,
    graphRefSnapshotInflightRef,
  } = params;

  const rescanWorkspace = useCallback(
    async (dir: FileSystemDirectoryHandle) => {
      graphRefSnapshotCacheRef.current.clear();
      graphRefSnapshotInflightRef.current.clear();
      try {
        setWorkspaceIndex(await scanWorkspaceGraphs(dir));
      } catch {
        setWorkspaceIndex([]);
      }
    },
    [graphRefSnapshotCacheRef, graphRefSnapshotInflightRef, setWorkspaceIndex],
  );

  const invalidateGraphRefSnapshotCacheForGraphId = useCallback(
    (gid: string | null | undefined) => {
      const t = (gid ?? "").trim();
      if (t === "") {
        return;
      }
      graphRefSnapshotCacheRef.current.delete(t);
      graphRefSnapshotInflightRef.current.delete(t);
    },
    [graphRefSnapshotCacheRef, graphRefSnapshotInflightRef],
  );

  return {
    rescanWorkspace,
    invalidateGraphRefSnapshotCacheForGraphId,
  };
}
