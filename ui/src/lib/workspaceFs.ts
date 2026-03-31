// Copyright GraphCaster. All Rights Reserved.

import type { GraphDocumentJson } from "../graph/types";
import { graphIdFromDocument, parseGraphDocumentJson } from "../graph/parseDocument";
import { collectRefTargetsFromGraphDocument } from "../graph/workspaceGraphRefCycles";
import { safeGraphDownloadBasename } from "./downloadJson";

const GRAPHS_DIR_NAME = "graphs";

export type WorkspaceGraphEntry = {
  fileName: string;
  graphId: string;
  title?: string;
  duplicateGraphId: boolean;
  refTargets: string[];
};

export function supportsFileSystemAccess(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function pickProjectRootDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!supportsFileSystemAccess()) {
    return null;
  }
  try {
    return await window.showDirectoryPicker({ mode: "readwrite" });
  } catch {
    return null;
  }
}

export async function ensureGraphsDirectory(
  projectRoot: FileSystemDirectoryHandle,
): Promise<FileSystemDirectoryHandle> {
  return projectRoot.getDirectoryHandle(GRAPHS_DIR_NAME, { create: true });
}

function sanitizeFileName(name: string): string {
  const base = name.replace(/^[\\/]+/, "").split(/[/\\]/).pop() ?? name;
  if (base === "" || base === "." || base === "..") {
    return "graph.json";
  }
  return base;
}

/** Basename for a graph JSON under `graphs/`; ensures `.json` suffix. */
export function sanitizeWorkspaceGraphFileName(name: string): string {
  const base = sanitizeFileName(name);
  if (base.toLowerCase().endsWith(".json")) {
    return base;
  }
  return `${base}.json`;
}

export async function scanWorkspaceGraphs(
  graphsDir: FileSystemDirectoryHandle,
): Promise<WorkspaceGraphEntry[]> {
  const raw: Omit<WorkspaceGraphEntry, "duplicateGraphId">[] = [];
  for await (const [name, handle] of graphsDir.entries()) {
    if (handle.kind !== "file" || !name.toLowerCase().endsWith(".json")) {
      continue;
    }
    const fileHandle = handle as FileSystemFileHandle;
    let text: string;
    try {
      text = await (await fileHandle.getFile()).text();
    } catch {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      continue;
    }
    const doc = parseGraphDocumentJson(parsed);
    if (!doc) {
      continue;
    }
    const graphId = graphIdFromDocument(doc);
    if (graphId == null) {
      continue;
    }
    raw.push({
      fileName: name,
      graphId,
      title: typeof doc.meta?.title === "string" ? doc.meta.title : undefined,
      refTargets: collectRefTargetsFromGraphDocument(doc),
    });
  }
  const idCounts = new Map<string, number>();
  for (const r of raw) {
    idCounts.set(r.graphId, (idCounts.get(r.graphId) ?? 0) + 1);
  }
  const withDup = raw.map((r) => ({
    ...r,
    duplicateGraphId: (idCounts.get(r.graphId) ?? 0) > 1,
  }));
  withDup.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return withDup;
}

/** Browser-reported lastModified (ms since epoch) and size for conflict detection (external edit). */
export type WorkspaceGraphDiskFingerprint = {
  lastModifiedMs: number;
  sizeBytes: number;
};

export function workspaceDiskFingerprintConflicts(
  baseline: WorkspaceGraphDiskFingerprint,
  current: WorkspaceGraphDiskFingerprint,
): boolean {
  return (
    baseline.lastModifiedMs !== current.lastModifiedMs || baseline.sizeBytes !== current.sizeBytes
  );
}

export async function getWorkspaceGraphDiskFingerprint(
  graphsDir: FileSystemDirectoryHandle,
  fileName: string,
): Promise<WorkspaceGraphDiskFingerprint | null> {
  try {
    const safe = sanitizeFileName(fileName);
    const fh = await graphsDir.getFileHandle(safe);
    const file = await fh.getFile();
    return { lastModifiedMs: file.lastModified, sizeBytes: file.size };
  } catch {
    return null;
  }
}

export async function readWorkspaceGraphFileWithFingerprint(
  graphsDir: FileSystemDirectoryHandle,
  fileName: string,
): Promise<{ text: string; fingerprint: WorkspaceGraphDiskFingerprint }> {
  const safe = sanitizeFileName(fileName);
  const fh = await graphsDir.getFileHandle(safe);
  const file = await fh.getFile();
  const text = await file.text();
  return {
    text,
    fingerprint: { lastModifiedMs: file.lastModified, sizeBytes: file.size },
  };
}

export async function readWorkspaceGraphFile(
  graphsDir: FileSystemDirectoryHandle,
  fileName: string,
): Promise<string> {
  const { text } = await readWorkspaceGraphFileWithFingerprint(graphsDir, fileName);
  return text;
}

export async function writeJsonFileToDir(
  dir: FileSystemDirectoryHandle,
  fileName: string,
  data: unknown,
): Promise<void> {
  const safe = sanitizeWorkspaceGraphFileName(fileName);
  const file = await dir.getFileHandle(safe, { create: true });
  const writable = await file.createWritable();
  await writable.write(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  await writable.close();
}

export function defaultWorkspaceFileName(doc: GraphDocumentJson): string {
  return safeGraphDownloadBasename(graphIdFromDocument(doc) ?? "graph");
}

export function findWorkspaceGraphIdConflict(
  index: WorkspaceGraphEntry[],
  graphId: string,
  exceptFileName: string | null,
): string | null {
  const g = graphId.trim();
  for (const e of index) {
    if (e.graphId === g && e.fileName !== exceptFileName) {
      return e.fileName;
    }
  }
  return null;
}
