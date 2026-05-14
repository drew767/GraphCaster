// Copyright GraphCaster. All Rights Reserved.

/**
 * Lightweight in-memory registry of node type → supported typeVersions.
 *
 * The full backend-driven registry will replace this; for now it lets the
 * NDV version selector function with seeded versions and allow tests/host
 * code to register new versions deterministically.
 */

export interface NodeTypeVersionInfo {
  version: number;
  label?: string;
  /** Optional flag: when true, this is the default / latest stable version. */
  latest?: boolean;
  /** When true, surfaces a deprecation hint in the selector. */
  deprecated?: boolean;
}

const versions: Record<string, NodeTypeVersionInfo[]> = {};

export function registerNodeVersions(
  nodeType: string,
  list: NodeTypeVersionInfo[],
): void {
  const sorted = [...list].sort((a, b) => a.version - b.version);
  versions[nodeType] = sorted;
}

export function clearNodeVersions(nodeType?: string): void {
  if (nodeType === undefined) {
    for (const k of Object.keys(versions)) delete versions[k];
    return;
  }
  delete versions[nodeType];
}

export function getVersions(nodeType: string): NodeTypeVersionInfo[] {
  return versions[nodeType] ? versions[nodeType].slice() : [];
}

export function getLatestVersion(nodeType: string): number | null {
  const list = versions[nodeType];
  if (!list || list.length === 0) return null;
  const latestFlag = list.find((v) => v.latest);
  if (latestFlag) return latestFlag.version;
  return list[list.length - 1].version;
}

export function hasUpgrade(nodeType: string, current: number): boolean {
  const latest = getLatestVersion(nodeType);
  if (latest == null) return false;
  return latest > current;
}

export const nodeRegistry = {
  registerNodeVersions,
  clearNodeVersions,
  getVersions,
  getLatestVersion,
  hasUpgrade,
};

/* ── Seed defaults for built-in node types ─────────────────────── */

registerNodeVersions("http_request", [
  { version: 1, label: "v1" },
  { version: 2, label: "v2", latest: true },
]);
registerNodeVersions("agent", [
  { version: 1, label: "v1", latest: true },
]);
registerNodeVersions("llm_agent", [
  { version: 1, label: "v1", latest: true },
]);
